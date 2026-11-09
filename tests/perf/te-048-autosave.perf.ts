import type { Page } from "@playwright/test";
import { describe, expect, it } from "vitest";
import type { AutosaveRecord } from "./harness/te-048-autosave";
import { WINDOW, gpu, openApp } from "./browser";
import { record } from "./record";

// TE-048 and SPEC §14: autosave keeps every main-thread task within 16 ms on the reference
// project (ENGINE §6's reference map with its two tilesets). Each run edits a cell and times the
// first snapshot (the whole project) and the next one (one map's entry). Run alone on the
// reference machine, one GPU at a time (tests/perf/README.md):
//
//     PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-048-autosave.perf.ts
//     PERF_GPU=rtx-4060  npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-048-autosave.perf.ts
//
// Without PERF_GPU the benchmark is skipped.

const RUNS = 5;
/** Time between snapshots for the background work of the last one (chunk tier, packing). */
const GAP_MS = 1500;
const DELAY_MS = 2000;
const TASK_BUDGET_MS = 16;

const max = (values: number[]) => Math.max(...values);
const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
};

const describeBrowser = gpu ? describe : describe.skip;

describeBrowser("te-048 autosave", () => {
    const harness = (page: Page) => ({
        call: <T>(name: string, ...args: unknown[]) =>
            page.evaluate<T>(
                `import("/tests/perf/harness/te-048-autosave.ts").then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
            ),
    });

    it("autosaves the reference project with every main-thread task within 16 ms", async () => {
        const run = await openApp(1);
        try {
            const { call } = harness(run.page);
            await call<AutosaveRecord>("runs", 1, GAP_MS, DELAY_MS);
            const result = await call<AutosaveRecord>("runs", RUNS, GAP_MS, DELAY_MS);
            expect(result.full).toHaveLength(RUNS);
            const all = [...result.full, ...result.incremental];
            const tasks = all.map((each) => each.longestTaskMs);
            record({
                id: "te-048-autosave",
                ticket: "TE-048",
                measurement: `Autosave of the reference project (${result.cells} cells, 2 tilesets) after one cell edit, through the worker into IndexedDB: main-thread task max from just before the 2 s delay ends to the snapshot stored; ${gpu!.label}, window ${WINDOW.width} × ${WINDOW.height}, DPR 1`,
                statistic: `max of ${RUNS} runs of two snapshots each (the whole project, then one map), ${GAP_MS} ms apart, after 1 warm-up run`,
                budgetMs: TASK_BUDGET_MS,
                resultMs: max(tasks),
                details: {
                    adapter: run.adapter,
                    medianMs: median(tasks),
                    fullLongestTaskMs: result.full.map((each) => each.longestTaskMs),
                    fullPageMs: result.full.map((each) => each.pageMs),
                    fullThumbnailMs: result.full.map((each) => each.thumbnailMs),
                    fullStoredMs: result.full.map((each) => each.storedMs),
                    incrementalLongestTaskMs: result.incremental.map((each) => each.longestTaskMs),
                    incrementalPageMs: result.incremental.map((each) => each.pageMs),
                    incrementalThumbnailMs: result.incremental.map((each) => each.thumbnailMs),
                    incrementalStoredMs: result.incremental.map((each) => each.storedMs),
                },
            });
        } finally {
            await run.close();
        }
    }, 600_000);
});
