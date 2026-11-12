import { expect, test } from "@playwright/test";
import type { JSHandle, Locator, Page } from "@playwright/test";
import type * as CommandTypes from "../../src/app/commands/types";
import type { WalkState } from "./harness/te-065-page";
import { collectErrors, region, REGIONS } from "./te-003-support";
import { menuTrigger, settleTimers } from "./te-007-support";
import { activeOption, openPalette, paletteInput, paletteOption } from "./te-008-support";
import {
    armCommand,
    askingCommands,
    closeAll,
    commandSettled,
    expandDock,
    LAYERS,
    loadAudit,
    pageCall,
    startEditor,
    surfaceOpened,
    topSurface,
} from "./te-065-support";

// TE-065: the keyboard-only walk (`se-design` §8, DESIGN §8 and §10). With the "Audit" project
// open, from the keyboard alone:
//
// - every command of the registry is found in the command palette and reached with the arrow
//   keys, and every enabled menu command is reached through the menu bar's menus;
// - F6 and Shift+F6 cycle every region;
// - the panels are operable: the Maps list, the Layers tree, the dock sections, the bottom
//   panel's tabs, the Tilesets grid (one tab stop, arrows, Enter makes the stamp), the terrain
//   swatches, the splitters (DESIGN §10.4: the targets under 24 px are operable from the
//   keyboard; marker vertices nudge with the arrows, te-039-edit-points);
// - every surface a command opens from the palette or a menu closes on Escape, changes nothing
//   and gives the focus back.
//
// The commands come from the registry at run time.

const walk = (page: Page) => pageCall<WalkState>(page, "walkState");

function focusedRegion(page: Page): Promise<string | null> {
    return page.evaluate(
        () => document.activeElement?.closest("[data-region]")?.getAttribute("data-region") ?? null,
    );
}

/** Moves the focus with F6 into `region`. */
async function focusRegion(page: Page, id: string): Promise<void> {
    for (let presses = 0; presses < REGIONS.length + 1; presses++) {
        if ((await focusedRegion(page)) === id) return;
        await page.keyboard.press("F6");
    }
    expect(await focusedRegion(page)).toBe(id);
}

/** Presses Tab until `target` has the focus (at most 60 presses). */
async function tabTo(page: Page, target: Locator, what: string): Promise<void> {
    for (let presses = 0; presses < 60; presses++) {
        if (await target.evaluate((element) => element === document.activeElement)) return;
        await page.keyboard.press("Tab");
    }
    await expect(target, `${what} is reached with Tab`).toBeFocused();
}

function focusIsOn(page: Page, origin: JSHandle): Promise<boolean> {
    return page.evaluate((element) => document.activeElement === element, origin);
}

function describeFocus(page: Page): Promise<string> {
    return page.evaluate(() => {
        const element = document.activeElement;
        if (!element || element === document.body) return "body";
        const name = element.getAttribute("aria-label") ?? (element.textContent ?? "").slice(0, 30);
        return `${element.tagName.toLowerCase()}[role=${element.getAttribute("role")}] "${name}"`;
    });
}

/**
 * The surface open now closed with Escape: the history unchanged and the focus back on
 * `origin`. The layer properties popover, opened by a menu item (gone by then), gives it to
 * the active layer's row instead, as the sprite editor's timeline popovers give it to the
 * active cell (DESIGN §8.2, `se-design` SE-022, SE-061).
 */
async function escapeBackTo(
    page: Page,
    what: string,
    origin: JSHandle,
    openedByMenuItem: boolean,
): Promise<void> {
    const top = (await topSurface(page))!;
    const popover = await page
        .locator(top.selector)
        .evaluate((element) => element.matches("[data-layer-properties]"));
    const before = (await walk(page)).history;
    await closeAll(page);
    expect((await walk(page)).history, `${what}: Escape changes nothing`).toEqual(before);
    const expected =
        popover && openedByMenuItem
            ? await region(page, "dock")
                  .locator('[role="tree"] [role="treeitem"][tabindex="0"]')
                  .elementHandle()
            : origin;
    await expect
        .poll(
            async () =>
                (await focusIsOn(page, expected!)) ? "where it belongs" : await describeFocus(page),
            `${what}: the focus is back`,
        )
        .toBe("where it belongs");
}

test("every command of the registry is found in the command palette and reached with the arrow keys", async ({
    page,
}) => {
    test.setTimeout(10 * 60_000);
    const errors = collectErrors(page);
    await startEditor(page);
    await loadAudit(page);
    const commands = await page.evaluate(() =>
        window.__ngneTest!.commands.list().map((command) => ({
            id: command.id,
            title: command.title(),
            enabled: command.enabled(),
        })),
    );
    expect(commands.length).toBeGreaterThan(100);
    await focusRegion(page, "viewport");
    await openPalette(page);
    for (const { id, title, enabled } of commands) {
        await paletteInput(page).fill(title);
        const option = paletteOption(page, id);
        await expect(option, id).toHaveCount(1);
        for (let presses = 0; presses < 60; presses++) {
            if ((await option.getAttribute("aria-selected")) === "true") break;
            await page.keyboard.press("ArrowDown");
        }
        await expect(activeOption(page), id).toHaveAttribute("data-command", id);
        if (enabled) await expect(option, id).not.toHaveAttribute("aria-disabled", "true");
        else await expect(option, id).toHaveAttribute("aria-disabled", "true");
    }
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
});

test("every enabled command of the menu bar is reached with the arrow keys", async ({ page }) => {
    test.setTimeout(5 * 60_000);
    const errors = collectErrors(page);
    await startEditor(page);
    await loadAudit(page);
    const { menus, expected } = await page.evaluate(async () => {
        const path = "/src/app/commands/types.ts";
        const { MENU_BAR } = (await import(/* @vite-ignore */ path)) as typeof CommandTypes;
        return {
            menus: [...MENU_BAR],
            expected: window
                .__ngneTest!.commands.list()
                .filter((command) => !command.planned && command.enabled() && command.menuPath)
                .map((command) => command.id)
                .sort(),
        };
    });
    expect(expected.length).toBeGreaterThan(40);
    const focusedItem = () =>
        page.evaluate(() => {
            const element = document.activeElement;
            return {
                command: element?.getAttribute("data-command") ?? null,
                submenu: element?.getAttribute("aria-haspopup") === "menu",
                key: element ? `${element.id}|${element.textContent}` : "",
            };
        });
    /** Walks the open menu from its first item down; returns the commands it focused. */
    const walkMenu = async (depth: number): Promise<string[]> => {
        const seen: string[] = [];
        let previous = "";
        for (let step = 0; step < 80; step++) {
            await settleTimers(page);
            const item = await focusedItem();
            if (item.key === previous) break;
            previous = item.key;
            if (item.command) seen.push(item.command);
            if (item.submenu && depth < 3) {
                await page.keyboard.press("ArrowRight");
                await expect(page.getByRole("menu")).toHaveCount(depth + 2);
                await settleTimers(page);
                seen.push(...(await walkMenu(depth + 1)));
                await page.keyboard.press("ArrowLeft");
                await expect(page.getByRole("menu")).toHaveCount(depth + 1);
                await settleTimers(page);
            }
            await page.keyboard.press("ArrowDown");
        }
        return seen;
    };
    const reached = new Set<string>();
    await focusRegion(page, "menu-bar");
    await expect(menuTrigger(page, menus[0]!)).toBeFocused();
    for (const [index, menu] of menus.entries()) {
        await page.keyboard.press(index === 0 ? "ArrowDown" : "ArrowRight");
        await expect(page.getByRole("menu", { name: menu })).toBeVisible();
        await expect.poll(async () => (await focusedItem()).key !== "").toBe(true);
        for (const id of await walkMenu(0)) reached.add(id);
        // Back to the top item, so that ArrowRight opens the next menu, not a submenu.
        await page.keyboard.press("Home");
        await settleTimers(page);
        if ((await focusedItem()).submenu) await page.keyboard.press("ArrowDown");
    }
    await page.keyboard.press("Escape");
    expect(
        expected.filter((id) => !reached.has(id)),
        "menu commands not reached",
    ).toEqual([]);
    expect(errors).toEqual([]);
});

test("F6 and Shift+F6 cycle through every region with a project open", async ({ page }) => {
    const errors = collectErrors(page);
    await startEditor(page);
    await loadAudit(page);
    // A tool whose context bar has controls: F6 passes over a region with nothing to focus
    // (the stamp brush's transforms are disabled while there is no stamp).
    expect(await pageCall<boolean>(page, "selectTool", "terrain")).toBe(true);
    await expect(
        region(page, "context-bar").locator("[data-terrain-swatch]").first(),
    ).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const forward: (string | null)[] = [];
    for (let presses = 0; presses <= REGIONS.length; presses++) {
        await page.keyboard.press("F6");
        forward.push(await focusedRegion(page));
    }
    expect(forward).toEqual([...REGIONS, REGIONS[0]]);
    const backward: (string | null)[] = [];
    for (let presses = 0; presses <= REGIONS.length; presses++) {
        await page.keyboard.press("Shift+F6");
        backward.push(await focusedRegion(page));
    }
    expect(backward).toEqual([...[...REGIONS].reverse(), REGIONS.at(-1)]);
    expect(errors).toEqual([]);
});

test("the panels are operable from the keyboard alone: maps, layers, dock sections, bottom tabs, the tile grid, terrain swatches and splitters", async ({
    page,
}) => {
    test.setTimeout(3 * 60_000);
    const errors = collectErrors(page);
    await startEditor(page);
    await loadAudit(page);
    await expandDock(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await focusRegion(page, "dock");
    const dock = region(page, "dock");

    // The Maps list: one tab stop; ↓ moves, Enter opens the row's map.
    const maps = dock.getByRole("listbox");
    await tabTo(page, maps.locator('[role="option"][tabindex="0"]'), "the Maps list");
    expect((await walk(page)).map).toBe("Overworld");
    await page.keyboard.press("ArrowDown");
    await expect(maps.getByRole("option", { name: /^Cave/ })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await walk(page)).map).toBe("Cave");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await walk(page)).map).toBe("Overworld");

    // The Layers tree: one tab stop; ↓ moves, Enter makes the row's layer active.
    const tree = dock.getByRole("tree");
    await tabTo(page, tree.locator('[role="treeitem"][tabindex="0"]'), "the Layers tree");
    expect((await walk(page)).layer).toBe(LAYERS.ground);
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(tree.getByRole("treeitem", { name: /^Sky/ })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await walk(page)).layer).toBe(LAYERS.sky);
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await walk(page)).layer).toBe(LAYERS.ground);

    // A dock section collapses and expands with Enter on its header.
    const toggle = dock.locator('[data-dock-panel="minimap"] .dock-section__toggle');
    await tabTo(page, toggle, "the Minimap header");
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    // The dock's splitter: focused, the arrow keys resize it.
    const dockSplitter = page.getByRole("separator", { name: "Resize panels" });
    await dockSplitter.focus();
    const width = Number(await dockSplitter.getAttribute("aria-valuenow"));
    await page.keyboard.press("ArrowLeft");
    await expect
        .poll(async () => Number(await dockSplitter.getAttribute("aria-valuenow")))
        .toBeGreaterThan(width);
    await page.keyboard.press("Enter");
    await expect
        .poll(async () => Number(await dockSplitter.getAttribute("aria-valuenow")))
        .toBe(width);

    // The bottom panel: its tabs with the arrow keys, its splitter with the arrow keys.
    await focusRegion(page, "bottom-panel");
    const bottom = region(page, "bottom-panel");
    const tabs = bottom.getByRole("tablist", { name: "Bottom panel" });
    const selectedTab = tabs.locator('[role="tab"][aria-selected="true"]');
    await tabTo(
        page,
        tabs.locator('[role="tab"][tabindex="0"], [role="tablist"][tabindex="0"]').first(),
        "the bottom tabs",
    );
    await page.keyboard.press("ArrowRight");
    await expect(selectedTab).toHaveText("Terrains");
    await page.keyboard.press("ArrowLeft");
    await expect(selectedTab).toHaveText("Tilesets");
    const panelSplitter = page.getByRole("separator", { name: "Resize bottom panel" });
    await panelSplitter.focus();
    const height = Number(await panelSplitter.getAttribute("aria-valuenow"));
    await page.keyboard.press("ArrowUp");
    await expect
        .poll(async () => Number(await panelSplitter.getAttribute("aria-valuenow")))
        .toBeGreaterThan(height);
    await page.keyboard.press("Enter");

    // The Tilesets grid at 1× (DESIGN §10.4): one tab stop; the arrows move the selection,
    // Shift extends it, Enter makes the stamp.
    await focusRegion(page, "bottom-panel");
    const grid = bottom.locator("[data-tile-grid]");
    await tabTo(page, grid, "the tile grid");
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await walk(page)).tiles).toBe("1,0-1,0");
    await page.keyboard.press("Shift+ArrowRight");
    await expect.poll(async () => (await walk(page)).tiles).toBe("1,0-2,0");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await walk(page)).stamp).toBe("1,2");

    // The terrain brush's swatches (DESIGN §10.4): each a tab stop, Enter chooses it.
    await focusRegion(page, "viewport");
    await page.keyboard.press("t");
    await expect.poll(() => pageCall<string>(page, "activeTool")).toBe("terrain");
    const grass = region(page, "context-bar").locator('[data-terrain-swatch="1"]');
    await focusRegion(page, "context-bar");
    await tabTo(page, grass, "the Grass swatch");
    await page.keyboard.press("Enter");
    await expect(grass).toHaveAttribute("aria-pressed", "true");
    const erase = region(page, "context-bar").locator('[data-terrain-swatch="0"]');
    await page.keyboard.press("Shift+Tab");
    await expect(erase).toBeFocused();
    await page.keyboard.press("Space");
    await expect(erase).toHaveAttribute("aria-pressed", "true");
    expect(errors).toEqual([]);
});

test("every surface a command opens from the palette closes on Escape, changes nothing and gives the focus back to the viewport", async ({
    page,
}) => {
    test.setTimeout(10 * 60_000);
    const errors = collectErrors(page);
    await startEditor(page);
    await loadAudit(page);
    const visited: string[] = [];
    for (const id of await askingCommands(page)) {
        await focusRegion(page, "viewport");
        const origin = await page.evaluateHandle(() => document.activeElement);
        const title = await page.evaluate((id) => window.__ngneTest!.commands.get(id)!.title(), id);
        await openPalette(page);
        await paletteInput(page).fill(title);
        for (let presses = 0; presses < 60; presses++) {
            if ((await paletteOption(page, id).getAttribute("aria-selected")) === "true") break;
            await page.keyboard.press("ArrowDown");
        }
        await armCommand(page, id);
        await page.keyboard.press("Enter");
        // The palette closes; the command runs where the focus went back to. Command
        // Palette… opens the palette again (its run was taken before the arm, at Ctrl+K).
        await expect
            .poll(
                async () =>
                    id === "edit.commandPalette" ||
                    (await commandSettled(page)) ||
                    (await paletteInput(page).count()) === 0,
                `${id}: the palette closes`,
            )
            .toBe(true);
        if (await surfaceOpened(page)) {
            visited.push(`${id}: ${(await topSurface(page))?.name}`);
            await escapeBackTo(page, id, origin, false);
        } else {
            // A picker, cancelled: the focus is where it was too.
            await expect.poll(() => focusIsOn(page, origin), id).toBe(true);
        }
    }
    expect(visited.length).toBeGreaterThan(10);
    test.info().annotations.push({ type: "surfaces", description: visited.join("; ") });
    expect(errors).toEqual([]);
});

test("every surface a menu item opens closes on Escape, changes nothing and gives the focus back to the menu bar", async ({
    page,
}) => {
    test.setTimeout(10 * 60_000);
    const errors = collectErrors(page);
    await startEditor(page);
    await loadAudit(page);
    const items = await page.evaluate(
        (ids) =>
            ids.flatMap((id) => {
                const path = window.__ngneTest!.commands.get(id)!.menuPath;
                return path ? [{ id, path: [...path] }] : [];
            }),
        await askingCommands(page),
    );
    expect(items.length).toBeGreaterThan(10);
    let surfaces = 0;
    for (const { id, path } of items) {
        const trigger = menuTrigger(page, path[0]!);
        await trigger.focus();
        const origin = (await trigger.elementHandle())!;
        await page.keyboard.press("ArrowDown");
        await expect(page.getByRole("menu", { name: path[0] })).toBeVisible();
        for (const name of path.slice(1)) {
            for (let presses = 0; presses < 40; presses++) {
                await settleTimers(page);
                const text = await page.evaluate(() => document.activeElement?.textContent ?? "");
                if (text.startsWith(name)) break;
                await page.keyboard.press("ArrowDown");
            }
            await page.keyboard.press("ArrowRight");
            await expect(page.getByRole("menu", { name })).toBeVisible();
        }
        const item = page.locator(`[role="menuitem"][data-command="${id}"]`);
        for (let presses = 0; presses < 40; presses++) {
            await settleTimers(page);
            if (await item.evaluate((element) => element === document.activeElement)) break;
            await page.keyboard.press("ArrowDown");
        }
        await expect(item, id).toBeFocused();
        await armCommand(page, id);
        await page.keyboard.press("Enter");
        await expect(page.getByRole("menu")).toHaveCount(0);
        if (await surfaceOpened(page)) {
            surfaces++;
            await escapeBackTo(page, id, origin, true);
        } else {
            await expect.poll(() => focusIsOn(page, origin), id).toBe(true);
        }
    }
    expect(surfaces).toBeGreaterThan(10);
    expect(errors).toEqual([]);
});
