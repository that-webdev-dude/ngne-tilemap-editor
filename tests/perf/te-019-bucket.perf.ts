import { describe, expect, it } from "vitest";
import type { BucketRecord, Opened } from "./harness/te-019-bucket";
import { WINDOW, gpu, openApp } from "./browser";
import { record } from "./record";

// TE-019 and SPEC §14: bucket fill of a 65,536-cell region, press → frame submitted, p95 ≤ 100 ms
// on the reference map, 1920 × 1080 at DPR 1. The layer under the parallax layer is made one
// tile everywhere, so each press at the map's middle fills all 256 × 256 cells; the presses
// alternate two stamps, so each one changes every cell and is one history entry. Before each
// press the stamp is set and the overlay has redrawn its hover preview, which finds the region
// (as Tiled's bucket does on hover). The timed presses then forget it, so each finds its region,
// writes the cells and the frame shows them (SPEC §14: the region found after the press); as many
// presses after them keep it, for the details. Each press is timed from its event's time stamp
// to the first frame submitted after it. Run alone
// on the reference machine, one GPU at a time (tests/perf/README.md):
//
//     PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-019-bucket.perf.ts
//     PERF_GPU=rtx-4060  npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-019-bucket.perf.ts
//
// Without PERF_GPU the benchmark is skipped.

const BUCKET_BUDGET_MS = 100;
const PRESSES = 40;
/** Presses before the timed ones: the first fills warm the renderer and the history up. */
const WARMUP = 5;
const CELLS = 65_536;

function percentile(sorted: number[], fraction: number): number {
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

const describeBrowser = gpu ? describe : describe.skip;

describeBrowser("te-019 bucket", () => {
    it("fills 65,536 cells on the reference map at 1920 × 1080, DPR 1: press to frame", async () => {
        const run = await openApp(1);
        try {
            const call = <T>(name: string, ...args: unknown[]) =>
                run.page.evaluate<T>(
                    `import("/tests/perf/harness/te-019-bucket.ts").then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
                );
            const opened = await call<Opened>("openReference");
            const flood = await call<{ ms: number; cells: number }>("floodMs", 128, 128);
            expect(flood.cells).toBe(CELLS);
            const { mouse } = run.page;
            const at = await call<{ x: number; y: number }>("cellClient", 128, 128);
            await mouse.move(at.x, at.y);
            // The timed presses, the region found after each; then as many found on hover.
            for (let n = 0; n < 2 * PRESSES; n++) {
                await call("useTile", n % 2 === 0 ? 7 : 5, n < PRESSES);
                await mouse.down();
                await call("recorded", n + 1);
                await mouse.up();
            }
            const filled = await call<BucketRecord>("result");
            expect(filled.undo).toBe("Bucket Fill");
            expect(filled.entries).toBe(2 * PRESSES);
            const timed = filled.ms.slice(WARMUP, PRESSES);
            const sorted = [...timed].sort((a, b) => a - b);
            const hover = filled.ms.slice(PRESSES + WARMUP).sort((a, b) => a - b);
            const handled = (from: number, to: number) =>
                percentile(
                    filled.handledMs.slice(from, to).sort((a, b) => a - b),
                    0.5,
                );
            const where = `${gpu!.label}, window ${WINDOW.width} × ${WINDOW.height}, DPR 1, canvas ${opened.canvas.join(" × ")}`;
            record({
                id: "te-019-bucket-fill",
                ticket: "TE-019",
                measurement: `Bucket fill of a ${CELLS}-cell region on the reference map at 100%, the region found after the press, press to the frame containing it submitted; ${where}`,
                statistic: `p95 of ${timed.length} presses after ${WARMUP} warm-up presses`,
                budgetMs: BUCKET_BUDGET_MS,
                resultMs: percentile(sorted, 0.95),
                details: {
                    adapter: run.adapter,
                    medianMs: percentile(sorted, 0.5),
                    maxMs: sorted[sorted.length - 1],
                    floodAloneMs: flood.ms,
                    handledMedianMs: handled(WARMUP, PRESSES),
                    // The same presses with the region already found by the hover preview.
                    hoverFoundP95Ms: percentile(hover, 0.95),
                    hoverFoundMedianMs: percentile(hover, 0.5),
                    hoverFoundHandledMedianMs: handled(PRESSES + WARMUP, 2 * PRESSES),
                    tiers: [...new Set(filled.tiers)],
                    layerId: opened.layerId,
                },
            });
        } finally {
            await run.close();
        }
    });
});
