import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createViewMapping } from "../../src/app/view/coordinates";
import type { ViewFrame } from "../../src/app/view/coordinates";
import { ZOOM_STEPS } from "../../src/app/view/zoom";

// Coordinate mapping of the viewport (TE-014): client ↔ device ↔ map ↔ cell, at every zoom
// step and the device pixel ratios 1 and 1.25.

const RATIOS = [1, 1.25];

/** A frame whose zoom is `step` device pixels per map pixel at `dpr`, as navigation stores it. */
function frameOf(step: number, dpr: number, over: Partial<ViewFrame> = {}): ViewFrame {
    return {
        view: { centreX: 512, centreY: 384, zoom: step / dpr },
        dpr,
        size: { width: 1280, height: 720 },
        mapWidth: 64,
        mapHeight: 48,
        tileWidth: 16,
        tileHeight: 16,
        left: 264,
        top: 56,
        ...over,
    };
}

const step = fc.constantFrom(...ZOOM_STEPS);
const ratio = fc.constantFrom(...RATIOS);
const client = fc.record({
    x: fc.double({ min: 264, max: 1544, noNaN: true }),
    y: fc.double({ min: 56, max: 776, noNaN: true }),
});
const centre = fc.record({
    centreX: fc.double({ min: -2000, max: 4000, noNaN: true }),
    centreY: fc.double({ min: -2000, max: 4000, noNaN: true }),
});

describe("view mapping", () => {
    it("round-trips screen → map → screen at every zoom step and ratio", () => {
        fc.assert(
            fc.property(step, ratio, centre, client, (s, dpr, c, point) => {
                const mapping = createViewMapping(
                    frameOf(s, dpr, { view: { ...c, zoom: s / dpr } }),
                );
                const map = mapping.clientToMap(point.x, point.y);
                const back = mapping.mapToClient(map.x, map.y);
                // Within the 1/128 of a device pixel that is taken as a whole one (`settle`).
                expect(Math.abs(back.x - point.x) * dpr).toBeLessThanOrEqual(1 / 128 + 1e-6);
                expect(Math.abs(back.y - point.y) * dpr).toBeLessThanOrEqual(1 / 128 + 1e-6);
            }),
            { numRuns: 500 },
        );
    });

    it("round-trips device → map → device exactly enough", () => {
        fc.assert(
            fc.property(
                step,
                ratio,
                fc.double({ min: 0, max: 1280, noNaN: true }),
                fc.double({ min: 0, max: 720, noNaN: true }),
                (s, dpr, x, y) => {
                    const mapping = createViewMapping(frameOf(s, dpr));
                    const map = mapping.deviceToMap(x, y);
                    const device = mapping.mapToDevice(map.x, map.y);
                    expect(device.x).toBeCloseTo(x, 6);
                    expect(device.y).toBeCloseTo(y, 6);
                },
            ),
        );
    });

    it("maps the cell corners back to their cells at every step", () => {
        fc.assert(
            fc.property(
                step,
                ratio,
                fc.integer({ min: -4, max: 70 }),
                fc.integer({ min: -4, max: 52 }),
                (s, dpr, cx, cy) => {
                    const mapping = createViewMapping(frameOf(s, dpr));
                    const corner = mapping.cellToDevice(cx, cy);
                    // The middle of the cell is in it, whatever the rounding of the corner.
                    const half = (16 * s) / 2;
                    expect(mapping.deviceToCell(corner.x + half, corner.y + half)).toEqual({
                        x: cx,
                        y: cy,
                    });
                },
            ),
        );
    });

    it("centres the view centre in the canvas", () => {
        for (const dpr of RATIOS) {
            const mapping = createViewMapping(frameOf(2, dpr));
            expect(mapping.mapToDevice(512, 384)).toEqual({ x: 640, y: 360 });
            expect(mapping.deviceToMap(640, 360)).toEqual({ x: 512, y: 384 });
        }
    });

    it("scales by zoom × ratio", () => {
        expect(createViewMapping(frameOf(4, 1.25)).scale).toBeCloseTo(4, 12);
        const view = { centreX: 0, centreY: 0, zoom: 2 };
        expect(createViewMapping(frameOf(1, 1.25, { view })).scale).toBe(2.5);
    });

    it("gives whole cells, also outside the map, and no negative zero", () => {
        const mapping = createViewMapping(
            frameOf(1, 1, { view: { centreX: 0, centreY: 0, zoom: 1 } }),
        );
        // Device (640, 360) is map (0, 0): the cell (0, 0), not (-0, -0).
        const cell = mapping.deviceToCell(640, 360);
        expect(Object.is(cell.x, 0)).toBe(true);
        expect(Object.is(cell.y, 0)).toBe(true);
        expect(mapping.deviceToCell(639, 359)).toEqual({ x: -1, y: -1 });
        expect(mapping.contains({ x: -1, y: 0 })).toBe(false);
        expect(mapping.contains({ x: 63, y: 47 })).toBe(true);
        expect(mapping.contains({ x: 64, y: 0 })).toBe(false);
    });

    it("takes a pointer position within 1/128 of a device pixel as that pixel", () => {
        // Chrome reports device pixel 102 at a ratio of 1.25 as 81.5999984741211 CSS pixels.
        const mapping = createViewMapping(frameOf(1, 1.25, { left: 0, top: 0 }));
        expect(mapping.clientToDevice(81.5999984741211, 0).x).toBe(102);
    });
});
