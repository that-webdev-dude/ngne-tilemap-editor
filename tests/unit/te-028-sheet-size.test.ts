import { describe, expect, it } from "vitest";
import {
    MAX_CANVAS_AREA,
    MAX_CANVAS_SIDE,
    sheetBacking,
    sheetLayout,
} from "../../src/ui/tilesets/update/sheetBacking";

// The dialog draws every tile at 32 px on its longer side (PICTURE), whatever the tile size.
const CELL = 32;

function backingOf(count: number, dpr: number) {
    const layout = sheetLayout(count, CELL, CELL);
    return { layout, backing: sheetBacking(layout.width, layout.height, dpr) };
}

function fits(width: number, height: number): boolean {
    return (
        width <= MAX_CANVAS_SIDE && height <= MAX_CANVAS_SIDE && width * height <= MAX_CANVAS_AREA
    );
}

describe("TE-028 source sheet backing store", () => {
    it.each([65536, 61601])("keeps %i entries at dpr 2 within the canvas limits", (count) => {
        const { backing } = backingOf(count, 2);
        expect(fits(backing.width, backing.height)).toBe(true);
        expect(backing.scale).toBeLessThanOrEqual(2);
    });

    it("keeps the full device pixel ratio when the sheet fits", () => {
        for (const dpr of [2, 1.25, 1]) {
            const { layout, backing } = backingOf(100, dpr);
            expect(backing.scale).toBe(dpr);
            expect(backing.width).toBe(Math.round(layout.width * dpr));
            expect(backing.height).toBe(Math.round(layout.height * dpr));
        }
    });

    it("goes below scale 1 when the sheet does not fit even at dpr 1", () => {
        const layout = sheetLayout(65536, 64, 64);
        expect(layout.width * layout.height).toBeGreaterThan(MAX_CANVAS_AREA);
        const backing = sheetBacking(layout.width, layout.height, 1);
        expect(fits(backing.width, backing.height)).toBe(true);
        expect(backing.scale).toBeLessThan(1);
    });

    it("clamps no more than needed", () => {
        for (const count of [65536, 61601]) {
            const { layout, backing } = backingOf(count, 2);
            const bigger = backing.scale * 1.01;
            const width = Math.round(layout.width * bigger);
            const height = Math.round(layout.height * bigger);
            expect(fits(width, height)).toBe(false);
        }
    });
});
