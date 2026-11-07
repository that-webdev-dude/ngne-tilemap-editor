import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { expect, openEditor, overlayIdle } from "./te-014-support";
import { menuItem, openMenu } from "./te-007-support";

// TE-037: markers on the overlay (SPEC §8, DESIGN §4). The page module (harness/te-037-page.ts)
// loads a map with a green marker layer holding a rectangle, an ellipse, a polygon, a polyline and
// a point, and a blue marker layer inside a group, at zoom 2. The overlay canvas is read back:
// each shape's outline lies where the shape is, moved by the layer's offset and parallax; closed
// shapes are filled at 15%, a polyline is not; names show on a chip beside the shape above zoom
// 1 only; a hidden layer, or a layer in a hidden group, draws nothing; a colour set in the layer
// properties popover is the colour drawn, and undo puts the old one back.

const PAGE_MODULE = "/tests/e2e/harness/te-037-page.ts";
const GREEN = 0x20e040;
const BLUE = 0x4060ff;
const MAGENTA = 0xe020e0;
const AREAS = 3;
const GROUP = 4;
const INNER = 5;

function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

type Point = [number, number];

/** Map points on the outline of each marker of "Areas". */
const OUTLINES: Record<string, Point[]> = {
    // Rectangle (40, 40) 48 × 24: the middle of each side.
    Door: [
        [40, 52],
        [88, 52],
        [64, 40],
        [64, 64],
    ],
    // Ellipse in (140, 40) 40 × 30: its four extremes.
    Pond: [
        [140, 55],
        [180, 55],
        [160, 40],
        [160, 70],
    ],
    // Polygon (40, 110), (100, 110), (70, 160): the vertices and the middle of the top edge.
    Zone: [
        [40, 110],
        [100, 110],
        [70, 160],
        [70, 110],
    ],
    // Polyline (140, 110), (170, 150), (200, 110).
    Road: [
        [140, 110],
        [170, 150],
        [200, 110],
        [155, 130],
    ],
    // Point (250, 80): the pin's tip, and its head's left edge 8 icon units (5.3 CSS px, at zoom
    // 2 2.7 map px) left of the tip and 12 units (8 CSS px, 4 map px) above it.
    Spawn: [
        [250, 80],
        [250 - (8 * (16 / 24)) / 2, 80 - (12 * (16 / 24)) / 2],
    ],
};

/** Map points a few device pixels off every outline, inside or outside, where nothing is drawn. */
const EMPTY: Point[] = [
    [64, 30], // above the rectangle
    [125, 55], // between the rectangle and the ellipse
    [170, 120], // inside the polyline's V: a polyline is not filled
    [250, 90], // below the pin's tip
    [70, 175], // below the polygon
];

/** Map points inside the closed shapes, away from their outlines: filled at 15%. */
const FILLED: Point[] = [
    [64, 52],
    [160, 55],
    [70, 126],
];

async function load(page: Page): Promise<void> {
    await openEditor(page);
    await call(page, "load");
    await overlayIdle(page);
    // The view at zoom 2 about (170, 130) holds map x 20..330 and y 30..230 on any canvas of
    // this size (DPR 1).
    const size = await call<{ width: number; height: number }>(page, "canvasSize");
    expect(size.width).toBeGreaterThanOrEqual(620);
    expect(size.height).toBeGreaterThanOrEqual(400);
}

async function expectOutlines(page: Page, layer: number, rgb: number, step: string): Promise<void> {
    for (const [name, points] of Object.entries(OUTLINES)) {
        const found = await call<boolean[]>(page, "outlineNear", layer, rgb, points);
        expect(found, `${step}: ${name}`).toEqual(points.map(() => true));
    }
}

async function expectEmpty(page: Page, layer: number, step: string): Promise<void> {
    for (const [x, y] of EMPTY) {
        const pixel = await call<number[]>(page, "pixelAt", layer, x, y);
        expect(pixel[3], `${step}: nothing at (${x}, ${y})`).toBe(0);
    }
}

async function expectFilled(page: Page, layer: number, rgb: number, step: string): Promise<void> {
    for (const [x, y] of FILLED) {
        const [r, g, b, a] = await call<number[]>(page, "pixelAt", layer, x, y);
        // 15% of 255 is 38; the colour is stored premultiplied, so it comes back rounded.
        expect(a, `${step}: fill alpha at (${x}, ${y})`).toBeGreaterThanOrEqual(36);
        expect(a, `${step}: fill alpha at (${x}, ${y})`).toBeLessThanOrEqual(40);
        const expected = [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255];
        [r!, g!, b!].forEach((value, c) =>
            expect(
                Math.abs(value - expected[c]!),
                `${step}: fill colour at (${x}, ${y})`,
            ).toBeLessThanOrEqual(8),
        );
    }
}

test("each shape is drawn at its position, moved by its layer's offset and parallax", async ({
    page,
}) => {
    await load(page);
    await expectOutlines(page, AREAS, GREEN, "zoom 2");
    await expectFilled(page, AREAS, GREEN, "zoom 2");
    await expectEmpty(page, AREAS, "zoom 2");
    expect(
        await call<boolean[]>(page, "outlineNear", INNER, BLUE, [
            [40, 200],
            [80, 200],
            [60, 190],
            [60, 210],
        ]),
    ).toEqual([true, true, true, true]);
    // An outline is no wider than its halo: 1.5 + 2 CSS px across, at zoom 2 under 2 map px.
    expect(await call<boolean[]>(page, "outlineNear", AREAS, GREEN, [[64, 46]], 2)).toEqual([
        false,
    ]);

    // Offset (24, 8) and parallax 0.5 (10 map pixels more at this view): `device` of the page
    // module moves the expected points by `layerShift` as the tile layers are moved (FORMAT §3.4).
    await call(page, "setLayer", AREAS, {
        offsetX: 24,
        offsetY: 8,
        parallaxX: 0.5,
        parallaxY: 0.5,
    });
    await overlayIdle(page);
    await expectOutlines(page, AREAS, GREEN, "offset and parallax");
    await expectFilled(page, AREAS, GREEN, "offset and parallax");
    await expectEmpty(page, AREAS, "offset and parallax");
    // The group's offset adds to its child's.
    await call(page, "setLayer", GROUP, { offsetX: -16, offsetY: 12 });
    await overlayIdle(page);
    expect(
        await call<boolean[]>(page, "outlineNear", INNER, BLUE, [
            [40, 200],
            [80, 200],
        ]),
    ).toEqual([true, true]);
});

test("names show on a chip beside the shape only above zoom 1", async ({ page }) => {
    await load(page);
    const panel = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--bg-panel").trim(),
    );
    const panelRgb = [1, 3, 5].map((at) => parseInt(panel.slice(at, at + 2), 16));
    // The rectangle "Door" ends at x 88, top 40; the point "Spawn"'s pin box ends 8 icon units
    // right of its tip, its chip centred on the head.
    const door = (page: Page) =>
        call<{ pixel: number[]; text: boolean }>(page, "chipAt", AREAS, 88, 40);
    for (const zoom of [2, 1.25]) {
        await call(page, "setZoom", zoom);
        await overlayIdle(page);
        const chip = await door(page);
        // The chip: `--bg-panel` at 80%, with the name in `--text` on it.
        expect(chip.pixel[3], `zoom ${zoom}`).toBeGreaterThanOrEqual(202);
        expect(chip.pixel[3], `zoom ${zoom}`).toBeLessThanOrEqual(206);
        chip.pixel
            .slice(0, 3)
            .forEach((value, c) =>
                expect(
                    Math.abs(value - panelRgb[c]!),
                    `zoom ${zoom} chip colour`,
                ).toBeLessThanOrEqual(2),
            );
        expect(chip.text, `zoom ${zoom} name`).toBe(true);
    }
    for (const zoom of [1, 0.5]) {
        await call(page, "setZoom", zoom);
        await overlayIdle(page);
        const chip = await door(page);
        expect(chip.pixel[3], `zoom ${zoom}: no chip`).toBe(0);
        expect(chip.text, `zoom ${zoom}: no name`).toBe(false);
        // The shapes are still drawn.
        expect(await call<number>(page, "countOutline", GREEN)).toBeGreaterThan(0);
    }
});

test("a hidden marker layer, or one in a hidden group, draws nothing", async ({ page }) => {
    await load(page);
    expect(await call<number>(page, "countOutline", GREEN)).toBeGreaterThan(200);
    expect(await call<number>(page, "countOutline", BLUE)).toBeGreaterThan(50);

    const row = (id: number) => page.locator(`[data-layer-row="${id}"]`);
    await row(AREAS).locator("[data-layer-visible]").click();
    await overlayIdle(page);
    expect(await call<number>(page, "countOutline", GREEN)).toBe(0);
    await expectEmpty(page, AREAS, "hidden");
    for (const [x, y] of FILLED) {
        expect((await call<number[]>(page, "pixelAt", AREAS, x, y))[3], "hidden: no fill").toBe(0);
    }
    expect(await call<number>(page, "countOutline", BLUE)).toBeGreaterThan(50);

    await row(GROUP).locator("[data-layer-visible]").click();
    await overlayIdle(page);
    expect(await call<number>(page, "countOutline", BLUE)).toBe(0);

    await row(AREAS).locator("[data-layer-visible]").click();
    await overlayIdle(page);
    await expectOutlines(page, AREAS, GREEN, "shown again");
    expect(await call<number>(page, "countOutline", BLUE)).toBe(0);
    await row(GROUP).locator("[data-layer-visible]").click();
    await overlayIdle(page);
    expect(await call<number>(page, "countOutline", BLUE)).toBeGreaterThan(50);
    expect(INNER).toBe(5);
});

test("a colour set in the layer properties popover is drawn; undo puts the old one back", async ({
    page,
}) => {
    await load(page);
    await page.locator(`[data-layer-row="${AREAS}"]`).click();
    await openMenu(page, "Layer");
    await menuItem(page, "layer.properties").click();
    const popover = page.locator("[data-layer-properties]");
    await expect(popover).toBeVisible();
    const field = popover.locator("[data-marker-colour]");
    await expect(field).toBeVisible();
    // Only marker layers have the field.
    const hex = field.getByRole("textbox", { name: "Hex" });
    await expect(hex).toHaveValue(/^#?20e040/i);
    await hex.fill("e020e0ff");
    // Enter takes the hex value and applies the popover: one step.
    await hex.press("Enter");
    await expect(popover).toHaveCount(0);
    await overlayIdle(page);
    expect(await call<number>(page, "layerColour", AREAS)).toBe(0xe020e0ff);
    expect(await call<string | null>(page, "undoLabel")).not.toBeNull();
    expect(await call<number>(page, "countOutline", GREEN)).toBe(0);
    await expectOutlines(page, AREAS, MAGENTA, "magenta");
    await expectFilled(page, AREAS, MAGENTA, "magenta");

    await openMenu(page, "Edit");
    await menuItem(page, "edit.undo").click();
    await overlayIdle(page);
    expect(await call<number>(page, "layerColour", AREAS)).toBe(0x20e040ff);
    expect(await call<number>(page, "countOutline", MAGENTA)).toBe(0);
    await expectOutlines(page, AREAS, GREEN, "undone");

    // A tile layer's popover has no colour field.
    await page.locator('[data-layer-row="1"]').click();
    await openMenu(page, "Layer");
    await menuItem(page, "layer.properties").click();
    await expect(popover).toBeVisible();
    await expect(popover.locator("[data-marker-colour]")).toHaveCount(0);
    await page.keyboard.press("Escape");
});
