import { test } from "@playwright/test";
import { LAYERS, activeTool, expect, openEditor, pageCall } from "./te-016-support";

// TE-016: the tool rail shows the tool set of the active layer's kind (DESIGN §6) and each kind
// keeps its last tool.

const TILE_SET = [
    "stamp",
    "eraser",
    "bucket",
    "shapeFill",
    "terrain",
    "rectSelect",
    "wand",
    "sameTile",
    "hand",
    "zoom",
];

const rail = (page: Parameters<typeof openEditor>[0]) =>
    pageCall<{ tools: string[]; active: string | null }>(page, "rail");

test.beforeEach(async ({ page }) => {
    await openEditor(page);
});

test("a tile layer shows the tile tool set, a group layer only Hand and Zoom", async ({ page }) => {
    await expect.poll(() => rail(page).then((r) => r.tools)).toEqual(TILE_SET);
    const groups = page.locator('[data-region="tool-rail"] [data-rail-group]');
    await expect(groups).toHaveCount(4);

    await pageCall(page, "setActiveLayer", LAYERS.group);
    await expect.poll(() => rail(page).then((r) => r.tools)).toEqual(["hand", "zoom"]);
    await expect(groups).toHaveCount(1);
    // Hand, the set's first tool, is the active one.
    expect((await rail(page)).active).toBe("hand");
});

test("switching layer kinds restores each kind's last tool", async ({ page }) => {
    // Tile layer: the probe (registered by the page module, not in the rail).
    expect(await pageCall(page, "selectTool", "probe")).toBe(true);
    // Group layer: Zoom, chosen in the rail.
    await pageCall(page, "setActiveLayer", LAYERS.group);
    expect(await activeTool(page)).toBe("hand");
    await page.locator('[data-region="tool-rail"] [data-tool="zoom"]').click();
    await expect.poll(() => rail(page).then((r) => r.active)).toBe("zoom");
    // A tile tool cannot be selected into the group layer's set.
    expect(await pageCall(page, "selectTool", "probe")).toBe(false);

    await pageCall(page, "setActiveLayer", LAYERS.tile);
    expect(await activeTool(page)).toBe("probe");
    await expect.poll(() => rail(page).then((r) => r.tools)).toEqual(TILE_SET);
    // Another tile layer is the same kind: the probe stays.
    await pageCall(page, "setActiveLayer", LAYERS.grouped);
    expect(await activeTool(page)).toBe("probe");

    await pageCall(page, "setActiveLayer", LAYERS.group);
    expect(await activeTool(page)).toBe("zoom");
    await expect.poll(() => rail(page).then((r) => r.active)).toBe("zoom");
});
