import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type * as CommandTypes from "../../src/app/commands/types";
import { collectErrors, region } from "./te-003-support";
import { menuTrigger, settleTimers } from "./te-007-support";
import {
    closeAll,
    eachShellState,
    escapeTop,
    expandDock,
    expectAccessible,
    focusInside,
    LAYERS,
    loadAudit,
    nextFolder,
    NOTIFICATIONS,
    pageCall,
    showEveryToast,
    runCommand,
    startEditor,
    surfaceOpened,
    THEMES,
    topSurface,
    visitAllSurfaces,
    writeFolder,
} from "./te-065-support";

// TE-065: axe (WCAG 2.1 A and AA) reports no serious or critical violation on any surface, in
// both themes (`se-design` §8, SPEC §15). What is visited comes from the registries at run
// time: the shell in each state of `eachShellState` (every dock panel expanded, both bottom
// panel tabs, the context bar of every tool of both tool sets) and the empty state; the menus
// of `MENU_BAR` and the submenus of the registry's menu paths; every control of the shell that
// opens a popover, a menu or a list, and every context menu of the panels; a tooltip, the
// toasts and the two full-window notices; every dialog and surface a command or a situation
// opens (`visitAllSurfaces`), with the list of each select it holds. Each is judged on its own
// and with the page around it.

/** Waits for the surface on top to take the focus (Radix does it one timer after opening). */
async function surfaceOnTop(page: Page, what: string): Promise<{ selector: string; name: string }> {
    await expect.poll(async () => (await topSurface(page)) !== null, `${what} opens`).toBe(true);
    const top = (await topSurface(page))!;
    await expect.poll(() => focusInside(page, top.selector), `${what} has the focus`).toBe(true);
    return top;
}

test("a select list that scrolls is operable from the keyboard: End reaches its last option (AXE_EXEMPTIONS)", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await startEditor(page);
    await loadAudit(page);
    const { folderFiles } = await import("./te-061-support");
    await writeFolder(page, "tmj", folderFiles());
    await nextFolder(page, "tmj");
    await runCommand(page, "file.importTiledMap");
    expect(await surfaceOpened(page)).toBe(true);
    const dialog = page.getByRole("dialog", { name: "Import Tiled Map" });
    const select = dialog.locator('button[role="combobox"]').first();
    await select.focus();
    await page.keyboard.press("Enter");
    const list = page.getByRole("listbox");
    await expect(list).toBeVisible();
    const viewport = list.locator("[data-radix-select-viewport]");
    expect(
        await viewport.evaluate((element) => element.scrollHeight > element.clientHeight),
        "the list scrolls",
    ).toBe(true);
    await settleTimers(page);
    await page.keyboard.press("End");
    const last = list.getByRole("option").last();
    await expect(last).toBeFocused();
    expect(
        await last.evaluate((option) => {
            const box = option.getBoundingClientRect();
            const view = option.closest("[data-radix-select-viewport]")!.getBoundingClientRect();
            return box.top >= view.top - 0.5 && box.bottom <= view.bottom + 0.5;
        }),
        "the last option is scrolled into view",
    ).toBe(true);
    await page.keyboard.press("Home");
    await expect(list.getByRole("option").first()).toBeFocused();
    await closeAll(page);
    expect(errors).toEqual([]);
});

for (const theme of THEMES) {
    test(`no serious or critical violation on the shell, every dock panel, both bottom panel tabs and every tool's context bar in the ${theme} theme`, async ({
        page,
    }) => {
        test.setTimeout(10 * 60_000);
        const errors = collectErrors(page);
        await startEditor(page, { theme });
        await expectAccessible(page, "empty state", "body");
        const states: string[] = [];
        await eachShellState(page, async (name) => {
            states.push(name);
            await expectAccessible(page, name, "body");
        });
        expect(states.length).toBeGreaterThan(15);
        expect(errors).toEqual([]);
    });

    test(`no serious or critical violation on every menu and submenu of the menu bar in the ${theme} theme`, async ({
        page,
    }) => {
        test.setTimeout(10 * 60_000);
        const errors = collectErrors(page);
        await startEditor(page, { theme });
        await loadAudit(page);
        const { menus, submenus } = await page.evaluate(async () => {
            const path = "/src/app/commands/types.ts";
            const { MENU_BAR } = (await import(/* @vite-ignore */ path)) as typeof CommandTypes;
            const paths = new Set<string>();
            for (const command of window.__ngneTest!.commands.list()) {
                const menuPath = command.menuPath ?? [];
                for (let depth = 2; depth <= menuPath.length; depth++) {
                    paths.add(JSON.stringify(menuPath.slice(0, depth)));
                }
            }
            return {
                menus: [...MENU_BAR],
                submenus: [...paths].map((path) => JSON.parse(path) as string[]),
            };
        });
        for (const menu of menus) {
            await menuTrigger(page, menu).click();
            const top = await surfaceOnTop(page, `menu ${menu}`);
            expect(top.name).toBe(menu);
            await expectAccessible(page, `menu ${menu}`, top.selector);
            await escapeTop(page);
        }
        expect(submenus.length, "submenus").toBeGreaterThan(0);
        for (const path of submenus) {
            await menuTrigger(page, path[0]!).click();
            await surfaceOnTop(page, `menu ${path[0]}`);
            for (const name of path.slice(1)) {
                await page
                    .getByRole("menu")
                    .last()
                    .getByRole("menuitem", { name, exact: true })
                    .focus();
                await page.keyboard.press("ArrowRight");
                await expect(page.getByRole("menu", { name })).toBeVisible();
            }
            const top = await surfaceOnTop(page, `submenu ${path.join(" › ")}`);
            await expectAccessible(page, `submenu ${path.join(" › ")}`, top.selector);
            await closeAll(page);
            await settleTimers(page);
        }
        expect(errors).toEqual([]);
    });

    test(`no serious or critical violation on the shell's popovers, context menus, lists, tooltips, toasts and notices in the ${theme} theme`, async ({
        page,
    }) => {
        test.setTimeout(10 * 60_000);
        const errors = collectErrors(page);
        await startEditor(page, { theme });
        await loadAudit(page);
        await expandDock(page);
        const audited: string[] = [];
        for (const tab of ["Tilesets", "Terrains"]) {
            await region(page, "bottom-panel").getByRole("tab", { name: tab }).click();
            // Every control of the shell that opens a popover or a menu (menu bar triggers were
            // judged with the menus), and the list of every select.
            const openers = page.locator(
                '[data-region]:not([data-region="menu-bar"]) button[aria-haspopup]:not([disabled]), [data-region] button[role="combobox"]:not([disabled])',
            );
            const count = await openers.count();
            expect(count, `openers with ${tab}`).toBeGreaterThan(5);
            for (let index = 0; index < count; index++) {
                const opener = openers.nth(index);
                if (!(await opener.isVisible())) continue;
                await opener.scrollIntoViewIfNeeded();
                const label =
                    (await opener.getAttribute("aria-label")) ??
                    ((await opener.textContent()) ?? "").trim();
                await opener.click();
                const top = await surfaceOnTop(page, label);
                await expectAccessible(page, `${tab}: surface of ${label}`, top.selector);
                audited.push(`${tab}: ${label}`);
                await closeAll(page);
            }
            // The context menus of the panels, where a right click opens one.
            const rows = page.locator(
                '[data-region="dock"] [role="option"], [data-region="dock"] [role="treeitem"], [data-region="bottom-panel"] [role="tab"], [data-tile-grid], [data-terrain-grid]',
            );
            const rowCount = await rows.count();
            for (let index = 0; index < rowCount; index++) {
                const row = rows.nth(index);
                if (!(await row.isVisible())) continue;
                await row.scrollIntoViewIfNeeded();
                await row.click({ button: "right", position: { x: 6, y: 6 } });
                await settleTimers(page);
                const top = await topSurface(page);
                if (!top) continue;
                await surfaceOnTop(page, `context menu ${index}`);
                await expectAccessible(page, `${tab}: context menu ${top.name}`, top.selector);
                audited.push(`${tab}: context menu ${top.name}`);
                await closeAll(page);
            }
        }
        expect(audited.filter((entry) => entry.includes("context menu")).length).toBeGreaterThan(2);
        // The lists of the selects in every tool's context bar, both tool sets. (A right click on
        // a map row showed that map.)
        await pageCall(page, "activateMap", "Overworld");
        for (const layer of [LAYERS.ground, LAYERS.areas]) {
            await pageCall(page, "activateLayer", layer);
            for (const tool of await pageCall<string[]>(page, "offeredTools")) {
                expect(await pageCall<boolean>(page, "selectTool", tool), tool).toBe(true);
                await settleTimers(page);
                const selects = region(page, "context-bar").locator(
                    'button[role="combobox"]:not([disabled])',
                );
                for (let index = 0; index < (await selects.count()); index++) {
                    const select = selects.nth(index);
                    if (!(await select.isVisible())) continue;
                    const label = (await select.getAttribute("aria-label")) ?? `select ${index}`;
                    await select.click();
                    const top = await surfaceOnTop(page, `${tool}: ${label}`);
                    await expectAccessible(page, `${tool}: list of ${label}`, top.selector);
                    audited.push(`${tool}: list of ${label}`);
                    await closeAll(page);
                }
            }
        }
        expect(
            audited.some((entry) => entry.startsWith("terrain: list of")),
            "the terrain brush's Terrain set list",
        ).toBe(true);
        await pageCall(page, "activateLayer", LAYERS.ground);
        test.info().annotations.push({ type: "audited", description: audited.join("; ") });

        // A tooltip, on keyboard focus.
        const tool = region(page, "tool-rail").locator("[data-tool]").first();
        await tool.focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        await expect(page.getByRole("tooltip")).toBeVisible();
        await expectAccessible(page, "tooltip", '[role="tooltip"]');

        // A toast of each kind: information, error with the app's storage message, and one with
        // an action.
        await showEveryToast(page);
        await expectAccessible(page, "toasts", NOTIFICATIONS);

        // The two full-window notices: the window too small, then no WebGPU.
        await page.setViewportSize({ width: 1200, height: 700 });
        await expect(page.locator('[data-notice="window-too-small"]')).toBeVisible();
        await expectAccessible(page, "window too small", '[data-notice="window-too-small"]');
        await page.addInitScript(() => {
            delete (Navigator.prototype as { gpu?: unknown }).gpu;
        });
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.reload();
        await expect(page.locator('[data-notice="webgpu-required"]')).toBeVisible();
        await expectAccessible(page, "WebGPU required", '[data-notice="webgpu-required"]');
        expect(errors).toEqual([]);
    });

    test(`no serious or critical violation on any dialog or command surface, and the lists of their selects, in the ${theme} theme`, async ({
        page,
    }) => {
        test.setTimeout(15 * 60_000);
        const errors = collectErrors(page);
        await startEditor(page, { theme });
        const visited: string[] = [];
        const missing = await visitAllSurfaces(
            page,
            async ({ source, name, selector, surface }) => {
                visited.push(`${source}: ${name}`);
                await expectAccessible(page, `${source}: ${name}`, selector);
                const selects = surface.locator('button[role="combobox"]:not([disabled])');
                for (let index = 0; index < (await selects.count()); index++) {
                    const select = selects.nth(index);
                    if (!(await select.isVisible())) continue;
                    const label =
                        (await select.getAttribute("aria-label")) ?? `select ${index + 1}`;
                    await select.click();
                    await expect
                        .poll(async () => (await topSurface(page))?.selector !== selector)
                        .toBe(true);
                    const list = (await topSurface(page))!;
                    await expectAccessible(
                        page,
                        `${source}: ${name}, list of ${label}`,
                        list.selector,
                    );
                    await escapeTop(page);
                    await expect.poll(() => focusInside(page, selector)).toBe(true);
                    visited.push(`${source}: ${name}, list of ${label}`);
                }
            },
        );
        test.info().annotations.push({ type: "surfaces", description: visited.join("; ") });
        expect(missing, "registered dialogs and app surfaces not visited").toEqual([]);
        expect(visited.length).toBeGreaterThan(22);
        expect(errors).toEqual([]);
    });
}
