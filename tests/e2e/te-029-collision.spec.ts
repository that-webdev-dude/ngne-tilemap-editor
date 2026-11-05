import { test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { Shape } from "../../src/core/model";
import { overlayIdle } from "./te-014-support";
import { menuItem, openMenu } from "./te-007-support";
import { dragTiles, expect, openEditor, tileClient } from "./te-025-support";

// TE-029: the Collision Editor (SPEC §6.4, DESIGN §9) and View → Show Collision (DESIGN §4), on
// the TE-025 project (harness/te-025-map.ts): "Terrain", 12 tiles of 16 px, on a 30 × 20 map
// of 16 px cells. Each edit of the editor is one history entry, undone and redone with Ctrl+Z
// and Ctrl+Y from inside the dialog; with two tiles selected one entry sets both. The editor
// shows a 16 px tile with 8 px of room round it at 8× (harness: `data-margin`, `data-zoom`).

const PAGE_MODULE = "/tests/e2e/harness/te-029-page.ts";

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
const collision = (page: Page, tileId = 0) => call<Shape[]>(page, "collision", tileId);
const dialog = (page: Page) => page.getByRole("dialog", { name: "Collision Editor" });
const stage = (page: Page) => dialog(page).locator("[data-collision-stage]");
const message = (page: Page) => dialog(page).locator("[data-collision-message]");

/** Selects tile `(column, row)` in the Tilesets panel and opens Tileset → Edit Collision…. */
async function openCollision(page: Page, column = 0, row = 0): Promise<Locator> {
    const at = await tileClient(page, column, row);
    await page.mouse.click(at.x, at.y);
    await openMenu(page, "Tileset");
    await menuItem(page, "tileset.editCollision").click();
    await expect(dialog(page)).toBeVisible();
    return dialog(page);
}

/** The client position of tile pixel `(x, y)` on the editor's stage. */
async function at(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
    const box = await stage(page).boundingBox();
    if (!box) throw new Error("the stage has no box");
    const zoom = Number(await stage(page).getAttribute("data-zoom"));
    const margin = Number(await stage(page).getAttribute("data-margin"));
    return { x: box.x + (x + margin) * zoom, y: box.y + (y + margin) * zoom };
}

async function tool(page: Page, id: string): Promise<void> {
    await dialog(page).locator(`[data-collision-tool="${id}"]`).click();
}

async function drag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
    const start = await at(page, ...from);
    const end = await at(page, ...to);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 2 });
    await page.mouse.move(end.x, end.y, { steps: 2 });
    await page.mouse.up();
}

async function click(page: Page, x: number, y: number): Promise<void> {
    const point = await at(page, x, y);
    await page.mouse.click(point.x, point.y);
}

/** Ctrl+Z inside the dialog, expecting the shapes `after`; then Ctrl+Y back to `before`. */
async function undoRedo(page: Page, before: Shape[], after: Shape[]): Promise<void> {
    await page.keyboard.press("Control+z");
    await expect.poll(() => collision(page)).toEqual(after);
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press("Control+y");
    await expect.poll(() => collision(page)).toEqual(before);
}

/** The absolute points of a polygon. */
function pointsOf(shape: Shape): number[][] {
    if (shape.shape !== "polygon") throw new Error(`${shape.shape} is no polygon`);
    return shape.points.map(([x, y]) => [shape.x + x, shape.y + y]);
}

const RECT: Shape = { shape: "rectangle", x: 2, y: 2, width: 4, height: 3 };
const ELLIPSE: Shape = { shape: "ellipse", x: 8, y: 8, width: 6, height: 4 };

test("draws a rectangle, an ellipse and polygons; each is one entry, undone and redone", async ({
    page,
}) => {
    await openEditor(page);
    const start = await history(page);
    await openCollision(page);
    await expect(stage(page)).toHaveAttribute("data-zoom", "8");

    await tool(page, "rectangle");
    await drag(page, [2, 2], [6, 5]);
    await expect.poll(() => collision(page)).toEqual([RECT]);
    expect(await history(page)).toMatchObject({
        undo: start.undo + 1,
        label: "Add Collision Shape",
    });
    // A click, or a drag along one axis, makes nothing: the shape would have no area.
    await click(page, 10, 10);
    await drag(page, [10, 10], [14, 10]);
    expect((await history(page)).undo).toBe(start.undo + 1);
    expect(await collision(page)).toEqual([RECT]);
    await undoRedo(page, [RECT], []);

    await tool(page, "ellipse");
    await drag(page, [14, 12], [8, 8]);
    await expect.poll(() => collision(page)).toEqual([RECT, ELLIPSE]);
    await undoRedo(page, [RECT, ELLIPSE], [RECT]);

    // Polygon closed by a click on its first point.
    await tool(page, "polygon");
    await click(page, 1, 10);
    await click(page, 5, 10);
    await click(page, 3, 14);
    await expect(dialog(page).locator("[data-collision-draft]")).toHaveAttribute(
        "data-collision-draft",
        "3",
    );
    await click(page, 1, 10);
    await expect.poll(async () => (await collision(page)).length).toBe(3);
    const triangle = (await collision(page))[2]!;
    expect(pointsOf(triangle)).toEqual([
        [1, 10],
        [5, 10],
        [3, 14],
    ]);
    expect((await history(page)).undo).toBe(start.undo + 3);
    await undoRedo(page, [RECT, ELLIPSE, triangle], [RECT, ELLIPSE]);

    // Backspace removes the last point; Enter closes.
    await click(page, 10, 0);
    await click(page, 15, 0);
    await click(page, 15, 5);
    await click(page, 12, 7);
    await page.keyboard.press("Backspace");
    await expect(dialog(page).locator("[data-collision-draft]")).toHaveAttribute(
        "data-collision-draft",
        "3",
    );
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await collision(page)).length).toBe(4);
    expect(pointsOf((await collision(page))[3]!)).toEqual([
        [10, 0],
        [15, 0],
        [15, 5],
    ]);
    const closed = await collision(page);
    await undoRedo(page, closed, closed.slice(0, 3));

    // Escape cancels a polygon in progress and leaves the dialog open; a second closes it.
    const entries = (await history(page)).undo;
    await click(page, -4, -4);
    await click(page, -2, -4);
    await page.keyboard.press("Escape");
    await expect(dialog(page).locator("[data-collision-draft]")).toHaveCount(0);
    await expect(dialog(page)).toBeVisible();
    expect((await history(page)).undo).toBe(entries);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    expect((await collision(page)).length).toBe(4);
});

test("moves, resizes and edits points; each is one entry, undone and redone", async ({ page }) => {
    await openEditor(page);
    const triangle: Shape = {
        shape: "polygon",
        x: 2,
        y: 9,
        points: [
            [0, 0],
            [8, 0],
            [4, 5],
        ],
    };
    await call(page, "setCollision", [0], [RECT, triangle]);
    await openCollision(page);

    // Select and move the rectangle by (2, 1).
    await tool(page, "select");
    await drag(page, [3, 3], [5, 4]);
    const moved: Shape = { ...RECT, x: 4, y: 3 };
    await expect.poll(() => collision(page)).toEqual([moved, triangle]);
    expect((await history(page)).label).toBe("Move Collision Shape");
    await undoRedo(page, [moved, triangle], [RECT, triangle]);

    // Resize from its bottom-right handle (8, 6) to (10, 9).
    await drag(page, [8, 6], [10, 9]);
    const resized: Shape = { ...moved, width: 6, height: 6 };
    await expect.poll(() => collision(page)).toEqual([resized, triangle]);
    expect((await history(page)).label).toBe("Resize Collision Shape");
    await undoRedo(page, [resized, triangle], [moved, triangle]);

    // The fields: X typed moves it.
    await dialog(page).locator("[data-collision-shape='0']").click();
    const x = dialog(page).getByRole("spinbutton", { name: "X", exact: true });
    await x.fill("1");
    await x.press("Enter");
    const typed: Shape = { ...resized, x: 1 };
    await expect.poll(() => collision(page)).toEqual([typed, triangle]);
    expect((await history(page)).label).toBe("Change Collision Shape");
    await stage(page).focus();
    await undoRedo(page, [typed, triangle], [resized, triangle]);

    // Edit points: select the triangle, drag its apex from (6, 14) to (6, 16).
    await tool(page, "points");
    await click(page, 6, 11);
    await drag(page, [6, 14], [6, 16]);
    let shapes = await collision(page);
    expect(pointsOf(shapes[1]!)).toEqual([
        [2, 9],
        [10, 9],
        [6, 16],
    ]);
    expect((await history(page)).label).toBe("Edit Collision Points");
    const dragged = shapes;
    await undoRedo(page, dragged, [typed, triangle]);

    // A double click on the top edge adds a point there.
    const mid = await at(page, 6, 9);
    await page.mouse.dblclick(mid.x, mid.y);
    await expect.poll(async () => pointsOf((await collision(page))[1]!).length).toBe(4);
    shapes = await collision(page);
    expect(pointsOf(shapes[1]!)).toEqual([
        [2, 9],
        [6, 9],
        [10, 9],
        [6, 16],
    ]);
    const added = shapes;
    await undoRedo(page, added, dragged);

    // Delete removes the selected point; never below three.
    await click(page, 6, 9);
    await page.keyboard.press("Delete");
    await expect.poll(() => collision(page)).toEqual(dragged);
    await undoRedo(page, dragged, added);
    await click(page, 2, 9);
    await page.keyboard.press("Delete");
    await expect(message(page)).toHaveText("A polygon keeps at least 3 points.");
    expect(await collision(page)).toEqual(dragged);

    // Delete in the select tool removes the shape.
    await tool(page, "select");
    await click(page, 2.5, 5);
    await page.keyboard.press("Delete");
    await expect.poll(async () => (await collision(page)).length).toBe(1);
    expect((await history(page)).label).toBe("Delete Collision Shape");
    await undoRedo(page, [dragged[1]!], dragged);
});

test("with two tiles selected an edit sets both, one entry", async ({ page }) => {
    await openEditor(page);
    await call(page, "setCollision", [1], [ELLIPSE]);
    await dragTiles(page, [0, 0], [1, 0]);
    await openMenu(page, "Tileset");
    await menuItem(page, "tileset.editCollision").click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).locator("[data-collision-tiles]")).toHaveAttribute(
        "data-collision-tiles",
        "2",
    );
    const start = await history(page);
    await tool(page, "rectangle");
    await drag(page, [2, 2], [6, 5]);
    // The editor shows the tile the selection ends on, tile 1; its list, edited, goes to both.
    await expect.poll(() => collision(page, 0)).toEqual([ELLIPSE, RECT]);
    expect(await collision(page, 1)).toEqual([ELLIPSE, RECT]);
    expect((await history(page)).undo).toBe(start.undo + 1);
    await page.keyboard.press("Control+z");
    await expect.poll(() => collision(page, 0)).toEqual([]);
    expect(await collision(page, 1)).toEqual([ELLIPSE]);
});

test("refuses a 65th shape and a 1025th point", async ({ page }) => {
    await openEditor(page);
    const full = Array.from({ length: 64 }, (_, index) => ({
        ...RECT,
        x: index % 8,
        y: Math.floor(index / 8),
    }));
    await call(page, "setCollision", [0], full);
    const most = await call<Shape>(page, "comb", 1024);
    await call(page, "setCollision", [1], [most]);
    const start = await history(page);

    await openCollision(page, 0, 0);
    await tool(page, "rectangle");
    await drag(page, [10, 10], [14, 14]);
    await expect(message(page)).toHaveText("A tile has at most 64 collision shapes.");
    await tool(page, "polygon");
    await click(page, 10, 10);
    await expect(message(page)).toHaveText("A tile has at most 64 collision shapes.");
    expect((await collision(page)).length).toBe(64);
    await dialog(page).locator("[data-collision-close]").click();
    await expect(dialog(page)).toHaveCount(0);

    // A double click on the polygon's top edge, from (0, 0) to (16, 0).
    await openCollision(page, 1, 0);
    await tool(page, "points");
    await click(page, 8, 6);
    await expect(dialog(page).locator("[data-collision-shape='0']")).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    const edge = await at(page, 8, 0);
    await page.mouse.dblclick(edge.x, edge.y);
    await expect(message(page)).toHaveText("A polygon has at most 1024 points.");
    expect(await call<Shape[]>(page, "collision", 1)).toEqual([most]);
    expect((await history(page)).undo).toBe(start.undo);
});

test("Show Collision outlines a flipped and a rotated tile's shapes; it survives reload", async ({
    page,
}) => {
    const prepare = async () => {
        await openEditor(page);
        await call(page, "setCollision", [0], [{ ...RECT, x: 2, y: 3, width: 4, height: 6 }]);
        // Flipped horizontally at (14, 9), turned 90° clockwise at (16, 9).
        await call(page, "paint", 14, 9, 0, 0b100);
        await call(page, "paint", 16, 9, 0, 0b101);
        await call(page, "setScale", 4);
        await page.mouse.move(0, 0);
    };
    await prepare();
    expect(await call(page, "showCollision")).toMatchObject({ shown: false });
    await openMenu(page, "View");
    await expect(menuItem(page, "view.collision")).toHaveText(/Show Collision/);
    await menuItem(page, "view.collision").click();
    await overlayIdle(page);

    const check = async () => {
        // Flipped: the 4 × 6 rectangle at (2, 3) lands at (10, 3) in the cell at (224, 144).
        const flipped = await call<{ columns: number[]; rows: number[] }>(
            page,
            "accentLines",
            { y: 150, x0: 224, x1: 240 },
            { x: 236, y0: 144, y1: 160 },
        );
        const left = await call<{ x: number; y: number }>(page, "device", 234, 147);
        const right = await call<{ x: number; y: number }>(page, "device", 238, 153);
        expect(flipped.columns).toEqual([left.x, right.x]);
        expect(flipped.rows).toEqual([left.y, right.y]);
        // Turned 90° clockwise: (7, 2), 6 × 4, in the cell at (256, 144).
        const turned = await call<{ columns: number[]; rows: number[] }>(
            page,
            "accentLines",
            { y: 148, x0: 256, x1: 272 },
            { x: 266, y0: 144, y1: 160 },
        );
        const a = await call<{ x: number; y: number }>(page, "device", 263, 146);
        const b = await call<{ x: number; y: number }>(page, "device", 269, 150);
        expect(turned.columns).toEqual([a.x, b.x]);
        expect(turned.rows).toEqual([a.y, b.y]);
    };
    await check();

    await page.reload();
    await prepare();
    expect(await call(page, "showCollision")).toMatchObject({ shown: true });
    await openMenu(page, "View");
    await expect(menuItem(page, "view.collision")).toHaveText(/Hide Collision/);
    await page.keyboard.press("Escape");
    await overlayIdle(page);
    await check();

    // Hide Collision draws nothing.
    await openMenu(page, "View");
    await menuItem(page, "view.collision").click();
    await overlayIdle(page);
    const hidden = await call<{ columns: number[]; rows: number[] }>(
        page,
        "accentLines",
        { y: 150, x0: 224, x1: 240 },
        { x: 236, y0: 144, y1: 160 },
    );
    expect(hidden).toEqual({ columns: [], rows: [] });
});

test("a double click on a tile and the tile menu open the editor on that tile", async ({
    page,
}) => {
    await openEditor(page);
    const tile = await tileClient(page, 2, 0);
    await page.mouse.dblclick(tile.x, tile.y);
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText("Terrain · tile 2");
    await dialog(page).locator("[data-collision-close]").click();
    await expect(dialog(page)).toHaveCount(0);

    await page.getByRole("button", { name: "Tile menu" }).click();
    await page.getByRole("menuitem", { name: "Edit Collision…" }).click();
    await expect(dialog(page)).toContainText("Terrain · tile 2");
});

test("a drag whose last move and release come in one task commits the last move", async ({
    page,
}) => {
    await openEditor(page);
    await openCollision(page);
    await tool(page, "rectangle");
    const from = await at(page, 2, 2);
    const to = await at(page, 6, 5);
    // Down, move and up dispatched together, before the page renders between them.
    await stage(page).evaluate(
        (element, { from, to }) => {
            const send = (type: string, point: { x: number; y: number }, buttons: number) =>
                element.dispatchEvent(
                    new PointerEvent(type, {
                        bubbles: true,
                        pointerId: 1,
                        pointerType: "mouse",
                        isPrimary: true,
                        button: 0,
                        buttons,
                        clientX: point.x,
                        clientY: point.y,
                    }),
                );
            send("pointerdown", from, 1);
            send("pointermove", to, 1);
            send("pointerup", to, 0);
        },
        { from, to },
    );
    await expect.poll(() => collision(page)).toEqual([RECT]);
});

test("snaps to whole pixels unless Ctrl is held; shapes may lie outside the tile", async ({
    page,
}) => {
    await openEditor(page);
    await openCollision(page);
    await tool(page, "rectangle");
    // Snapped: from (−3.375, −2.625) to (2.25, 1.125), partly outside the 16 px tile.
    await drag(page, [-3.375, -2.625], [2.25, 1.125]);
    const outside: Shape = { shape: "rectangle", x: -3, y: -3, width: 5, height: 4 };
    await expect.poll(() => collision(page)).toEqual([outside]);
    // Ctrl held: the pointer's own position, at the zoom's 1/8 px.
    await page.keyboard.down("Control");
    await drag(page, [10.5, 10.5], [12.25, 13.75]);
    await page.keyboard.up("Control");
    await expect
        .poll(() => collision(page))
        .toEqual([outside, { shape: "rectangle", x: 10.5, y: 10.5, width: 1.75, height: 3.25 }]);
    // With Snap off, Ctrl snaps.
    await dialog(page).locator("[data-collision-snap]").click();
    await page.keyboard.down("Control");
    await drag(page, [4.375, 4.625], [6.25, 7.875]);
    await page.keyboard.up("Control");
    await expect
        .poll(async () => (await collision(page))[2])
        .toEqual({
            shape: "rectangle",
            x: 4,
            y: 5,
            width: 2,
            height: 3,
        });
});

test("a rectangle of size 0 grows from its handle toward the bottom right", async ({ page }) => {
    await openEditor(page);
    // Size 0 is a valid size (FORMAT §1.5); the fields or a resize can reach it.
    await call(
        page,
        "setCollision",
        [0],
        [{ shape: "rectangle", x: 4, y: 4, width: 0, height: 0 }],
    );
    await openCollision(page);
    await tool(page, "select");
    await dialog(page).locator("[data-collision-shape='0']").click();
    await drag(page, [4, 4], [8, 7]);
    await expect
        .poll(() => collision(page))
        .toEqual([{ shape: "rectangle", x: 4, y: 4, width: 4, height: 3 }]);
    expect((await history(page)).label).toBe("Resize Collision Shape");
});
