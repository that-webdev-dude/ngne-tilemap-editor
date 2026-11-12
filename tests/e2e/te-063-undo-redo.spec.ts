import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { ToolState } from "./harness/te-063-tools";
import { collectErrors } from "./te-003-support";
import { expect, openEditor } from "./te-014-support";

// TE-063: paint, undo, redo for every tool that changes the map (SPEC §15, E2E row), each with
// the real pointer and Ctrl+Z / Ctrl+Y. The project is harness/te-063-tools.ts's. A tool's act
// must change the project or a selection; Ctrl+Z gives back the state before it, exactly (the
// project's `.ngtilemap` bytes and both selections), and Ctrl+Y the state after it. The one
// exception is the map's `nextMarkerId`, which undo does not give back (SPEC §7.2, as Tiled).

const PAGE_MODULE = "/tests/e2e/harness/te-063-tools.ts";
const SIZE = 16;
const LAYERS = { ground: 1, paths: 2, areas: 3 } as const;

function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

const snapshot = (page: Page) => call<ToolState>(page, "snapshot");
const history = (page: Page) => call<{ undo: string | null; redo: string | null }>(page, "history");

type Point = [number, number];

/** Map pixel of the centre of cell `(x, y)`. */
const cell = (x: number, y: number): Point => [(x + 0.5) * SIZE, (y + 0.5) * SIZE];

async function moveTo(page: Page, [x, y]: Point): Promise<void> {
    const at = await call<{ x: number; y: number }>(page, "mapClient", x, y);
    await page.mouse.move(at.x, at.y, { steps: 1 });
}

async function click(page: Page, point: Point): Promise<void> {
    await moveTo(page, point);
    await page.mouse.down();
    await page.mouse.up();
}

/** Drags through `points`, pressed at the first and released at the last. */
async function drag(page: Page, ...points: Point[]): Promise<void> {
    await moveTo(page, points[0]!);
    await page.mouse.down();
    for (const point of points.slice(1)) await moveTo(page, point);
    await page.mouse.up();
}

interface ToolCase {
    tool: string;
    layer: number;
    /** The history label of the act. */
    label: string;
    /**
     * Prepares the tool once it is selected (a stamp, a context bar choice, a marker selected
     * with the tool itself, which is no history entry).
     */
    prepare?: (page: Page) => Promise<void>;
    act: (page: Page) => Promise<void>;
}

/** The swatch of terrain 1 in the context bar `bar` ("terrain-brush" or "fill"). */
const terrainSwatch = (page: Page, bar = "terrain-brush") =>
    page.locator(`[data-context-content="${bar}"] [data-terrain-swatch="1"]`);

const CASES: ToolCase[] = [
    {
        tool: "stamp",
        layer: LAYERS.ground,
        label: "Stamp Brush",
        prepare: (page) => call(page, "setStamp", 5),
        act: (page) => drag(page, cell(2, 2), cell(4, 2), cell(6, 3)),
    },
    {
        tool: "eraser",
        layer: LAYERS.ground,
        label: "Eraser",
        act: (page) => drag(page, cell(2, 4), cell(5, 4), cell(12, 6)),
    },
    {
        tool: "bucket",
        layer: LAYERS.ground,
        label: "Bucket Fill",
        prepare: (page) => call(page, "setStamp", 5),
        act: (page) => click(page, cell(3, 9)),
    },
    {
        tool: "shapeFill",
        layer: LAYERS.ground,
        label: "Rectangle Fill",
        prepare: (page) => call(page, "setStamp", 5),
        act: (page) => drag(page, cell(1, 1), cell(3, 2), cell(5, 4)),
    },
    {
        tool: "shapeFillEllipse",
        layer: LAYERS.ground,
        label: "Ellipse Fill",
        prepare: (page) => call(page, "setStamp", 5),
        act: (page) => drag(page, cell(1, 1), cell(5, 4), cell(9, 7)),
    },
    {
        tool: "terrain",
        layer: LAYERS.paths,
        label: "Terrain Brush",
        prepare: async (page) => {
            await terrainSwatch(page).click();
            await expect(terrainSwatch(page)).toHaveAttribute("aria-pressed", "true");
        },
        act: (page) => drag(page, [5.25 * SIZE, 5.25 * SIZE], [8.25 * SIZE, 5.25 * SIZE]),
    },
    {
        tool: "bucket",
        layer: LAYERS.paths,
        label: "Bucket Fill",
        // The terrain fill mode of TE-045: the region filled with the terrain.
        prepare: async (page) => {
            const mode = page
                .locator('[data-tool-option="fillMode"]')
                .getByRole("radio", { name: "Terrain" });
            await mode.click();
            await expect(mode).toBeChecked();
            await terrainSwatch(page, "fill").click();
            await expect(terrainSwatch(page, "fill")).toHaveAttribute("aria-pressed", "true");
        },
        act: (page) => click(page, cell(4, 4)),
    },
    {
        tool: "shapeFill",
        layer: LAYERS.paths,
        label: "Rectangle Fill",
        // The terrain fill mode of TE-045: the rectangle filled with the terrain.
        prepare: async (page) => {
            const mode = page
                .locator('[data-tool-option="fillMode"]')
                .getByRole("radio", { name: "Terrain" });
            await mode.click();
            await expect(mode).toBeChecked();
            await terrainSwatch(page, "fill").click();
            await expect(terrainSwatch(page, "fill")).toHaveAttribute("aria-pressed", "true");
        },
        act: (page) => drag(page, cell(2, 2), cell(4, 3), cell(6, 5)),
    },
    {
        tool: "rectSelect",
        layer: LAYERS.ground,
        label: "Rectangle Select",
        act: (page) => drag(page, cell(2, 2), cell(6, 5)),
    },
    {
        tool: "wand",
        layer: LAYERS.ground,
        label: "Magic Wand",
        act: (page) => click(page, cell(14, 5)),
    },
    {
        tool: "sameTile",
        layer: LAYERS.ground,
        label: "Select Same Tile",
        act: (page) => click(page, cell(3, 3)),
    },
    {
        tool: "markerRectangle",
        layer: LAYERS.areas,
        label: "Add Marker",
        act: (page) => drag(page, [32, 160], [64, 180], [96, 208]),
    },
    {
        tool: "markerEllipse",
        layer: LAYERS.areas,
        label: "Add Marker",
        act: (page) => drag(page, [32, 160], [64, 180], [96, 208]),
    },
    {
        tool: "markerPoint",
        layer: LAYERS.areas,
        label: "Add Marker",
        act: (page) => click(page, [240, 64]),
    },
    {
        tool: "markerPolygon",
        layer: LAYERS.areas,
        label: "Add Marker",
        act: async (page) => {
            for (const point of [
                [208, 32],
                [272, 32],
                [272, 96],
            ] as Point[])
                await click(page, point);
            await page.keyboard.press("Enter");
        },
    },
    {
        tool: "markerPolyline",
        layer: LAYERS.areas,
        label: "Add Marker",
        act: async (page) => {
            for (const point of [
                [208, 160],
                [272, 176],
            ] as Point[])
                await click(page, point);
            await page.keyboard.press("Enter");
        },
    },
    {
        tool: "markerSelect",
        layer: LAYERS.areas,
        label: "Move Marker",
        // The rectangle (160, 128, 48 × 32) clicked, then dragged two cells right and one down.
        prepare: (page) => click(page, [184, 144]),
        act: (page) => drag(page, [184, 144], [200, 152], [216, 160]),
    },
    {
        tool: "editPoints",
        layer: LAYERS.areas,
        label: "Edit Marker Points",
        // The polygon chosen by a click inside it, then its point (96, 32) dragged a cell right.
        prepare: (page) => click(page, [80, 48]),
        act: (page) => drag(page, [96, 32], [104, 32], [112, 32]),
    },
];

/** The fill cases on Paths use the terrain fill mode; their titles say so. */
const fillMode = (layer: number) => (layer === LAYERS.paths ? " (terrain fill)" : "");

for (const { tool, layer, label, prepare, act } of CASES) {
    const mode = tool.startsWith("bucket") || tool.startsWith("shapeFill") ? fillMode(layer) : "";
    test(`${tool}${mode}: the act, Ctrl+Z gives the state before it back, Ctrl+Y the state after`, async ({
        page,
    }) => {
        const errors = collectErrors(page);
        await openEditor(page);
        await call(page, "load", layer);
        await expect.poll(() => call(page, "selectTool", tool)).toBe(true);
        expect(await call(page, "activeTool")).toBe(tool);
        await prepare?.(page);
        expect(await history(page)).toEqual({ undo: null, redo: null });
        const before = await snapshot(page);

        await act(page);
        await expect.poll(() => history(page)).toEqual({ undo: label, redo: null });
        const after = await snapshot(page);
        expect(after).not.toEqual(before);

        await page.keyboard.press("Control+KeyZ");
        await expect.poll(() => history(page)).toEqual({ undo: null, redo: label });
        expect(await snapshot(page)).toEqual({ ...before, nextMarkerId: after.nextMarkerId });

        await page.keyboard.press("Control+KeyY");
        await expect.poll(() => history(page)).toEqual({ undo: label, redo: null });
        // A create tool selects the marker it makes; the history does not, as its commands
        // restore the marker selection only where they remove markers (markerCommands.ts), and
        // as in Tiled, whose redo of an added object leaves the selection alone.
        const created = label === "Add Marker";
        expect(await snapshot(page)).toEqual(created ? { ...after, markers: [] } : after);
        expect(errors).toEqual([]);
    });
}
