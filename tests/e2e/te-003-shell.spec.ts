import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
    DOCK_WIDTH,
    defaultTimelineHeight,
    TIMELINE_HEIGHT,
    timelineMaxHeight,
} from "../../src/ui/shell/layout";
import {
    boxOf,
    collectErrors,
    openShell,
    overlap,
    region,
    regionBoxes,
    REGIONS,
} from "./te-003-support";
import type { Box, Region } from "./te-003-support";

// TE-003: the app shell — region sizes of SUITE §3 and se/src/ui/shell/layout.ts, the dock
// sections of DESIGN §2 and the bottom panel's tabs.

/** SUITE §3: the fixed sizes; the dock and the bottom panel come from layout.ts. */
const MENU_BAR = 36;
const CONTEXT_BAR = 36;
const STATUS_BAR = 24;
const TOOL_RAIL = 44;

/**
 * The regions at a window of `width` × `height` with default splitters: the tool rail runs
 * down beside the bottom panel, which spans the viewport and dock columns (DESIGN §2).
 */
function expectedBoxes(width: number, height: number): Record<Region, Box> {
    const dock = DOCK_WIDTH.default;
    const panel = defaultTimelineHeight(height);
    const middle = height - MENU_BAR - STATUS_BAR - panel;
    const centre = width - TOOL_RAIL - dock;
    return {
        "menu-bar": { x: 0, y: 0, width, height: MENU_BAR },
        "tool-rail": { x: 0, y: MENU_BAR, width: TOOL_RAIL, height: middle + panel },
        "context-bar": { x: TOOL_RAIL, y: MENU_BAR, width: centre, height: CONTEXT_BAR },
        viewport: {
            x: TOOL_RAIL,
            y: MENU_BAR + CONTEXT_BAR,
            width: centre,
            height: middle - CONTEXT_BAR,
        },
        dock: { x: TOOL_RAIL + centre, y: MENU_BAR, width: dock, height: middle },
        "bottom-panel": {
            x: TOOL_RAIL,
            y: MENU_BAR + middle,
            width: width - TOOL_RAIL,
            height: panel,
        },
        "status-bar": { x: 0, y: height - STATUS_BAR, width, height: STATUS_BAR },
    };
}

/** No two regions share a pixel and together they cover the window. */
function expectSoundLayout(boxes: Record<Region, Box>, window: { width: number; height: number }) {
    for (const [index, first] of REGIONS.entries()) {
        for (const second of REGIONS.slice(index + 1)) {
            expect(overlap(boxes[first], boxes[second]), `${first} overlaps ${second}`).toBe(0);
        }
    }
    const area = REGIONS.reduce((sum, id) => sum + boxes[id].width * boxes[id].height, 0);
    expect(area).toBe(window.width * window.height);
}

const DOCK_ORDER = [
    ["maps", "Maps"],
    ["layers", "Layers"],
    ["properties", "Properties"],
    ["preview", "Preview · NGNE"],
    ["minimap", "Minimap"],
] as const;

const sectionToggle = (page: Page, id: string) =>
    region(page, "dock").locator(`[data-dock-panel="${id}"] .dock-section__toggle`);

async function expandedSections(page: Page): Promise<Record<string, boolean>> {
    const expanded: Record<string, boolean> = {};
    for (const [id] of DOCK_ORDER) {
        expanded[id] = (await sectionToggle(page, id).getAttribute("aria-expanded")) === "true";
    }
    return expanded;
}

test("at 1280×720 each region has the size of SUITE §3 and layout.ts", async ({ page }) => {
    const errors = collectErrors(page);
    await openShell(page, { width: 1280, height: 720 });
    const boxes = await regionBoxes(page);
    expect(boxes).toEqual(expectedBoxes(1280, 720));
    // The numbers themselves, so the comparison cannot pass on a wrong formula.
    expect(boxes["tool-rail"]).toEqual({ x: 0, y: 36, width: 44, height: 660 });
    expect(boxes.viewport).toEqual({ x: 44, y: 72, width: 972, height: 424 });
    expect(boxes.dock).toEqual({ x: 1016, y: 36, width: 264, height: 460 });
    expect(boxes["bottom-panel"]).toEqual({ x: 44, y: 496, width: 1236, height: 200 });
    expectSoundLayout(boxes, { width: 1280, height: 720 });
    expect(errors).toEqual([]);
});

test("at 1920×1080 the regions keep their sizes and the bottom panel its default height", async ({
    page,
}) => {
    await openShell(page, { width: 1920, height: 1080 });
    const boxes = await regionBoxes(page);
    expect(boxes).toEqual(expectedBoxes(1920, 1080));
    expect(boxes["bottom-panel"].height).toBe(200);
    expectSoundLayout(boxes, { width: 1920, height: 1080 });
});

test("the dock sections follow DESIGN §2 in order, each collapsible", async ({ page }) => {
    await openShell(page, { width: 1280, height: 720 });
    const dock = region(page, "dock");
    const ids = await dock
        .locator("[data-dock-panel]")
        .evaluateAll((sections) =>
            sections.map((section) => section.getAttribute("data-dock-panel")),
        );
    expect(ids).toEqual(DOCK_ORDER.map(([id]) => id));
    await expect(dock.locator(".dock-section__toggle")).toHaveText(
        DOCK_ORDER.map(([, title]) => title),
    );

    // Panels are empty until their tickets fill them.
    for (const [id] of DOCK_ORDER) {
        const toggle = sectionToggle(page, id);
        if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        const body = dock.locator(`[data-dock-panel="${id}"] .dock-section__body`);
        // TE-032 fills Maps: one row per map of the project, which starts with one.
        if (id === "maps")
            await expect(body.getByRole("listbox").getByRole("option")).toHaveCount(1);
        // TE-035 fills Layers: one row per layer of the active map, which starts with one.
        else if (id === "layers")
            await expect(body.getByRole("tree").getByRole("treeitem")).toHaveCount(1);
        else await expect(body).toBeEmpty();
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        await expect(dock.locator(`[data-dock-panel="${id}"] .dock-section__body`)).toBeHidden();
    }
});

test("Preview and Minimap start collapsed at 1280×720 and expanded at 1920×1080", async ({
    page,
}) => {
    await openShell(page, { width: 1280, height: 720 });
    expect(await expandedSections(page)).toEqual({
        maps: true,
        layers: true,
        properties: true,
        preview: false,
        minimap: false,
    });

    await openShell(page, { width: 1920, height: 1080 });
    expect(await expandedSections(page)).toEqual({
        maps: true,
        layers: true,
        properties: true,
        preview: true,
        minimap: true,
    });
});

test("the bottom panel holds the tabs Tilesets and Terrains and resizes like the timeline", async ({
    page,
}) => {
    await openShell(page, { width: 1280, height: 720 });
    const panel = region(page, "bottom-panel");
    const tabs = panel.getByRole("tablist", { name: "Bottom panel" }).getByRole("tab");
    await expect(tabs).toHaveText(["Tilesets", "Terrains"]);
    await expect(panel.getByRole("tab", { name: "Tilesets" })).toHaveAttribute(
        "aria-selected",
        "true",
    );
    await expect(panel.locator('[data-panel-tab="tilesets"]')).toBeVisible();
    await expect(
        panel.locator('[data-panel-tab="tilesets"] [data-tilesets-panel] [data-tilesets-empty]'),
    ).toBeVisible();
    await expect(panel.locator('[data-panel-tab="terrains"]')).toBeHidden();

    await panel.getByRole("tab", { name: "Terrains" }).click();
    await expect(panel.getByRole("tab", { name: "Terrains" })).toHaveAttribute(
        "aria-selected",
        "true",
    );
    await expect(panel.locator('[data-panel-tab="terrains"]')).toBeVisible();
    await expect(panel.locator('[data-panel-tab="terrains"]')).toBeEmpty();
    await expect(panel.locator('[data-panel-tab="tilesets"]')).toBeHidden();

    const height = async () => (await boxOf(panel)).height;
    const splitter = page.getByRole("separator", { name: "Resize bottom panel" });
    await splitter.focus();
    await page.keyboard.press("Home");
    expect(await height()).toBe(TIMELINE_HEIGHT.min);
    await page.keyboard.press("End");
    expect(await height()).toBe(timelineMaxHeight(720));
    expectSoundLayout(await regionBoxes(page), { width: 1280, height: 720 });
    await page.keyboard.press("Enter");
    expect(await height()).toBe(200);
});

test("regions carry their landmarks and are empty placeholders until their tickets fill them", async ({
    page,
}) => {
    await openShell(page);
    await expect(page.getByRole("banner")).toHaveAttribute("data-region", "menu-bar");
    await expect(page.getByRole("navigation", { name: "Tools" })).toHaveAttribute(
        "data-region",
        "tool-rail",
    );
    await expect(page.getByRole("region", { name: "Tool options" })).toHaveAttribute(
        "data-region",
        "context-bar",
    );
    await expect(page.getByRole("main")).toHaveAttribute("data-region", "viewport");
    await expect(page.getByRole("complementary", { name: "Panels" })).toHaveAttribute(
        "data-region",
        "dock",
    );
    await expect(page.getByRole("region", { name: "Bottom panel" })).toHaveAttribute(
        "data-region",
        "bottom-panel",
    );
    await expect(page.getByRole("contentinfo")).toHaveAttribute("data-region", "status-bar");

    // The tool rail holds the tools of TE-016, the stamp brush of TE-017 pressed.
    await expect(region(page, "tool-rail").locator('[data-tool="stamp"]')).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    // The viewport holds the canvas of TE-013 and the overlay above it.
    const canvas = region(page, "viewport").getByRole("application", { name: "Canvas" });
    await expect(canvas.locator("canvas:not([data-viewport-overlay])")).toBeVisible();
    await expect(canvas.locator("canvas[data-viewport-overlay]")).toBeVisible();
    // The context bar holds the active tool of TE-017: the stamp brush, a tile layer's default.
    await expect(region(page, "context-bar").locator("[data-context-tool]")).toHaveText(
        "Stamp Brush",
    );
    // The status bar holds the fields of TE-014: the size of the project's map.
    await expect(region(page, "status-bar").locator('[data-status="size"]')).toHaveText(
        /^\d+ × \d+ cells$/,
    );
});

test("splitter sizes persist under ngne-tilemap-editor.layout across a reload", async ({
    page,
}) => {
    await openShell(page, { width: 1440, height: 900 });
    const dock = region(page, "dock");
    const panel = region(page, "bottom-panel");
    await page.getByRole("separator", { name: "Resize panels" }).focus();
    await page.keyboard.press("Shift+ArrowLeft");
    await page.getByRole("separator", { name: "Resize bottom panel" }).focus();
    await page.keyboard.press("Shift+ArrowUp");
    expect((await boxOf(dock)).width).toBe(DOCK_WIDTH.default + 32);
    expect((await boxOf(panel)).height).toBe(200 + 32);
    expect(await page.evaluate(() => localStorage.getItem("ngne-tilemap-editor.layout"))).toBe(
        JSON.stringify({ dockWidth: 296, timelineHeight: 232 }),
    );

    await page.reload();
    await expect(dock).toBeVisible();
    expect((await boxOf(dock)).width).toBe(296);
    expect((await boxOf(panel)).height).toBe(232);
});
