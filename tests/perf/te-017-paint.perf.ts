import { describe, expect, it } from "vitest";
import type { Opened, PaintRecord } from "./harness/te-017-paint";
import { WINDOW, gpu, openApp } from "./browser";
import { record } from "./record";

// TE-017 and ENGINE §6: paint, pointer event → frame containing it submitted, p95 ≤ 33 ms on the
// reference map, 1920 × 1080 at DPR 1. A stroke of the stamp brush (1 × 1 stamp) on the top tile
// layer under the parallax layer, at 100% in the map's middle: one press and 200 drag moves to
// a new cell each, sent as real input; each event is timed from its time stamp to the first frame
// submitted after it. Run alone on the reference machine, one GPU at a time
// (tests/perf/README.md):
//
//     PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-017-paint.perf.ts
//     PERF_GPU=rtx-4060  npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-017-paint.perf.ts
//
// Without PERF_GPU the benchmark is skipped.

const PAINT_BUDGET_MS = 33;
const MOVES = 200;
/** Moves before the timed ones: the first frames of a stroke warm the renderer up. */
const WARMUP = 10;

function percentile(sorted: number[], fraction: number): number {
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

const describeBrowser = gpu ? describe : describe.skip;

describeBrowser("te-017 paint", () => {
    it("paints on the reference map at 1920 × 1080, DPR 1: event to frame submitted", async () => {
        const run = await openApp(1);
        try {
            const call = <T>(name: string, ...args: unknown[]) =>
                run.page.evaluate<T>(
                    `import("/tests/perf/harness/te-017-paint.ts").then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
                );
            const opened = await call<Opened>("openReference");
            const { mouse } = run.page;
            // A walk over 20 × 11 cells around the middle, a new cell at every move.
            const cells: [number, number][] = [];
            for (let n = 0; n <= MOVES; n++) {
                const row = Math.floor(n / 20);
                const column = row % 2 === 0 ? n % 20 : 19 - (n % 20);
                cells.push([118 + column, 122 + row]);
            }
            const at = (cell: [number, number]) =>
                call<{ x: number; y: number }>("cellClient", cell[0], cell[1]);
            const first = await at(cells[0]!);
            await mouse.move(first.x, first.y);
            await mouse.down();
            await call("recorded", 1);
            for (let n = 1; n <= MOVES; n++) {
                const next = await at(cells[n]!);
                await mouse.move(next.x, next.y);
                await call("recorded", n + 1);
            }
            await mouse.up();
            const painted = await call<PaintRecord>("result");
            expect(painted.undo).toBe("Stamp Brush");
            const timed = painted.ms.slice(1 + WARMUP);
            const sorted = [...timed].sort((a, b) => a - b);
            const where = `${gpu!.label}, window ${WINDOW.width} × ${WINDOW.height}, DPR 1, canvas ${opened.canvas.join(" × ")}`;
            record({
                id: "te-017-paint",
                ticket: "TE-017",
                measurement: `Paint with the stamp brush on the reference map at 100%, pointer event to the frame containing it submitted; ${where}`,
                statistic: `p95 of ${timed.length} drag moves of one stroke after ${WARMUP} warm-up moves`,
                budgetMs: PAINT_BUDGET_MS,
                resultMs: percentile(sorted, 0.95),
                details: {
                    adapter: run.adapter,
                    pressMs: painted.ms[0],
                    medianMs: percentile(sorted, 0.5),
                    maxMs: sorted[sorted.length - 1],
                    tiers: [...new Set(painted.tiers)],
                    layerId: opened.layerId,
                },
            });
        } finally {
            await run.close();
        }
    });
});
