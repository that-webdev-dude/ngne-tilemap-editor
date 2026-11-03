import { describe, expect, it } from "vitest";
import type { Opened, Step } from "./harness/te-017-stamp-preview";
import { WINDOW, gpu, openApp } from "./browser";
import { record } from "./record";

// fix-stamp-preview: the stamp brush's preview of a 256 × 256 stamp (SPEC §4.2) on the reference
// map at 100%, 1920 × 1080 at DPR 1, with 16 px cells and with every tile enlarged to 32 px.
// Select All, Copy and Paste on the layer under the parallax layer make the whole layer the
// current stamp, previewed at the pointer in the map's middle; Rotate Stamp Right (R) turns
// it; the pointer then moves one cell at a time. The map's overview is built before (ENGINE §4).
// The main thread's longest task over the rotation and the moves, each until the overlay and
// the rail show the preview, is the record, judged against ENGINE §6: no task over 16 ms (the
// preview composites the chunks of the stamp in view a slice at a time, and the rail's picture
// at its size). The paste's longest task is in the details, not the record: its task holds the
// Paste command itself (TE-021), as Select All and Copy, run before unmeasured, are. Each
// overlay redraw is timed as well (its bottom draw layer's start to its top one's end). Run
// alone on the reference machine, one GPU at a time (tests/perf/README.md):
//
//     PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-017-stamp-preview.perf.ts
//     PERF_GPU=rtx-4060  npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-017-stamp-preview.perf.ts
//
// Without PERF_GPU the benchmark is skipped.

const TASK_BUDGET_MS = 16;
const SIDE = 256;
const CELLS = [16, 32];
const MOVES = 40;

function percentile(sorted: number[], fraction: number): number {
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

const sorted = (values: number[]) => [...values].sort((a, b) => a - b);
const longest = (values: number[]) => (values.length > 0 ? Math.max(...values) : 0);

const describeBrowser = gpu ? describe : describe.skip;

describeBrowser("te-017 stamp preview", () => {
    it("previews a 256 × 256 stamp on the reference map, 16 and 32 px, 1920 × 1080, DPR 1", async () => {
        const tasks: number[] = [];
        const runs: Record<string, unknown> = {};
        let adapter = "";
        let canvas = "";
        for (const cell of CELLS) {
            const run = await openApp(1);
            try {
                const call = <T>(name: string, ...args: unknown[]) =>
                    run.page.evaluate<T>(
                        `import("/tests/perf/harness/te-017-stamp-preview.ts").then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
                    );
                const opened = await call<Opened>("openReference", cell);
                const { mouse } = run.page;
                const centre = await call<{ x: number; y: number }>(
                    "cellClient",
                    SIDE / 2,
                    SIDE / 2,
                );
                await mouse.move(centre.x, centre.y);
                await call("settled");

                await call("copyLayer");
                const pasted = await call<Step>("paste");
                expect(pasted.stamp).toEqual([SIDE, SIDE]);
                const turned = await call<Step>("rotate");
                expect(turned.stamp).toEqual([SIDE, SIDE]);
                const from = await call<number>("mark");
                await call("watchTasks");
                for (let n = 1; n <= MOVES; n++) {
                    const at = await call<{ x: number; y: number }>(
                        "cellClient",
                        SIDE / 2 + n,
                        SIDE / 2,
                    );
                    await mouse.move(at.x, at.y);
                    await call("settled");
                }
                const moveTaskMs = await call<number>("longestTask");
                const moved = await call<number[]>("redrawsSince", from);

                tasks.push(turned.longestTaskMs, moveTaskMs);
                const order = sorted(moved);
                runs[`cells${cell}px`] = {
                    pasteLongestTaskMs: pasted.longestTaskMs,
                    pasteCommandMs: pasted.commandMs,
                    pasteToFirstRedrawMs: pasted.firstRedrawMs,
                    pasteToPreviewMs: pasted.completeMs,
                    pasteRedraws: pasted.redrawMs.length,
                    pasteLongestRedrawMs: longest(pasted.redrawMs),
                    rotateLongestTaskMs: turned.longestTaskMs,
                    rotateCommandMs: turned.commandMs,
                    rotateToFirstRedrawMs: turned.firstRedrawMs,
                    rotateToPreviewMs: turned.completeMs,
                    rotateRedraws: turned.redrawMs.length,
                    rotateLongestRedrawMs: longest(turned.redrawMs),
                    moveLongestTaskMs: moveTaskMs,
                    moveRedraws: moved.length,
                    moveMedianMs: percentile(order, 0.5),
                    moveP95Ms: percentile(order, 0.95),
                    moveLongestRedrawMs: longest(moved),
                };
                adapter = run.adapter;
                canvas = opened.canvas.join(" × ");
            } finally {
                await run.close();
            }
        }
        expect(tasks.length).toBe(2 * CELLS.length);
        const where = `${gpu!.label}, window ${WINDOW.width} × ${WINDOW.height}, DPR 1, canvas ${canvas}`;
        record({
            id: "te-017-stamp-preview",
            ticket: "TE-017",
            measurement: `Longest main-thread task while the stamp brush previews a ${SIDE} × ${SIDE} stamp (Select All, Copy, Paste of a reference map layer) at 100%, rotated (R), then moved ${MOVES} cells, each until the preview is drawn; cells of ${CELLS.join(" and ")} px; ${where}`,
            statistic: `longest task of ${tasks.length} steps (rotate, moves at each cell size)`,
            budgetMs: TASK_BUDGET_MS,
            resultMs: longest(tasks),
            details: { adapter, ...runs },
        });
    });
});
