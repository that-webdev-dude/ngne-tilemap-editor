import { describe, expect, it } from "vitest";
import type { Opened, WandRecord } from "./harness/te-020-wand";
import { WINDOW, gpu, openApp } from "./browser";
import { record } from "./record";

// TE-020 and SPEC §14: magic wand of a 65,536-cell region, press → frame submitted, the region
// found after the press, p95 ≤ 100 ms on the reference map, 1920 × 1080 at DPR 1. The layer
// under the parallax layer is made one tile everywhere, so each press at the map's middle
// selects all 256 × 256 cells. The wand finds its region at the press (it keeps none from a
// hover) and changes no cells: its frame is the overlay's redraw with the ants of the selection
// it makes, shown at the press and recorded at the release.
// Before each press the selection is cleared (outside the timing), so each press is one history
// entry. Each press is timed from its event's time stamp to the end of the first overlay redraw
// after it. Run alone on the reference machine, one GPU at a time (tests/perf/README.md):
//
//     PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-020-wand.perf.ts
//     PERF_GPU=rtx-4060  npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-020-wand.perf.ts
//
// Without PERF_GPU the benchmark is skipped.

const WAND_BUDGET_MS = 100;
const PRESSES = 40;
/** Presses before the timed ones: the first warm the overlay and the history up. */
const WARMUP = 5;
const CELLS = 65_536;

function percentile(sorted: number[], fraction: number): number {
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

const describeBrowser = gpu ? describe : describe.skip;

describeBrowser("te-020 wand", () => {
    it("selects 65,536 cells on the reference map at 1920 × 1080, DPR 1: press to frame", async () => {
        const run = await openApp(1);
        try {
            const call = <T>(name: string, ...args: unknown[]) =>
                run.page.evaluate<T>(
                    `import("/tests/perf/harness/te-020-wand.ts").then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
                );
            const opened = await call<Opened>("openReference");
            const shape = await call<{ ms: number; cells: number }>("shapeMs", 128, 128);
            expect(shape.cells).toBe(CELLS);
            const { mouse } = run.page;
            const at = await call<{ x: number; y: number }>("cellClient", 128, 128);
            await mouse.move(at.x, at.y);
            for (let n = 0; n < PRESSES; n++) {
                await call("clear");
                await mouse.down();
                await call("recorded", n + 1);
                await mouse.up();
            }
            const selected = await call<WandRecord>("result");
            expect(selected.selected).toBe(CELLS);
            expect(selected.undo).toBe("Magic Wand");
            const timed = selected.ms.slice(WARMUP);
            const sorted = [...timed].sort((a, b) => a - b);
            const handled = selected.handledMs.slice(WARMUP).sort((a, b) => a - b);
            const where = `${gpu!.label}, window ${WINDOW.width} × ${WINDOW.height}, DPR 1, canvas ${opened.canvas.join(" × ")}`;
            record({
                id: "te-020-magic-wand",
                ticket: "TE-020",
                measurement: `Magic wand of a ${CELLS}-cell region on the reference map at 100%, the region found after the press, press to the overlay frame showing the selection; ${where}`,
                statistic: `p95 of ${timed.length} presses after ${WARMUP} warm-up presses`,
                budgetMs: WAND_BUDGET_MS,
                resultMs: percentile(sorted, 0.95),
                details: {
                    adapter: run.adapter,
                    medianMs: percentile(sorted, 0.5),
                    maxMs: sorted[sorted.length - 1],
                    shapeAloneMs: shape.ms,
                    handledMedianMs: percentile(handled, 0.5),
                    entries: selected.entries,
                    layerId: opened.layerId,
                },
            });
        } finally {
            await run.close();
        }
    });
});
