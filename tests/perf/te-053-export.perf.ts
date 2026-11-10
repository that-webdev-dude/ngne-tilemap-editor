import type { Page } from "@playwright/test";
import { describe, expect, it } from "vitest";
import type { ExportRecord, Prepared } from "./harness/te-053-export";
import { WINDOW, gpu, openApp } from "./browser";
import { record } from "./record";

// TE-053 and SPEC §14: export of the reference project (2 tilesets, 1 map) ≤ 3 s with no
// main-thread task over 16 ms. The reference project is ENGINE §6's reference map with its two
// tilesets; the folder is in memory, so the numbers are the editor's (hand-over, worker plan,
// comparison, writes), not a disk's. Run alone on the reference machine, one GPU at a time
// (tests/perf/README.md):
//
//     PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-053-export.perf.ts
//     PERF_GPU=rtx-4060  npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-053-export.perf.ts
//
// Without PERF_GPU the benchmark is skipped.

const RUNS = 10;
/** Time between exports for the background work of the last one. */
const GAP_MS = 1500;
const TASK_BUDGET_MS = 16;
const TOTAL_BUDGET_MS = 3000;

const max = (values: number[]) => Math.max(...values);
const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
};

const describeBrowser = gpu ? describe : describe.skip;

describeBrowser("te-053 export", () => {
    const harness = (page: Page) => ({
        call: <T>(name: string, ...args: unknown[]) =>
            page.evaluate<T>(
                `import("/tests/perf/harness/te-053-export.ts").then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
            ),
    });

    it("exports the reference project within 3 s with every main-thread task within 16 ms", async () => {
        const run = await openApp(1);
        try {
            const { call } = harness(run.page);
            const prepared = await call<Prepared>("prepare");
            await call<ExportRecord>("exports", 2, GAP_MS);
            const result = await call<ExportRecord>("exports", RUNS, GAP_MS);
            expect(result.totalMs).toHaveLength(RUNS);
            record({
                id: "te-053-export",
                ticket: "TE-053",
                measurement: `Export of the reference project (${prepared.cells} cells, 2 tilesets, 1 map; ${result.files} files, ${result.bytes} bytes) through the export pipeline and the worker into an empty folder in memory, main-thread task max; ${gpu!.label}, window ${WINDOW.width} × ${WINDOW.height}, DPR 1`,
                statistic: `max of ${RUNS} exports, ${GAP_MS} ms apart, after 2 warm-up exports`,
                budgetMs: TASK_BUDGET_MS,
                resultMs: max(result.longestTaskMs),
                details: {
                    adapter: run.adapter,
                    totalBudgetMs: TOTAL_BUDGET_MS,
                    totalMaxMs: max(result.totalMs),
                    totalMedianMs: median(result.totalMs),
                    longestTaskMs: result.longestTaskMs,
                    totalMs: result.totalMs,
                    unchangedTotalMs: result.unchangedTotalMs,
                    unchangedLongestTaskMs: result.unchangedLongestTaskMs,
                },
            });
        } finally {
            await run.close();
        }
    }, 600_000);
});
