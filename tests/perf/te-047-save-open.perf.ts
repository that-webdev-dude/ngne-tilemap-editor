import type { Page } from "@playwright/test";
import { describe, expect, it } from "vitest";
import type { OpenRecord, Prepared, SaveRecord } from "./harness/te-047-save-open";
import { WINDOW, gpu, openApp } from "./browser";
import { record } from "./record";

// TE-047 and SPEC §14: Save of the reference project (worker), main-thread task max ≤ 16 ms and
// total ≤ 3 s; Open of the reference project to first frame ≤ 3 s. The reference project is
// ENGINE §6's reference map with its two tilesets; files are in memory, so the numbers are the
// editor's (hand-over, worker codec, replace, first frame), not a disk's. Run alone on the
// reference machine, one GPU at a time (tests/perf/README.md):
//
//     PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-047-save-open.perf.ts
//     PERF_GPU=rtx-4060  npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-047-save-open.perf.ts
//
// Without PERF_GPU the benchmark is skipped. Each test records one result (`-save`, `-open`);
// run one at a time with `-t` when a `PERF_ID` names the record.

const RUNS = 10;
/** Time between runs for the background work of the last one (chunk tier, packing). */
const GAP_MS = 1500;
const TASK_BUDGET_MS = 16;
const TOTAL_BUDGET_MS = 3000;

const max = (values: number[]) => Math.max(...values);
const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
};

const describeBrowser = gpu ? describe : describe.skip;

describeBrowser("te-047 save and open", () => {
    const harness = (page: Page) => ({
        call: <T>(name: string, ...args: unknown[]) =>
            page.evaluate<T>(
                `import("/tests/perf/harness/te-047-save-open.ts").then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
            ),
    });

    it("saves the reference project with every main-thread task within 16 ms", async () => {
        const run = await openApp(1);
        try {
            const { call } = harness(run.page);
            const prepared = await call<Prepared>("prepare");
            await call<SaveRecord>("saves", 2, GAP_MS);
            const result = await call<SaveRecord>("saves", RUNS, GAP_MS);
            expect(result.totalMs).toHaveLength(RUNS);
            const where = `${gpu!.label}, window ${WINDOW.width} × ${WINDOW.height}, DPR 1, canvas ${prepared.canvas.join(" × ")}`;
            record({
                id: "te-047-save",
                ticket: "TE-047",
                measurement: `Save of the reference project (${prepared.cells} cells, 2 tilesets) through the file workflows and the worker, to a file in memory, main-thread task max; ${where}`,
                statistic: `max of ${RUNS} saves, ${GAP_MS} ms apart, after 2 warm-up saves`,
                budgetMs: TASK_BUDGET_MS,
                resultMs: max(result.longestTaskMs),
                details: {
                    adapter: run.adapter,
                    totalBudgetMs: TOTAL_BUDGET_MS,
                    totalMaxMs: max(result.totalMs),
                    totalMedianMs: median(result.totalMs),
                    fileBytes: result.bytes,
                    longestTaskMs: result.longestTaskMs,
                    totalMs: result.totalMs,
                },
            });
        } finally {
            await run.close();
        }
    }, 600_000);

    it("opens the reference project to its first frame within 3 s", async () => {
        const run = await openApp(1);
        try {
            const { call } = harness(run.page);
            const prepared = await call<Prepared>("prepare");
            await call<SaveRecord>("saves", 1, GAP_MS);
            await call<OpenRecord>("opens", 2, GAP_MS);
            const result = await call<OpenRecord>("opens", RUNS, GAP_MS);
            expect(result.drawnMs).toHaveLength(RUNS);
            const where = `${gpu!.label}, window ${WINDOW.width} × ${WINDOW.height}, DPR 1, canvas ${prepared.canvas.join(" × ")}`;
            record({
                id: "te-047-open",
                ticket: "TE-047",
                measurement: `Open of the reference project from a file in memory, from the empty state: the call to the frame that draws the map with both tileset textures uploaded; ${where}`,
                statistic: `max of ${RUNS} opens, ${GAP_MS} ms apart, after 2 warm-up opens`,
                budgetMs: TOTAL_BUDGET_MS,
                resultMs: max(result.drawnMs),
                details: {
                    adapter: run.adapter,
                    medianMs: median(result.drawnMs),
                    firstFrameMaxMs: max(result.firstFrameMs),
                    firstFrameMedianMs: median(result.firstFrameMs),
                    longestTaskMaxMs: max(result.longestTaskMs),
                    drawnMs: result.drawnMs,
                    firstFrameMs: result.firstFrameMs,
                },
            });
        } finally {
            await run.close();
        }
    }, 600_000);
});
