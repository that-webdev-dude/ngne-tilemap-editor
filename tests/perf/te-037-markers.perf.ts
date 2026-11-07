import { describe, expect, it } from "vitest";
import type { PanRecord, Prepared } from "./harness/te-037-markers";
import { WINDOW, gpu, openApp } from "./browser";
import { record } from "./record";

// TE-037 and SPEC §8: 2,000 markers on the reference map redraw within the pan budget of ENGINE §6:
// animation-frame callback start → submit, p95 ≤ 10 ms, here with the overlay's redraw of the
// markers in the same callback (callback start → overlay drawn); and frames more than 25 ms after
// the one before ≤ 1% of the pan, in `details` (the overlay's raster runs after the callback).
// Two views, 1920 × 1080 at DPR 1: the live-tier threshold of TE-013's pan (names hidden) and zoom
// 1.25, where every marker also draws its name chip. All 2,000 markers are in view throughout.
// Run alone on the reference machine, one GPU and one view at a time (tests/perf/README.md):
//
//     PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-037-markers.perf.ts
//     PERF_GPU=rtx-4060  npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-037-markers.perf.ts
//
// Without PERF_GPU the benchmark is skipped. Each view records one result; with a `PERF_ID`, run
// one view with `-t`.

const PAN_MS = 5000;
const WARMUP_MS = 1000;
const BUDGET_MS = 10;
const DROPPED_INTERVAL_MS = 25;
const DROPPED_FRACTION = 0.01;

function percentile(sorted: number[], fraction: number): number {
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

const sortedOf = (values: number[]) => [...values].sort((a, b) => a - b);

const describeBrowser = gpu ? describe : describe.skip;

describeBrowser("te-037 markers", () => {
    const views = [
        { label: "threshold", zoom: null, names: false },
        { label: "names", zoom: 1.25, names: true },
    ] as const;
    for (const view of views) {
        it(`pans with 2,000 markers, ${view.label} view`, async () => {
            const run = await openApp(1);
            try {
                const call = <T>(name: string, ...args: unknown[]) =>
                    run.page.evaluate<T>(
                        `import("/tests/perf/harness/te-037-markers.ts").then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
                    );
                const prepared = await call<Prepared>("prepare", view.zoom);
                expect(prepared.markers).toBe(2000);
                if (view.zoom === null) {
                    expect(prepared.sprites).toBeGreaterThan(55_000);
                    expect(prepared.sprites).toBeLessThan(80_000);
                }
                await call<PanRecord>("pan", WARMUP_MS);
                const pan = await call<PanRecord>("pan", PAN_MS);

                const frames = sortedOf(pan.frameMs);
                const overlay = sortedOf(pan.overlayMs);
                const submit = sortedOf(pan.submitMs);
                const dropped = pan.intervalMs.filter((ms) => ms > DROPPED_INTERVAL_MS).length;
                const where = `${gpu!.label}, window ${WINDOW.width} × ${WINDOW.height}, DPR 1, canvas ${prepared.canvas.join(" × ")}, zoom ${prepared.zoom.toFixed(3)}`;
                record({
                    id: `te-037-markers-pan-${view.label}`,
                    ticket: "TE-037",
                    measurement:
                        `Pan of the reference map (${prepared.sprites} sprites) with 2,000 markers in view` +
                        `${view.names ? ", names shown" : ""}: frame callback start to the overlay's redraw after the submit; ${where}`,
                    statistic: `p95 of ${pan.frameMs.length} frames of a ${PAN_MS / 1000} s pan after ${WARMUP_MS / 1000} s warm-up`,
                    budgetMs: BUDGET_MS,
                    resultMs: percentile(frames, 0.95),
                    details: {
                        adapter: run.adapter,
                        medianMs: percentile(frames, 0.5),
                        maxMs: frames[frames.length - 1],
                        overlayP95Ms: percentile(overlay, 0.95),
                        overlayMedianMs: percentile(overlay, 0.5),
                        submitP95Ms: percentile(submit, 0.95),
                        frames: pan.frameMs.length,
                        droppedFrames: dropped,
                        droppedBudget: Math.floor(pan.intervalMs.length * DROPPED_FRACTION),
                        intervals: pan.intervalMs.length,
                        rasterPaints: pan.rasterPaints,
                        zoom: prepared.zoom,
                        names: view.names,
                    },
                });
            } finally {
                await run.close();
            }
        });
    }
});
