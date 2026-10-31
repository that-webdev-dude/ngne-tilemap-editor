import { describe, expect, it } from "vitest";
import type { PanRecord, Prepared } from "./harness/te-013-pan";
import { WINDOW, gpu, openApp } from "./browser";
import { record } from "./record";

// TE-013 and ENGINE §6: pan at the live-tier threshold (65,536 visible cells over the 8 layers of
// the reference map), 1920 × 1080 at DPR 1 and 1.25. Budgets: animation-frame callback start →
// submit, p95 ≤ 10 ms; frames more than 25 ms after the one before ≤ 1% over a 5 s pan. Run alone
// on the reference machine, one GPU at a time (tests/perf/README.md):
//
//     PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-013-pan.perf.ts
//     PERF_GPU=rtx-4060  npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-013-pan.perf.ts
//
// Without PERF_GPU the benchmark is skipped. The page module (harness/te-013-pan.ts) moves the
// view in each animation-frame callback and submits the frame in it, so the callback's length is
// the cost of a frame. Each ratio records two results; run one at a time with `-t` when a
// `PERF_ID` names the record.

const PAN_MS = 5000;
const WARMUP_MS = 1000;
const SUBMIT_BUDGET_MS = 10;
const DROPPED_INTERVAL_MS = 25;
const DROPPED_FRACTION = 0.01;

function percentile(sorted: number[], fraction: number): number {
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

const describeBrowser = gpu ? describe : describe.skip;

describeBrowser("te-013 pan", () => {
    for (const ratio of [1, 1.25]) {
        const label = ratio === 1 ? "dpr1" : "dpr125";
        it(`pans at the live-tier threshold, 1920 × 1080 at DPR ${ratio}`, async () => {
            const run = await openApp(ratio);
            try {
                const call = <T>(name: string, ...args: unknown[]) =>
                    run.page.evaluate<T>(
                        `import("/tests/perf/harness/te-013-pan.ts").then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
                    );
                const prepared = await call<Prepared>("prepare");
                // The sprite count is the threshold's, within the cells the view's edge cuts.
                expect(prepared.sprites).toBeGreaterThan(55_000);
                expect(prepared.sprites).toBeLessThan(80_000);
                await call<PanRecord>("pan", WARMUP_MS);
                const pan = await call<PanRecord>("pan", PAN_MS);

                const sorted = [...pan.submitMs].sort((a, b) => a - b);
                const p95 = percentile(sorted, 0.95);
                const dropped = pan.intervalMs.filter((ms) => ms > DROPPED_INTERVAL_MS).length;
                const where = `${gpu!.label}, window ${WINDOW.width} × ${WINDOW.height}, DPR ${ratio}, canvas ${prepared.canvas.join(" × ")}`;
                record({
                    id: `te-013-pan-submit-${label}`,
                    ticket: "TE-013",
                    measurement: `Pan at the live-tier threshold (${prepared.sprites} sprites), frame callback start to submit; ${where}`,
                    statistic: `p95 of ${pan.submitMs.length} frames of a ${PAN_MS / 1000} s pan after ${WARMUP_MS / 1000} s warm-up`,
                    budgetMs: SUBMIT_BUDGET_MS,
                    resultMs: p95,
                    details: {
                        adapter: run.adapter,
                        medianMs: percentile(sorted, 0.5),
                        medianBuildMs: percentile(
                            [...pan.buildMs].sort((a, b) => a - b),
                            0.5,
                        ),
                        maxMs: sorted[sorted.length - 1],
                        frames: pan.submitMs.length,
                        zoom: prepared.zoom,
                    },
                });
                record({
                    id: `te-013-pan-dropped-${label}`,
                    ticket: "TE-013",
                    measurement: `Frames more than ${DROPPED_INTERVAL_MS} ms after the previous one over a ${PAN_MS / 1000} s pan; ${where}`,
                    statistic: "count of frame intervals over the limit",
                    unit: "count",
                    budgetMs: Math.floor(pan.intervalMs.length * DROPPED_FRACTION),
                    resultMs: dropped,
                    details: {
                        adapter: run.adapter,
                        intervals: pan.intervalMs.length,
                        fraction: dropped / pan.intervalMs.length,
                    },
                });
            } finally {
                await run.close();
            }
        });
    }
});
