import { describe, expect, it } from "vitest";
import { MINIMAP_INTERVAL_MS, MinimapRenderer } from "../../src/app/minimap/minimapRenderer";
import type { MinimapContent } from "../../src/app/minimap/minimapRenderer";
import {
    compositeMap,
    compositeThumbnail,
    mapPixels,
    minimapRequest,
    minimapSize,
    minimapToMap,
    minimapViewRect,
} from "../../src/core/compositor";
import type { PixelBuffer } from "../../src/core/model";
import { createConformanceProject } from "../support/conformanceProject";

// TE-057: the minimap's geometry (DESIGN §8.8) and its redraws: whole-map composites in
// slices, at most one redraw per 500 ms after a change, at once for another map or width.

function layersContent(): MinimapContent {
    const project = createConformanceProject();
    const map = project.maps.find((each) => each.exportName === "layers")!;
    return { project, map };
}

describe("the minimap's size and request", () => {
    it("fits the map's longer side to the box width, the other side rounded", () => {
        expect(minimapSize({ width: 4096, height: 4096 }, 248)).toEqual({
            width: 248,
            height: 248,
        });
        expect(minimapSize({ width: 16000, height: 640 }, 248)).toEqual({
            width: 248,
            height: 10,
        });
        expect(minimapSize({ width: 640, height: 16000 }, 248)).toEqual({
            width: 10,
            height: 248,
        });
        // A small map is enlarged; a sliver keeps one pixel.
        expect(minimapSize({ width: 100, height: 50 }, 200)).toEqual({ width: 200, height: 100 });
        expect(minimapSize({ width: 10000, height: 1 }, 200)).toEqual({ width: 200, height: 1 });
        expect(minimapSize({ width: 100, height: 50 }, 0)).toEqual({ width: 0, height: 0 });
    });

    it("samples as a thumbnail does: equal to the thumbnail at the thumbnail's size", () => {
        const { project, map } = layersContent();
        const pixels = mapPixels(map);
        const size = minimapSize(pixels, 128);
        const whole = compositeMap(project, map, minimapRequest(map, size, 0, size.height));
        expect(whole).toEqual(compositeThumbnail(project, map));
    });

    it("composites the same image in bands of rows as in one", () => {
        const { project, map } = layersContent();
        const size = minimapSize(mapPixels(map), 173);
        const whole = compositeMap(project, map, minimapRequest(map, size, 0, size.height));
        const banded = new Uint8ClampedArray(whole.data.length);
        for (let y = 0; y < size.height; y += 7) {
            const rows = Math.min(7, size.height - y);
            const band = compositeMap(project, map, minimapRequest(map, size, y, rows));
            banded.set(band.data, y * size.width * 4);
        }
        expect(banded).toEqual(whole.data);
    });
});

describe("the viewport's rectangle", () => {
    const map = { width: 1000, height: 500 };
    const size = { width: 200, height: 100 };

    it("is the map pixels the viewport shows, scaled to the image", () => {
        // 400 × 300 device pixels at zoom 2, DPR 1: 200 × 150 map pixels round (500, 250).
        const view = { centreX: 500, centreY: 250, zoom: 2 };
        expect(minimapViewRect(view, { width: 400, height: 300 }, 1, map, size)).toEqual({
            x: 80,
            y: 35,
            width: 40,
            height: 30,
        });
        // The same CSS zoom at DPR 1.25 shows fewer map pixels of a viewport of the same device size.
        const scaled = minimapViewRect(view, { width: 500, height: 375 }, 1.25, map, size)!;
        expect(scaled.width).toBeCloseTo(40);
        expect(scaled.height).toBeCloseTo(30);
    });

    it("is clipped to the image, and null off it or without a viewport", () => {
        const view = { centreX: 0, centreY: 0, zoom: 1 };
        expect(minimapViewRect(view, { width: 200, height: 100 }, 1, map, size)).toEqual({
            x: 0,
            y: 0,
            width: 20,
            height: 10,
        });
        const off = { centreX: -500, centreY: 250, zoom: 1 };
        expect(minimapViewRect(off, { width: 200, height: 100 }, 1, map, size)).toBeNull();
        expect(minimapViewRect(view, { width: 0, height: 0 }, 1, map, size)).toBeNull();
    });

    it("maps an image point back to the map", () => {
        expect(minimapToMap(50, 25, map, size)).toEqual({ x: 250, y: 125 });
    });
});

/** A clock, slices and delays the test runs by hand. */
function harness(content: MinimapContent | null) {
    let now = 0;
    const slices: (() => void)[] = [];
    const delays: { at: number; job: () => void }[] = [];
    const images: PixelBuffer[] = [];
    let current = content;
    const renderer = new MinimapRenderer({
        content: () => current,
        onImage: (image) => images.push(image),
        now: () => now,
        slice: (job) => {
            slices.push(job);
            return () => {
                const at = slices.indexOf(job);
                if (at >= 0) slices.splice(at, 1);
            };
        },
        delay: (job, ms) => {
            const entry = { at: now + ms, job };
            delays.push(entry);
            return () => {
                const at = delays.indexOf(entry);
                if (at >= 0) delays.splice(at, 1);
            };
        },
    });
    return {
        renderer,
        images,
        slices,
        set content(value: MinimapContent | null) {
            current = value;
        },
        /** Runs every queued slice, each taking `ms`. */
        drain(ms = 1) {
            while (slices.length > 0) {
                now += ms;
                slices.shift()!();
            }
        },
        /** Moves the clock to `time`, running the delays that fall due. */
        advance(time: number) {
            now = time;
            for (const entry of [...delays]) {
                if (entry.at <= now) {
                    delays.splice(delays.indexOf(entry), 1);
                    entry.job();
                }
            }
        },
        get now() {
            return now;
        },
    };
}

describe("the minimap's redraws", () => {
    it("draws the whole map in slices of rows, then hands the image over once", () => {
        const content = layersContent();
        const run = harness(content);
        run.renderer.setWidth(150);
        expect(run.images).toEqual([]);
        run.drain();
        expect(run.images).toHaveLength(1);
        const size = minimapSize(mapPixels(content.map), 150);
        expect(run.images[0]).toEqual(
            compositeMap(
                content.project,
                content.map,
                minimapRequest(content.map, size, 0, size.height),
            ),
        );
        const stats = run.renderer.stats;
        expect(stats.redraws).toBe(1);
        // The compositor, then more than one band.
        expect(stats.slices).toBeGreaterThan(2);
        expect(stats.busy).toBe(false);
    });

    it("sizes the next band from the last one's time", () => {
        const content = layersContent();
        const run = harness(content);
        run.renderer.setWidth(150);
        // Slow bands: 12 ms each, twice the target, so bands shrink to a row.
        run.drain(12);
        const slow = run.renderer.stats.slices;
        run.renderer.restart();
        run.drain(0.5);
        expect(run.renderer.stats.slices - slow).toBeLessThan(slow);
    });

    it("starts redraws after changes at most once per 500 ms", () => {
        const run = harness(layersContent());
        run.renderer.setWidth(100);
        run.drain();
        expect(run.renderer.stats.starts).toEqual([0]);

        // A change long after: at once.
        run.advance(1000);
        run.renderer.changed();
        run.drain();
        expect(run.renderer.stats.starts).toEqual([0, 1000]);

        // Changes within 500 ms of that start wait for 1500, and make one redraw.
        run.advance(1100);
        run.renderer.changed();
        run.renderer.changed();
        run.advance(1300);
        run.renderer.changed();
        expect(run.slices).toEqual([]);
        run.advance(1000 + MINIMAP_INTERVAL_MS);
        run.drain();
        expect(run.renderer.stats.starts).toEqual([0, 1000, 1500]);
        expect(run.renderer.stats.pending).toBe(false);
        expect(run.images).toHaveLength(3);
    });

    it("finishes a redraw under way before the next, which then waits for the interval", () => {
        const run = harness(layersContent());
        run.renderer.setWidth(100);
        // A change during the redraw.
        run.slices.shift()!();
        run.renderer.changed();
        run.drain();
        expect(run.renderer.stats.starts).toEqual([0]);
        expect(run.renderer.stats.pending).toBe(true);
        run.advance(MINIMAP_INTERVAL_MS);
        run.drain();
        expect(run.renderer.stats.starts).toEqual([0, MINIMAP_INTERVAL_MS]);
        expect(run.images).toHaveLength(2);
    });

    it("redraws at once for another map or width, dropping the redraw under way", () => {
        const run = harness(layersContent());
        run.renderer.setWidth(100);
        run.slices.shift()!();
        run.renderer.setWidth(120);
        run.drain();
        // The first redraw never finished.
        expect(run.images).toHaveLength(1);
        expect(run.images[0]!.width).toBe(120);
        run.content = null;
        run.renderer.restart();
        expect(run.images.at(-1)).toMatchObject({ width: 0, height: 0 });
        // The same width again changes nothing.
        run.renderer.setWidth(120);
        expect(run.images).toHaveLength(2);
    });

    it("stops when disposed", () => {
        const run = harness(layersContent());
        run.renderer.setWidth(100);
        run.renderer.dispose();
        run.drain();
        run.renderer.changed();
        run.advance(10_000);
        run.drain();
        expect(run.images).toEqual([]);
    });
});
