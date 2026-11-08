import { test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { AnimationFrame } from "../../src/core/model";
import { menuItem, openMenu } from "./te-007-support";
import { expect, openEditor, tileClient, tileOrigin } from "./te-025-support";

// TE-030: the Animation Editor (SPEC §6.4, DESIGN §9) on the TE-025 project
// (harness/te-025-map.ts): "Terrain", 12 tiles of 16 px on 4 columns, tile 5 animated. The
// editor edits the tile the panel's selection ends on; each edit is one history entry, undone
// and redone with Ctrl+Z and Ctrl+Y from inside the dialog. Its tile grid draws the tileset as
// the panel does (2× here, the panel's zoom). The panel's animated mark is a `▶` at the bottom
// left of the tile: at 2×, pixel (4, 26) of the tile is `--text`.

const PAGE_MODULE = "/tests/e2e/harness/te-030-page.ts";

function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

interface HistoryView {
    undo: number;
    label: string | null;
    redo: string | null;
}

const history = (page: Page) => call<HistoryView>(page, "history");
const animation = (page: Page, tileId = 0) => call<AnimationFrame[]>(page, "animation", tileId);
const dialog = (page: Page) => page.getByRole("dialog", { name: "Animation Editor" });
const row = (page: Page, index: number) => dialog(page).locator(`[data-frame-row="${index}"]`);
const preview = (page: Page) => dialog(page).locator("[data-animation-preview]");
const frame = (tile: number, ms: number): AnimationFrame => ({ tile, ms });

/** Selects tile `(column, row)` in the Tilesets panel and opens Tileset → Edit Animation…. */
async function openAnimation(page: Page, column = 0, row = 0): Promise<Locator> {
    const at = await tileClient(page, column, row);
    await page.mouse.click(at.x, at.y);
    await openMenu(page, "Tileset");
    await menuItem(page, "tileset.editAnimation").click();
    await expect(dialog(page)).toBeVisible();
    return dialog(page);
}

/** The client position of the centre of tile `(column, row)` in the editor's tile grid. */
async function pickerTile(page: Page, column: number, row: number) {
    const box = await dialog(page).locator("[data-picker-canvas]").boundingBox();
    if (!box) throw new Error("the tile grid has no box");
    const origin = tileOrigin(16, 2, column, row);
    return { x: box.x + origin.x + 16, y: box.y + origin.y + 16 };
}

/** Whether tile `id` of "Terrain" shows the animated mark in the Tilesets panel. */
async function marked(page: Page, id: number): Promise<boolean> {
    const text = await call<number[]>(page, "token", "--text");
    const { x, y } = tileOrigin(16, 2, id % 4, Math.floor(id / 4));
    const pixel = await call<number[]>(page, "canvasPixel", x + 4, y + 26);
    return pixel.slice(0, 3).every((value, k) => value === text[k]);
}

async function drag(
    page: Page,
    from: { x: number; y: number },
    to: { x: number; y: number },
): Promise<void> {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 3 });
    await page.mouse.up();
}

/** The centre of `locator`, moved `dy` CSS pixels down. */
async function centre(locator: Locator, dy = 0): Promise<{ x: number; y: number }> {
    const box = await locator.boundingBox();
    if (!box) throw new Error("no box");
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 + dy };
}

/** Ctrl+Z inside the dialog, expecting `after`; then Ctrl+Y back to `before`. */
async function undoRedo(
    page: Page,
    before: AnimationFrame[],
    after: AnimationFrame[],
): Promise<void> {
    await page.keyboard.press("Control+z");
    await expect.poll(() => animation(page)).toEqual(after);
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press("Control+y");
    await expect.poll(() => animation(page)).toEqual(before);
}

test("adds from selection, reorders, edits durations and deletes; each edit undoes", async ({
    page,
}) => {
    await openEditor(page);
    const start = await history(page);
    expect(await marked(page, 0)).toBe(false);
    expect(await marked(page, 5)).toBe(true);
    await openAnimation(page);
    await expect(dialog(page)).toContainText("Terrain · tile 0");
    await expect(preview(page)).toHaveAccessibleName("Preview: no frames");

    // Add from Selection: tiles 1–3 of the grid's first row, 100 ms each (the default).
    const one = await pickerTile(page, 1, 0);
    const three = await pickerTile(page, 3, 0);
    await page.mouse.click(one.x, one.y);
    await page.keyboard.down("Shift");
    await page.mouse.click(three.x, three.y);
    await page.keyboard.up("Shift");
    await dialog(page).locator("[data-animation-add]").click();
    const added = [frame(1, 100), frame(2, 100), frame(3, 100)];
    await expect.poll(() => animation(page)).toEqual(added);
    expect(await history(page)).toMatchObject({
        undo: start.undo + 1,
        label: "Add Animation Frames",
    });
    // The tile gains its animated mark, and loses it with the undo.
    await expect.poll(() => marked(page, 0)).toBe(true);
    await page.keyboard.press("Control+z");
    await expect.poll(() => animation(page)).toEqual([]);
    await expect.poll(() => marked(page, 0)).toBe(false);
    await page.keyboard.press("Control+y");
    await expect.poll(() => animation(page)).toEqual(added);
    await expect.poll(() => marked(page, 0)).toBe(true);

    // Reorder: the first frame alone selected, its handle dragged below the third frame.
    await dialog(page).locator("[data-frame='0']").click();
    const third = await row(page, 2).boundingBox();
    await drag(page, await centre(row(page, 0).locator("[data-frame-handle]")), {
        x: third!.x + 40,
        y: third!.y + third!.height - 2,
    });
    const moved = [frame(2, 100), frame(3, 100), frame(1, 100)];
    await expect.poll(() => animation(page)).toEqual(moved);
    expect(await history(page)).toMatchObject({
        undo: start.undo + 2,
        label: "Move Animation Frames",
    });
    await undoRedo(page, moved, added);
    // An undo or redo replaces the list, so no frame is left selected (Tiled resets its list).
    await expect(dialog(page).locator("[data-frame-row][data-selected]")).toHaveCount(0);

    // One duration: the second frame's own field.
    const field = dialog(page).getByRole("spinbutton", { name: "Duration of frame 2" });
    await field.fill("250");
    await field.press("Enter");
    const one250 = [frame(2, 100), frame(3, 250), frame(1, 100)];
    await expect.poll(() => animation(page)).toEqual(one250);
    expect(await history(page)).toMatchObject({
        undo: start.undo + 3,
        label: "Change Frame Duration",
    });
    await dialog(page).locator("[data-frame='0']").click();
    await undoRedo(page, one250, moved);

    // Many durations: frames 1 and 3 selected (Ctrl+click), 40 ms applied to both.
    await dialog(page).locator("[data-frame='0']").click();
    await dialog(page)
        .locator("[data-frame='2']")
        .click({ modifiers: ["Control"] });
    await expect(row(page, 0)).toHaveAttribute("data-selected", "");
    await expect(row(page, 1)).not.toHaveAttribute("data-selected", "");
    const duration = dialog(page).getByRole("spinbutton", { name: "Frame Duration", exact: true });
    await duration.fill("40");
    await duration.press("Enter");
    await dialog(page).locator("[data-animation-apply]").click();
    const many = [frame(2, 40), frame(3, 250), frame(1, 40)];
    await expect.poll(() => animation(page)).toEqual(many);
    expect(await history(page)).toMatchObject({
        undo: start.undo + 4,
        label: "Change Frame Duration",
    });
    await dialog(page).locator("[data-frame='1']").click();
    await undoRedo(page, many, one250);

    // Delete: the second frame with the Delete key, then the rest with the button.
    await dialog(page).locator("[data-frame='1']").click();
    await page.keyboard.press("Delete");
    const fewer = [frame(2, 40), frame(1, 40)];
    await expect.poll(() => animation(page)).toEqual(fewer);
    expect(await history(page)).toMatchObject({
        undo: start.undo + 5,
        label: "Delete Animation Frames",
    });
    await undoRedo(page, fewer, many);
    await dialog(page).locator("[data-frame='0']").click();
    await dialog(page)
        .locator("[data-frame='1']")
        .click({ modifiers: ["Shift"] });
    await dialog(page).locator("[data-animation-delete]").click();
    await expect.poll(() => animation(page)).toEqual([]);
    expect((await history(page)).undo).toBe(start.undo + 6);
    // Without frames the tile is no longer animated: it loses its mark, and the undo brings it
    // back.
    await expect.poll(() => marked(page, 0)).toBe(false);
    await page.keyboard.press("Control+z");
    await expect.poll(() => animation(page)).toEqual(fewer);
    await expect.poll(() => marked(page, 0)).toBe(true);
    await page.keyboard.press("Control+y");
    await expect.poll(() => animation(page)).toEqual([]);
    await expect.poll(() => marked(page, 0)).toBe(false);

    // Close keeps every edit; the history holds one entry per edit.
    await dialog(page).locator("[data-animation-close]").click();
    await expect(dialog(page)).toHaveCount(0);
    expect((await history(page)).undo).toBe(start.undo + 6);
});

test("tiles dragged from the grid drop where the pointer is; a double click appends", async ({
    page,
}) => {
    await openEditor(page);
    await call(page, "setAnimation", 0, [frame(1, 100), frame(2, 100)]);
    await openAnimation(page);
    await expect(row(page, 1)).toBeVisible();

    // Tile 4 dragged above the first frame.
    const first = await row(page, 0).boundingBox();
    await drag(page, await pickerTile(page, 0, 1), { x: first!.x + 60, y: first!.y + 3 });
    await expect.poll(() => animation(page)).toEqual([frame(4, 100), frame(1, 100), frame(2, 100)]);
    expect((await history(page)).label).toBe("Add Animation Frames");

    // A new frame takes the editor's frame duration; a double click adds at the end.
    const duration = dialog(page).getByRole("spinbutton", { name: "Frame Duration", exact: true });
    await duration.fill("75");
    await duration.press("Enter");
    const seven = await pickerTile(page, 3, 1);
    await page.mouse.dblclick(seven.x, seven.y);
    await expect
        .poll(() => animation(page))
        .toEqual([frame(4, 100), frame(1, 100), frame(2, 100), frame(7, 75)]);

    // Alt+Down moves each selected frame one place.
    await dialog(page).locator("[data-frame='0']").click();
    await dialog(page)
        .locator("[data-frame='2']")
        .click({ modifiers: ["Control"] });
    await page.keyboard.press("Alt+ArrowDown");
    await expect
        .poll(() => animation(page))
        .toEqual([frame(1, 100), frame(4, 100), frame(7, 75), frame(2, 100)]);
    expect((await history(page)).label).toBe("Move Animation Frames");
    await expect(row(page, 1)).toHaveAttribute("data-selected", "");
    await expect(row(page, 3)).toHaveAttribute("data-selected", "");

    // A drag released outside the list adds nothing.
    const before = (await history(page)).undo;
    const nine = await pickerTile(page, 1, 2);
    await drag(page, nine, { x: nine.x + 40, y: nine.y + 10 });
    expect((await history(page)).undo).toBe(before);

    // The tile menu opens the editor on the selected tile, after Edit Collision….
    await dialog(page).locator("[data-animation-close]").click();
    const two = await tileClient(page, 2, 0);
    await page.mouse.click(two.x, two.y);
    await page.mouse.click(two.x, two.y, { button: "right" });
    const items = page.getByRole("menuitem");
    await expect(items).toHaveText(["Edit Collision…", "Edit Animation…", "Properties"]);
    await page.getByRole("menuitem", { name: "Edit Animation…" }).click();
    await expect(dialog(page)).toContainText("Terrain · tile 2");
});

test("refuses frames past 1024 on a tile and says why; the list is unchanged", async ({ page }) => {
    await openEditor(page);
    const full = Array.from({ length: 1024 }, () => frame(1, 10));
    await call(page, "setAnimation", 0, full);
    await openAnimation(page);
    const before = (await history(page)).undo;
    const one = await pickerTile(page, 1, 0);
    await page.mouse.dblclick(one.x, one.y);
    await expect(dialog(page).locator("[data-animation-message]")).toContainText(
        "at most 1024 frames",
    );
    expect((await history(page)).undo).toBe(before);
    expect(await animation(page)).toHaveLength(1024);
});

test("the preview advances frames at their durations and loops (mocked clock)", async ({
    page,
}) => {
    await page.clock.install();
    await openEditor(page);
    await openAnimation(page);
    await expect(preview(page)).toHaveAccessibleName("Preview: no frames");

    // The clock stops; setting the list restarts the preview at that instant.
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(now + 1000);
    await call(page, "setAnimation", 0, [frame(4, 100), frame(5, 300), frame(6, 50)]);
    await expect(preview(page)).toHaveAttribute("data-preview-tile", "4");

    // 450 ms a loop: tile 4 for 0–99, tile 5 for 100–399, tile 6 for 400–449.
    const steps: [number, string][] = [
        [60, "4"], //  60 ms
        [60, "5"], // 120
        [250, "5"], // 370
        [60, "6"], // 430
        [60, "4"], // 490: the loop starts again
        [100, "5"], // 590
    ];
    for (const [ms, tile] of steps) {
        await page.clock.runFor(ms);
        await expect(preview(page)).toHaveAttribute("data-preview-tile", tile);
    }
    await expect(preview(page)).toHaveAccessibleName("Preview: tile 5");

    // The scale is 1×–4× the tile's size; a 16 px tile starts at 4×.
    const canvas = preview(page).locator("canvas");
    expect((await canvas.boundingBox())!.width).toBe(64);
    await dialog(page).getByRole("combobox", { name: "Preview" }).click();
    await page.getByRole("option", { name: "2×" }).click();
    await expect.poll(async () => (await canvas.boundingBox())!.width).toBe(32);
});
