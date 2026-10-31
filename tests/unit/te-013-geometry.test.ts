import { describe, expect, it } from "vitest";
import {
    deviceScale,
    intersect,
    layerShift,
    toDevice,
    visibleRect,
} from "../../src/engine/viewport/geometry";

// TE-013: the viewport's camera (ENGINE §4) and the layer shift of FORMAT §3.4.

describe("camera", () => {
    it("scales CSS zoom by the device pixel ratio", () => {
        expect(deviceScale(2, 1.25)).toBe(2.5);
        expect(deviceScale(1 / 32, 1)).toBe(1 / 32);
    });

    it("shows the view centre in the middle of the canvas", () => {
        const camera = { centreX: 100, centreY: 50, scale: 2 };
        const size = { width: 400, height: 200 };
        expect(visibleRect(camera, size)).toEqual({ x: 0, y: 0, width: 200, height: 100 });
        expect(toDevice(camera, size, 100, 50)).toEqual({ x: 200, y: 100 });
        expect(toDevice(camera, size, 0, 0)).toEqual({ x: 0, y: 0 });
    });

    it("maps the visible rectangle's corners to the canvas corners", () => {
        const camera = { centreX: 33.5, centreY: -7.25, scale: 1.25 };
        const size = { width: 1215, height: 530 };
        const rect = visibleRect(camera, size);
        const topLeft = toDevice(camera, size, rect.x, rect.y);
        const bottomRight = toDevice(camera, size, rect.x + rect.width, rect.y + rect.height);
        expect(topLeft.x).toBeCloseTo(0, 9);
        expect(topLeft.y).toBeCloseTo(0, 9);
        expect(bottomRight.x).toBeCloseTo(1215, 9);
        expect(bottomRight.y).toBeCloseTo(530, 9);
    });
});

describe("layer shift", () => {
    const origin = { parallaxOriginX: 10, parallaxOriginY: -20 };
    const camera = { centreX: 110, centreY: 80 };

    it("is the offset for a layer that moves with the map", () => {
        const layer = { offsetX: 3, offsetY: -2, parallaxX: 1, parallaxY: 1 };
        expect(layerShift(origin, camera, layer)).toEqual({ x: 3, y: -2 });
    });

    it("follows the view centre by 1 − parallax (FORMAT §3.4)", () => {
        const layer = { offsetX: 3, offsetY: -2, parallaxX: 0.5, parallaxY: 0 };
        // x: 3 + (110 − 10) × 0.5; y: −2 + (80 − −20) × 1
        expect(layerShift(origin, camera, layer)).toEqual({ x: 53, y: 98 });
    });

    it("keeps a layer fixed on screen with parallax 0", () => {
        const layer = { offsetX: 0, offsetY: 0, parallaxX: 0, parallaxY: 0 };
        const shift = layerShift(origin, camera, layer);
        // Its map position plus the shift, relative to the view centre, does not change.
        expect(shift.x - camera.centreX).toBe(-origin.parallaxOriginX);
        expect(shift.y - camera.centreY).toBe(-origin.parallaxOriginY);
    });
});

describe("intersect", () => {
    it("returns the overlap", () => {
        expect(
            intersect(
                { x: 0, y: 0, width: 10, height: 10 },
                { x: 5, y: -5, width: 10, height: 10 },
            ),
        ).toEqual({ x: 5, y: 0, width: 5, height: 5 });
    });

    it("returns null for rectangles that only touch or are apart", () => {
        const a = { x: 0, y: 0, width: 10, height: 10 };
        expect(intersect(a, { x: 10, y: 0, width: 5, height: 5 })).toBeNull();
        expect(intersect(a, { x: 20, y: 20, width: 5, height: 5 })).toBeNull();
    });
});
