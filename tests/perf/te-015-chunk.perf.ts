import { describe, expect, it } from "vitest";
import type { Built, PaintRecord, Rebuilt } from "./harness/te-015-chunk";
import { WINDOW, gpu, openApp } from "./browser";
import { record } from "./record";

// TE-015 and ENGINE §6: the chunk tier of the reference map, 1920 × 1080 at DPR 1. Budgets: chunk
// patch settled after a paint p95 ≤ 100 ms (one cell and a 16 × 16 stamp); chunk GPU memory
// ≤ 64 MB; overview rebuild after a layer opacity change ≤ 500 ms with no task over 16 ms; initial
// build after the map opens with no task over 16 ms. Run alone on the reference machine, one GPU
// at a time (tests/perf/README.md):
//
//     PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-015-chunk.perf.ts
//     PERF_GPU=rtx-4060  npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-015-chunk.perf.ts
//
// Without PERF_GPU the benchmark is skipped. "No task over 16 ms" is measured two ways: the
// longest gap of a message loop on the main thread, which holds every task, and the chunk tier's
// longest composite-and-submit slice, the build's own tasks. The initial build runs while the map
// shows at 100% (live-tier frames within their budget): the gap is compared with the budget. The
// rebuild runs at overview, where the editor draws the change in the live tier until the chunks
// are composited again (ENGINE §4, "beyond its budget"): the slice is compared with the budget,
// and the gap and the live frames are recorded beside it. The run records several results; run
// one at a time with `-t` when a `PERF_ID` names the record.

const TASK_BUDGET_MS = 16;
const REBUILD_BUDGET_MS = 500;
const SETTLE_BUDGET_MS = 100;
const MEMORY_BUDGET_MB = 64;
const PAINTS = 100;

function percentile(values: number[], fraction: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

const describeBrowser = gpu ? describe : describe.skip;

describeBrowser("te-015 chunk tier", () => {
    it("builds, rebuilds and patches the reference map's chunk tier at 1920 × 1080, DPR 1", async () => {
        const run = await openApp(1);
        try {
            const call = <T>(name: string, ...args: unknown[]) =>
                run.page.evaluate<T>(
                    `import("/tests/perf/harness/te-015-chunk.ts").then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
                );
            const where = `${gpu!.label}, window ${WINDOW.width} × ${WINDOW.height}, DPR 1`;

            const opened = await call<Built>("openReference");
            expect(opened.sets).toBe(2);
            const detail = (built: Built) => ({
                adapter: run.adapter,
                canvas: built.canvas,
                texelsPerCell: built.texelsPerCell,
                chunks: built.chunks,
                chunkBuildMs: built.buildMs,
                maxSliceMs: built.maxSliceMs,
            });
            record({
                id: "te-015-initial-build-task",
                ticket: "TE-015",
                measurement: `Initial chunk build of the reference map after it opens, longest main-thread task; ${where}`,
                statistic:
                    "longest gap of a message loop from the first frame of the map at 100% to the tier ready",
                budgetMs: TASK_BUDGET_MS,
                resultMs: opened.maxGapMs,
                details: { ...detail(opened), totalMs: opened.ms },
            });
            record({
                id: "te-015-memory",
                ticket: "TE-015",
                measurement: `Chunk-tier GPU memory of the reference map in MB; ${where}`,
                statistic: "chunk textures × (32 T)² × 4 bytes",
                unit: "count",
                budgetMs: MEMORY_BUDGET_MB,
                resultMs: opened.bytes / 2 ** 20,
                details: detail(opened),
            });

            // A visibility or opacity change of a layer of the flattened set.
            const rebuilt = await call<Rebuilt>("rebuild", 3, 200);
            const live = {
                maxGapMs: rebuilt.maxGapMs,
                liveFrames: rebuilt.frames,
                longestLiveFrameMs: rebuilt.longestFrameMs,
            };
            record({
                id: "te-015-rebuild",
                ticket: "TE-015",
                measurement: `Overview rebuild after a layer opacity change of the reference map; ${where}`,
                statistic: "one rebuild, change to tier ready",
                budgetMs: REBUILD_BUDGET_MS,
                resultMs: rebuilt.ms,
                details: { ...detail(rebuilt), ...live },
            });
            record({
                id: "te-015-rebuild-task",
                ticket: "TE-015",
                measurement: `Overview rebuild after a layer opacity change, longest build task; ${where}`,
                statistic: "longest composite-and-submit slice of the rebuild",
                budgetMs: TASK_BUDGET_MS,
                resultMs: rebuilt.maxSliceMs,
                details: { ...detail(rebuilt), ...live },
            });

            for (const side of [1, 16]) {
                const painted = await call<PaintRecord>("paint", PAINTS, side);
                expect(painted.tier).toBe("chunk");
                record({
                    id: `te-015-patch-settle-${side === 1 ? "cell" : "stamp16"}`,
                    ticket: "TE-015",
                    measurement: `Chunk patch settled after painting ${side === 1 ? "one cell" : "a 16 × 16 stamp"} at overview, command to patch settled; ${where}`,
                    statistic: `p95 of ${PAINTS} paints`,
                    budgetMs: SETTLE_BUDGET_MS,
                    resultMs: percentile(painted.settleMs, 0.95),
                    details: {
                        adapter: run.adapter,
                        medianMs: percentile(painted.settleMs, 0.5),
                        maxMs: Math.max(...painted.settleMs),
                        frameP95Ms: percentile(painted.frameMs, 0.95),
                    },
                });
            }
        } finally {
            await run.close();
        }
    });
});
