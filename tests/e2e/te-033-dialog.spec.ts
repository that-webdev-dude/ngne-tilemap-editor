import { test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { Snapshot } from "./harness/te-033-page";
import { expect, openEditor } from "./te-013-support";
import { menuItem, openMenu } from "./te-007-support";

// TE-033: the Resize / Offset Map dialog (DESIGN §9, SPEC §7.1) on the TE-033 project
// (harness/te-033-page.ts): "Field", 10 × 6 cells of 16 px, tiles at (0, 0) and (9, 5) and a
// point marker at (24, 40) px. The anchor grid sets the offset, the preview shows the old map's
// bounds inside the new ones, OK is one history entry and undo restores the map.

const PAGE_MODULE = "/tests/e2e/harness/te-033-page.ts";

function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

const snapshot = (page: Page) => call<Snapshot>(page, "snapshot");
const dialogOf = (page: Page) => page.getByRole("dialog", { name: "Resize / Offset Map" });

function number(dialog: Locator, group: string, name: string): Locator {
    return dialog
        .getByRole("group", { name: group, exact: true })
        .getByRole("spinbutton", { name, exact: true });
}

async function setNumber(input: Locator, value: number): Promise<void> {
    await input.fill(String(value));
    await input.press("Tab");
}

async function open(page: Page): Promise<Locator> {
    await openMenu(page, "Map");
    await menuItem(page, "map.resize").click();
    await expect(dialogOf(page)).toBeVisible();
    return dialogOf(page);
}

async function expectOffset(dialog: Locator, x: number, y: number): Promise<void> {
    await expect(number(dialog, "Offset", "X")).toHaveValue(String(x));
    await expect(number(dialog, "Offset", "Y")).toHaveValue(String(y));
}

/** The old and new bounds of the preview, relative to the new bounds' top-left, in CSS px. */
async function previewBoxes(dialog: Locator) {
    const fresh = await dialog.locator("[data-resize-new]").boundingBox();
    const old = await dialog.locator("[data-resize-old]").boundingBox();
    if (!fresh || !old) throw new Error("the preview is not laid out");
    return {
        fresh: { width: fresh.width, height: fresh.height },
        old: {
            x: old.x - fresh.x,
            y: old.y - fresh.y,
            width: old.width,
            height: old.height,
        },
    };
}

/** Expects the preview to show the old map's bounds at `offset` cells in a `size` map. */
async function expectPreview(
    dialog: Locator,
    size: [number, number],
    offset: [number, number],
): Promise<void> {
    const { fresh, old } = await previewBoxes(dialog);
    // One scale for both axes and both rectangles: cells are square (16 × 16 px).
    const scale = fresh.width / size[0];
    expect(fresh.height / size[1]).toBeCloseTo(scale, 1);
    expect(old.width / 10).toBeCloseTo(scale, 1);
    expect(old.height / 6).toBeCloseTo(scale, 1);
    expect(old.x / scale).toBeCloseTo(offset[0], 0);
    expect(old.y / scale).toBeCloseTo(offset[1], 0);
}

async function undo(page: Page): Promise<void> {
    await page.locator("[data-viewport-focus]").focus();
    await page.keyboard.press("Control+z");
}

test("the anchor grid sets the offset and the preview shows the old bounds", async ({ page }) => {
    await openEditor(page);
    await call(page, "load");
    const dialog = await open(page);
    const width = number(dialog, "Size", "Width");
    const height = number(dialog, "Size", "Height");
    await expect(width).toHaveValue("10");
    await expect(height).toHaveValue("6");
    await expectOffset(dialog, 0, 0);
    const anchors = dialog.getByRole("radiogroup", { name: "Anchor" });
    await expect(anchors.getByRole("radio")).toHaveCount(9);
    await expect(anchors.getByRole("radio", { name: "Top left", exact: true })).toHaveAttribute(
        "aria-checked",
        "true",
    );
    await expectPreview(dialog, [10, 6], [0, 0]);

    // Grow to 14 × 10: the top-left anchor keeps the offset at 0.
    await setNumber(width, 14);
    await setNumber(height, 10);
    await expectOffset(dialog, 0, 0);
    await expectPreview(dialog, [14, 10], [0, 0]);

    // Each anchor puts the old map at its place: half or all of the growth of 4 × 4.
    for (const [name, x, y] of [
        ["Centre", 2, 2],
        ["Bottom right", 4, 4],
        ["Top right", 4, 0],
        ["Centre left", 0, 2],
    ] as const) {
        await anchors.getByRole("radio", { name, exact: true }).click();
        await expect(anchors.getByRole("radio", { name, exact: true })).toHaveAttribute(
            "aria-checked",
            "true",
        );
        await expectOffset(dialog, x, y);
        await expectPreview(dialog, [14, 10], [x, y]);
    }
    // Arrow keys move the anchor: Centre left → Bottom left.
    await page.keyboard.press("ArrowDown");
    await expect(anchors.getByRole("radio", { name: "Bottom left", exact: true })).toBeFocused();
    await expectOffset(dialog, 0, 4);

    // While an anchor is checked a new size keeps the old map there; a shrink moves it left.
    await anchors.getByRole("radio", { name: "Bottom right", exact: true }).click();
    await setNumber(width, 6);
    await expectOffset(dialog, -4, 4);
    await expectPreview(dialog, [6, 10], [-4, 4]);

    // An offset typed by hand is no anchor's.
    await setNumber(number(dialog, "Offset", "X"), -1);
    await expect(anchors.getByRole("radio", { checked: true })).toHaveCount(0);
    await expectPreview(dialog, [6, 10], [-1, 4]);

    // Out of range (FORMAT §2.8, Tiled's offset range): the message shows and OK is disabled.
    const ok = dialog.locator("[data-resize-ok]");
    await setNumber(width, 5000);
    await expect(dialog.locator("[data-map-problem]")).toContainText(
        "The width is a whole number of cells from 1 to 4096.",
    );
    await expect(ok).toBeDisabled();
    await setNumber(width, 6);
    await setNumber(number(dialog, "Offset", "Y"), 7);
    await expect(dialog.locator("[data-map-problem]")).toContainText(
        "The offset Y is a whole number of cells from 0 to 4.",
    );
    await expect(ok).toBeDisabled();

    // Cancel changes nothing.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    expect(await snapshot(page)).toMatchObject({ width: 10, height: 6, undo: 0 });
});

test("OK resizes the map as one entry, and undo restores it", async ({ page }) => {
    await openEditor(page);
    await call(page, "load");
    const start = await snapshot(page);
    expect(start).toMatchObject({
        width: 10,
        height: 6,
        cells: [
            [0, 0],
            [9, 5],
        ],
        undo: 0,
    });

    const dialog = await open(page);
    await setNumber(number(dialog, "Size", "Width"), 8);
    await setNumber(number(dialog, "Size", "Height"), 9);
    await dialog
        .getByRole("radiogroup", { name: "Anchor" })
        .getByRole("radio", { name: "Bottom right", exact: true })
        .click();
    await expectOffset(dialog, -2, 3);
    await dialog.locator("[data-resize-ok]").click();
    await expect(dialog).toHaveCount(0);

    // (0, 0) moves out of the map; (9, 5) to (7, 8); the marker by (−32, 48) px.
    expect(await snapshot(page)).toEqual({
        width: 8,
        height: 9,
        cells: [[7, 8]],
        marker: [24 - 32, 40 + 48],
        undo: 1,
        undoLabel: "Resize Map",
        redo: 0,
    });

    await undo(page);
    expect(await snapshot(page)).toEqual({ ...start, redo: 1 });
});
