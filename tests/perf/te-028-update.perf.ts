import { describe, expect, it } from "vitest";
import type { Opened, UpdateSample } from "./harness/te-028-update";
import { WINDOW, gpu, openApp } from "./browser";
import { record } from "./record";

// TE-028 and SPEC §14: update tileset from source, 1,024 tiles, ≤ 1 s. On the reference map at
// 100%, 1920 × 1080 at DPR 1, its first tileset is one of 1,024 tiles of 16 px used by the map.
// Each update re-reads a grid PNG whose first 64 tiles changed and two tiles swapped (or the
// original back), so it applies at once, and is timed from the call that takes the picked file
// to the first frame submitted after the tileset's new texture is uploaded. Run alone on the
// reference machine, one GPU at a time (tests/perf/README.md):
//
//     PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-028-update.perf.ts
//     PERF_GPU=rtx-4060  npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-028-update.perf.ts
//
// Without PERF_GPU the benchmark is skipped.

const UPDATE_BUDGET_MS = 1000;
const UPDATES = 12;
/** Updates before the timed ones: the first warm the worker and the renderer up. */
const WARMUP = 2;

function percentile(sorted: number[], fraction: number): number {
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

const describeBrowser = gpu ? describe : describe.skip;

describeBrowser("te-028 update from source", () => {
    it("updates a 1,024-tile tileset on the reference map: call to frame", async () => {
        const run = await openApp(1);
        try {
            const call = <T>(name: string, ...args: unknown[]) =>
                run.page.evaluate<T>(
                    `import("/tests/perf/harness/te-028-update.ts").then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
                );
            const opened = await call<Opened>("openReference");
            const samples: UpdateSample[] = [];
            for (let n = 0; n < UPDATES; n++) {
                samples.push(await call<UpdateSample>("update", (n + 1) % 2));
            }
            expect(samples.every((sample) => sample.undo === "Update Tileset from Source")).toBe(
                true,
            );
            const timed = samples.slice(WARMUP);
            const shown = timed.map((sample) => sample.shownMs).sort((a, b) => a - b);
            const applied = timed.map((sample) => sample.appliedMs).sort((a, b) => a - b);
            const where = `${gpu!.label}, window ${WINDOW.width} × ${WINDOW.height}, DPR 1, canvas ${opened.canvas.join(" × ")}`;
            record({
                id: "te-028-update",
                ticket: "TE-028",
                measurement: `Update from source of a ${opened.tiles}-tile tileset used by the reference map at 100%, applied at once (64 tiles changed, 2 moved), the call with the picked file to the first frame after the new texture is uploaded; ${where}`,
                statistic: `max of ${timed.length} updates after ${WARMUP} warm-up updates`,
                budgetMs: UPDATE_BUDGET_MS,
                resultMs: shown[shown.length - 1]!,
                details: {
                    adapter: run.adapter,
                    medianMs: percentile(shown, 0.5),
                    appliedMedianMs: percentile(applied, 0.5),
                    appliedMaxMs: applied[applied.length - 1],
                },
            });
        } finally {
            await run.close();
        }
    });
});
