import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createViewMapping } from "../../src/app/view/coordinates";
import {
    MIN_VISIBLE,
    clampView,
    fitView,
    originOf,
    panView,
    scaleOf,
    zoomView,
} from "../../src/app/view/navigate";
import type { NavigationContext } from "../../src/app/view/navigate";
import {
    KEY_ZOOMS,
    MAX_ZOOM,
    MIN_ZOOM,
    ZOOM_STEPS,
    fitZoom,
    zoomStep,
    zoomStepAbove,
    zoomStepBelow,
} from "../../src/app/view/zoom";

// View navigation (TE-014): zoom steps, pan limits, zoom about a point and Fit.

function context(dpr: number, map = { width: 1024, height: 768 }): NavigationContext {
    return { dpr, size: { width: 1280, height: 720 }, map };
}

/** The view of scale `scale` that has the map's corner at `origin`. */
function viewOf(scale: number, origin: { x: number; y: number }, ctx: NavigationContext) {
    return {
        centreX: (ctx.size.width / 2 - origin.x) / scale,
        centreY: (ctx.size.height / 2 - origin.y) / scale,
        zoom: scale / ctx.dpr,
    };
}

function mappingOf(view: ReturnType<typeof viewOf>, ctx: NavigationContext) {
    return createViewMapping({
        view,
        dpr: ctx.dpr,
        size: ctx.size,
        mapWidth: ctx.map.width / 16,
        mapHeight: ctx.map.height / 16,
        tileWidth: 16,
        tileHeight: 16,
        left: 0,
        top: 0,
    });
}

describe("zoom steps", () => {
    it("are the sprite editor's with 1/32 and 1/16 added below", () => {
        expect(ZOOM_STEPS.slice(0, 5)).toEqual([1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2]);
        expect(ZOOM_STEPS[ZOOM_STEPS.length - 1]).toBe(64);
        expect(MIN_ZOOM).toBe(1 / 32);
        expect(MAX_ZOOM).toBe(64);
        expect([...ZOOM_STEPS].sort((a, b) => a - b)).toEqual([...ZOOM_STEPS]);
        expect(KEY_ZOOMS).toEqual([1, 2, 4, 8, 16, 32]);
    });

    it("step up and down from a step and from between two", () => {
        expect(zoomStepAbove(1)).toBe(2);
        expect(zoomStepBelow(1)).toBe(1 / 2);
        expect(zoomStepAbove(7)).toBe(8);
        expect(zoomStepBelow(7)).toBe(6);
        expect(zoomStepBelow(MIN_ZOOM)).toBe(MIN_ZOOM);
        expect(zoomStepAbove(MAX_ZOOM)).toBe(MAX_ZOOM);
        expect(zoomStep(1 / 16, -1)).toBe(1 / 32);
        expect(zoomStep(1 / 32, 1)).toBe(1 / 16);
    });

    it("take a scale within rounding of a step as that step", () => {
        // 0.8 × 1.25 need not be 1.
        const scale = 0.8 * 1.25 + 1e-15;
        expect(zoomStepAbove(scale)).toBe(2);
        expect(zoomStepBelow(scale)).toBe(1 / 2);
    });

    it("fit the largest step at which the map fits", () => {
        expect(fitZoom(1024, 768, 1280, 720)).toBe(0.5);
        expect(fitZoom(100, 100, 1280, 720)).toBe(6);
        expect(fitZoom(100000, 100000, 1280, 720)).toBe(MIN_ZOOM);
    });
});

describe("zoomView", () => {
    for (const dpr of [1, 1.25]) {
        const ctx = context(dpr);

        it(`keeps the map pixel under the anchor between steps of 1 and above at ratio ${dpr}`, () => {
            const steps = ZOOM_STEPS.filter((each) => each >= 1);
            fc.assert(
                fc.property(
                    fc.constantFrom(...steps),
                    fc.constantFrom(...steps),
                    fc.integer({ min: 0, max: 1279 }),
                    fc.integer({ min: 0, max: 719 }),
                    fc.integer({ min: -300, max: 300 }),
                    fc.integer({ min: -300, max: 300 }),
                    (from, to, ax, ay, ox, oy) => {
                        const view = clampView(viewOf(from, { x: ox, y: oy }, ctx), ctx);
                        const before = mappingOf(view, ctx).deviceToMap(ax, ay);
                        const next = zoomView(view, to, { x: ax, y: ay }, ctx);
                        const after = mappingOf(next, ctx).deviceToMap(ax, ay);
                        // The map pixel under the anchor is the same one, unless the pan limit
                        // had to move the view.
                        const moved = originOf(next, ctx);
                        const limit = clampView(next, ctx);
                        expect(limit).toBe(next);
                        if (
                            moved.x > -ctx.map.width * to + MIN_VISIBLE &&
                            moved.x < ctx.size.width - MIN_VISIBLE &&
                            moved.y > -ctx.map.height * to + MIN_VISIBLE &&
                            moved.y < ctx.size.height - MIN_VISIBLE
                        ) {
                            expect(Math.floor(after.x)).toBe(Math.floor(before.x));
                            expect(Math.floor(after.y)).toBe(Math.floor(before.y));
                        }
                    },
                ),
                { numRuns: 300 },
            );
        });

        it(`keeps the map position under the anchor through the overview steps at ratio ${dpr}`, () => {
            const view = viewOf(1 / 4, { x: 300, y: 200 }, ctx);
            const anchor = { x: 640.5, y: 300.25 };
            const before = mappingOf(view, ctx).deviceToMap(anchor.x, anchor.y);
            for (const to of [1 / 8, 1 / 16, 1 / 32, 1 / 2]) {
                const next = zoomView(view, to, anchor, ctx);
                const after = mappingOf(next, ctx).deviceToMap(anchor.x, anchor.y);
                expect(after.x).toBeCloseTo(before.x, 6);
                expect(after.y).toBeCloseTo(before.y, 6);
            }
        });
    }

    it("returns the same view for the zoom it has", () => {
        const ctx = context(1.25);
        const view = clampView(viewOf(4, { x: 100, y: 100 }, ctx), ctx);
        expect(zoomView(view, 4, { x: 10, y: 10 }, ctx)).toBe(view);
    });

    it("puts the map corner on a whole device pixel from the steps of 1 up", () => {
        for (const dpr of [1, 1.25]) {
            const ctx = context(dpr);
            const view = zoomView(viewOf(1, { x: 100.5, y: 40.25 }, ctx), 3, { x: 7, y: 9 }, ctx);
            const origin = originOf(view, ctx);
            expect(origin.x).toBeCloseTo(Math.round(origin.x), 6);
            expect(origin.y).toBeCloseTo(Math.round(origin.y), 6);
            expect(scaleOf(view, ctx)).toBeCloseTo(3, 9);
        }
    });
});

describe("panView and clampView", () => {
    const ctx = context(1);

    it("moves the view by device pixels", () => {
        const view = viewOf(2, { x: 100, y: 100 }, ctx);
        const next = panView(view, 30, -20, ctx);
        expect(originOf(next, ctx).x).toBeCloseTo(130, 9);
        expect(originOf(next, ctx).y).toBeCloseTo(80, 9);
    });

    it("keeps at least 32 device pixels of the map visible", () => {
        const view = viewOf(2, { x: 0, y: 0 }, ctx);
        const far = panView(view, 100000, 100000, ctx);
        expect(originOf(far, ctx)).toEqual({
            x: ctx.size.width - MIN_VISIBLE,
            y: ctx.size.height - MIN_VISIBLE,
        });
        const gone = panView(view, -100000, -100000, ctx);
        expect(originOf(gone, ctx)).toEqual({
            x: MIN_VISIBLE - ctx.map.width * 2,
            y: MIN_VISIBLE - ctx.map.height * 2,
        });
    });

    it("returns the view it was given when nothing changes", () => {
        const view = clampView(viewOf(2, { x: 100, y: 100 }, ctx), ctx);
        expect(panView(view, 0, 0, ctx)).toBe(view);
        expect(clampView(view, ctx)).toBe(view);
    });

    it("limits nothing without a viewport size", () => {
        const none = { ...ctx, size: { width: 0, height: 0 } };
        const view = { centreX: 5000, centreY: 5000, zoom: 1 };
        expect(clampView(view, none)).toBe(view);
    });

    it("lets a map smaller than the margin stay visible in full", () => {
        const small = context(1, { width: 16, height: 16 });
        const far = panView(viewOf(1, { x: 0, y: 0 }, small), 100000, 0, small);
        expect(originOf(far, small).x).toBe(small.size.width - 16);
    });
});

describe("fitView", () => {
    for (const dpr of [1, 1.25]) {
        it(`shows the whole map, centred, at ratio ${dpr}`, () => {
            const ctx = context(dpr);
            const view = fitView(ctx);
            expect(scaleOf(view, ctx)).toBeCloseTo(0.5, 9);
            const origin = originOf(view, ctx);
            expect(origin.x).toBeCloseTo((1280 - 512) / 2, 9);
            expect(origin.y).toBeCloseTo((720 - 384) / 2, 9);
            // The map centre is the view centre.
            expect(view.centreX).toBeCloseTo(512, 9);
            expect(view.centreY).toBeCloseTo(384, 9);
        });
    }

    it("puts the corner of a map that fits at a step of 1 or more on a whole pixel", () => {
        const ctx = context(1.25, { width: 101, height: 77 });
        const view = fitView(ctx);
        // 77 × 8 = 616 ≤ 720 < 77 × 10; 101 × 8 = 808 ≤ 1280.
        expect(scaleOf(view, ctx)).toBeCloseTo(8, 9);
        const origin = originOf(view, ctx);
        expect(origin.x).toBeCloseTo(Math.round(origin.x), 6);
        expect(origin.y).toBeCloseTo(Math.round(origin.y), 6);
    });
});
