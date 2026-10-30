import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { formatChord } from "../../src/app/commands/chord";
import { boxOf, collectErrors, region } from "./te-003-support";
import {
    closeMenu,
    menuItem,
    menuTrigger,
    openEditor,
    openMenu,
    rename,
    snapshot,
} from "./te-007-support";

// TE-007: the menu bar of the real app. Menus are generated from the command registry
// (SUITE §4): every item is a registry entry, planned commands are present and disabled.
// Adapted from the sprite editor's se-007-menus.spec.ts.
//
// Commands these tests add are their own (ids "te007.…", at the end of View), so the tests
// keep their meaning when later tickets implement the planned commands.

/** DESIGN §5. */
const MENUS = ["File", "Edit", "Map", "Layer", "Tileset", "Select", "View"];

interface RenderedItem {
    command: string | null;
    title: string;
    shortcut: string;
    disabled: boolean;
}

interface RegistryItem {
    id: string;
    title: string;
    shortcut: string;
    enabled: boolean;
    planned: boolean;
    menu: string | null;
}

/**
 * Every item of an open menu as rendered, those of its submenus included (each submenu is
 * opened in turn). A submenu's own entry is not an item: it runs nothing.
 */
async function renderedItems(page: Page, menu: Locator): Promise<RenderedItem[]> {
    const items = await menu.evaluate((element) =>
        Array.from(element.querySelectorAll<HTMLElement>('[role="menuitem"]'), (item) => {
            const shortcut = item.querySelector(".ui-menu__shortcut")?.textContent ?? "";
            const text = item.textContent ?? "";
            return {
                command: item.getAttribute("data-command"),
                submenu: item.getAttribute("data-submenu"),
                title: shortcut ? text.slice(0, -shortcut.length) : text,
                shortcut,
                disabled: item.getAttribute("aria-disabled") === "true",
            };
        }),
    );
    const rendered: RenderedItem[] = [];
    for (const { submenu, ...item } of items) {
        if (submenu === null) {
            rendered.push(item);
            continue;
        }
        await menu.locator(`[data-submenu="${submenu}"]`).hover();
        const nested = page.getByRole("menu", { name: submenu, exact: true });
        await expect(nested).toBeVisible();
        rendered.push(...(await renderedItems(page, nested)));
    }
    return rendered;
}

/** Every entry of the app's registry, as the registry reports it now. */
function registryItems(page: Page): Promise<RegistryItem[]> {
    return page.evaluate(() =>
        window.__ngneTest!.commands.list().map((command) => ({
            id: command.id,
            title: command.title(),
            shortcut: command.shortcuts[0] ?? "",
            enabled: command.enabled(),
            planned: command.planned,
            menu: command.menuPath?.[0] ?? null,
        })),
    );
}

test("the menu bar shows File Edit Map Layer Tileset Select View in that order", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const bar = region(page, "menu-bar").getByRole("menubar", { name: "Main menu" });
    await expect(bar.getByRole("menuitem")).toHaveText(MENUS);

    // The menus do not change the height of the region, and sit at its left edge.
    expect((await boxOf(region(page, "menu-bar"))).height).toBe(36);
    expect((await boxOf(menuTrigger(page, "File"))).x).toBe(8);
    // Pointer targets of at least 24×24 px (SUITE §4), in the bar and in a menu.
    for (const name of MENUS) {
        const trigger = await boxOf(menuTrigger(page, name));
        expect(trigger.height, name).toBe(24);
        expect(trigger.width, name).toBeGreaterThanOrEqual(24);
    }
    const menu = await openMenu(page, "File");
    for (const item of await menu.getByRole("menuitem").all()) {
        expect((await boxOf(item)).height).toBe(24);
    }
    expect(errors).toEqual([]);
});

test("every menu holds the items of DESIGN §5, each a registry entry", async ({ page }) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const registry = await registryItems(page);
    const byId = new Map(registry.map((entry) => [entry.id, entry]));
    const seen: string[] = [];
    const titles: Record<string, string[]> = {};

    for (const name of MENUS) {
        const items = await renderedItems(page, await openMenu(page, name));
        expect(items.length, `${name} has items`).toBeGreaterThan(0);
        titles[name] = items.map((item) => item.title);
        for (const item of items) {
            // An item without a command id, or with an id the registry does not know, is an
            // orphan.
            expect(item.command, `${name} › ${item.title} names its command`).not.toBeNull();
            const entry = byId.get(item.command ?? "");
            expect(
                entry,
                `${name} › ${item.title} (${item.command}) is in the registry`,
            ).toBeDefined();
            expect(entry?.menu, `${item.command} is listed in its own menu`).toBe(name);
            expect(item.title, `${item.command} title`).toBe(entry?.title);
            // As menus show a chord: "←" for ArrowLeft (formatChord).
            expect(item.shortcut, `${item.command} shortcut`).toBe(
                entry?.shortcut ? formatChord(entry.shortcut) : "",
            );
            expect(item.disabled, `${item.command} disabled`).toBe(!entry?.enabled);
            seen.push(item.command ?? "");
        }
        await closeMenu(page);
    }

    // The items of DESIGN §5, in order; the Open Recent submenu holds its placeholder.
    expect(titles.File).toEqual([
        "New Project…",
        "New Map…",
        "Open…",
        "No Recent Projects",
        "Save",
        "Save As…",
        "Revert",
        "Import Tileset…",
        "Import Tiled Map…",
        "Export…",
        "Export Again",
        "Close Map",
        "Close Project",
    ]);
    expect(titles.Edit).toEqual([
        "Undo",
        "Redo",
        "Cut",
        "Copy",
        "Paste",
        "Delete",
        "Command Palette…",
        "Keyboard Shortcuts…",
        "Preferences…",
    ]);
    expect(titles.Map).toEqual([
        "Map Properties…",
        "Resize / Offset Map…",
        "Duplicate Map",
        "Delete Map",
        "Previous Map",
        "Next Map",
    ]);
    expect(titles.Layer).toEqual([
        "New Tile Layer",
        "New Marker Layer",
        "New Image Layer…",
        "New Group",
        "Group Layers",
        "Ungroup",
        "Duplicate Layer",
        "Delete Layer",
        "Rename Layer",
        "Layer Properties…",
        "Move Layer Up",
        "Move Layer Down",
        "Select Layer Above",
        "Select Layer Below",
        "Show/Hide Other Layers",
        "Lock/Unlock Other Layers",
    ]);
    expect(titles.Tileset).toEqual([
        "Tileset Properties…",
        "Update Tileset from Source…",
        "Delete Tileset",
        "Edit Collision…",
        "Edit Animation…",
        "Previous Tileset",
        "Next Tileset",
        "Flip Stamp Horizontally",
        "Flip Stamp Vertically",
        "Rotate Stamp Right",
        "Rotate Stamp Left",
    ]);
    expect(titles.Select).toEqual(["Select All", "Select None", "Invert Selection"]);
    expect(titles.View).toEqual([
        "Zoom In",
        "Zoom Out",
        "Fit",
        "100%",
        "Show Grid",
        "Show Collision",
        "Highlight Current Layer",
        "Snap to Grid",
        "Hide Bottom Panel",
        "Focus Next Region",
        "Focus Previous Region",
    ]);

    // And the other way round: every registry entry with a menu is shown, once.
    const expected = registry.filter((entry) => entry.menu !== null).map((entry) => entry.id);
    expect([...seen].sort()).toEqual(expected.sort());
    expect(new Set(seen).size).toBe(seen.length);
    expect(errors).toEqual([]);
});

test("items of unimplemented commands are present and disabled", async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => {
        window.__ngneTest!.commands.plan({
            id: "te007.planned",
            title: "Planned Item…",
            menuPath: ["View"],
            menuOrder: 9000,
        });
    });
    const planned = (await registryItems(page)).filter((entry) => entry.planned);
    expect(planned.map((entry) => entry.id)).toContain("te007.planned");
    expect(planned.map((entry) => entry.id)).toContain("file.save");

    // Every command that is still only planned has its item: visible, disabled, and without a
    // shortcut, because its binding is registered by its own ticket.
    for (const name of MENUS) {
        const ids = planned.filter((entry) => entry.menu === name).map((entry) => entry.id);
        if (ids.length === 0) continue;
        const items = await renderedItems(page, await openMenu(page, name));
        for (const id of ids) {
            const item = items.find((entry) => entry.command === id);
            expect(item, `${name} shows ${id}`).toBeDefined();
            expect(item?.disabled, `${id} is disabled`).toBe(true);
            expect(item?.shortcut, `${id} has no shortcut`).toBe("");
        }
        await closeMenu(page);
    }

    // A disabled item does nothing when clicked; the menu stays open.
    const view = await openMenu(page, "View");
    await expect(menuItem(page, "te007.planned")).toHaveText("Planned Item…");
    await expect(menuItem(page, "te007.planned")).toHaveAttribute("aria-disabled", "true");
    await menuItem(page, "te007.planned").click({ force: true });
    await expect(view).toBeVisible();
});

test("Undo and Redo show the step they act on and run from the menu", async ({ page }) => {
    await openEditor(page);
    await openMenu(page, "Edit");
    await expect(menuItem(page, "edit.undo")).toHaveText("UndoCtrl+Z");
    await expect(menuItem(page, "edit.undo")).toHaveAttribute("aria-disabled", "true");
    await expect(menuItem(page, "edit.redo")).toHaveText("RedoCtrl+Y");
    await expect(menuItem(page, "edit.redo")).toHaveAttribute("aria-disabled", "true");
    await closeMenu(page);

    await rename(page, "first", "Stamp Brush");
    await openMenu(page, "Edit");
    await expect(menuItem(page, "edit.undo")).toHaveText("Undo Stamp BrushCtrl+Z");
    await expect(menuItem(page, "edit.undo")).not.toHaveAttribute("aria-disabled", "true");
    await expect(menuItem(page, "edit.redo")).toHaveAttribute("aria-disabled", "true");
    // The shortcut is right-aligned and muted (SUITE §4).
    const item = await boxOf(menuItem(page, "edit.undo"));
    const shortcut = await boxOf(menuItem(page, "edit.undo").locator(".ui-menu__shortcut"));
    expect(Math.round(item.x + item.width - (shortcut.x + shortcut.width))).toBe(8);

    await menuItem(page, "edit.undo").click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect((await snapshot(page)).name).toBe("Untitled");

    await openMenu(page, "Edit");
    await expect(menuItem(page, "edit.undo")).toHaveText("UndoCtrl+Z");
    await expect(menuItem(page, "edit.undo")).toHaveAttribute("aria-disabled", "true");
    await expect(menuItem(page, "edit.redo")).toHaveText("Redo Stamp BrushCtrl+Y");
    await menuItem(page, "edit.redo").click();
    expect((await snapshot(page)).name).toBe("first");
});

test("an open menu follows the state its commands read", async ({ page }) => {
    await openEditor(page);
    await openMenu(page, "Edit");
    await expect(menuItem(page, "edit.undo")).toHaveAttribute("aria-disabled", "true");
    await rename(page, "first", "Bucket Fill");
    await expect(menuItem(page, "edit.undo")).toHaveText("Undo Bucket FillCtrl+Z");
    await expect(menuItem(page, "edit.undo")).not.toHaveAttribute("aria-disabled", "true");
});

test("Hide Bottom Panel in View toggles the panel and its own title", async ({ page }) => {
    await openEditor(page);
    const panel = region(page, "bottom-panel");
    await expect(panel).toBeVisible();
    await openMenu(page, "View");
    await expect(menuItem(page, "view.bottomPanel")).toHaveText("Hide Bottom PanelTab");
    await menuItem(page, "view.bottomPanel").click();
    await expect(panel).toBeHidden();
    await openMenu(page, "View");
    await expect(menuItem(page, "view.bottomPanel")).toHaveText("Show Bottom PanelTab");
    await menuItem(page, "view.bottomPanel").click();
    await expect(panel).toBeVisible();
});

test("the menus work from the keyboard", async ({ page }) => {
    await openEditor(page);
    await rename(page, "first", "Stamp Brush");

    // One tab stop for the whole bar; arrows move between the menus and wrap around.
    await menuTrigger(page, "File").focus();
    await page.keyboard.press("ArrowRight");
    await expect(menuTrigger(page, "Edit")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(menuTrigger(page, "File")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(menuTrigger(page, "View")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(menuTrigger(page, "File")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(menuTrigger(page, "Edit")).toBeFocused();

    // Enter opens the menu on its first enabled item; Enter runs it.
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu", { name: "Edit" })).toBeVisible();
    await expect(menuItem(page, "edit.undo")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect((await snapshot(page)).name).toBe("Untitled");
    await expect(menuTrigger(page, "Edit")).toBeFocused();
});

test("a command that fails is reported by an error toast", async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => {
        window.__ngneTest!.commands.register({
            id: "te007.fails",
            title: "Failing Command",
            menuPath: ["View"],
            menuOrder: 9000,
            run() {
                throw new Error("Could not allocate 4096 bytes of history memory.");
            },
        });
    });
    await openMenu(page, "View");
    await menuItem(page, "te007.fails").click();
    await expect(page.getByRole("alert")).toHaveText(
        "Failing Command failed: Could not allocate 4096 bytes of history memory.",
    );
    // The app goes on working.
    await openMenu(page, "Edit");
    await expect(menuItem(page, "edit.undo")).toBeVisible();
});
