import { describe, expect, it } from "vitest";
import type { Prepared, SwitchRecord, ViewMode } from "./harness/te-031-tab-switch";
import { WINDOW, gpu, openApp } from "./browser";
import { record } from "./record";

// TE-031 and ENGINE §6: tab switch to an open map, first frame submitted ≤ 100 ms on the
// reference map. Two open tabs each hold the reference map; the benchmark switches between them
// and times each switch to the return of the first frame after it. Two views: fitted (the view
// a new or duplicated map opens with: the whole map, beyond the live tier) and 100% (the view
// at one device pixel per map pixel). Run alone on the reference machine, one GPU at a time
// (tests/perf/README.md):
//
//     PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-031-tab-switch.perf.ts
//     PERF_GPU=rtx-4060  npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-031-tab-switch.perf.ts
//
// Without PERF_GPU the benchmark is skipped. Each view records one result; run one at a time
// with `-t` when a `PERF_ID` names the record.

const SWITCHES = 40;
/** Time after each switch for the chunk tier's background build (ENGINE §6: ≤ 500 ms). */
const GAP_MS = 1000;
const BUDGET_MS = 100;

function percentile(sorted: number[], fraction: number): number {
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

const describeBrowser = gpu ? describe : describe.skip;

describeBrowser("te-031 tab switch", () => {
    for (const mode of ["fit", "100"] as ViewMode[]) {
        it(`switches between two open reference maps at the ${mode} view`, async () => {
            const run = await openApp(1);
            try {
                const call = <T>(name: string, ...args: unknown[]) =>
                    run.page.evaluate<T>(
                        `import("/tests/perf/harness/te-031-tab-switch.ts").then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
                    );
                const prepared = await call<Prepared>("prepare", mode);
                // Warm-up: the first switches compile what the later ones reuse.
                await call<SwitchRecord>("switches", prepared.maps, 4, GAP_MS);
                const result = await call<SwitchRecord>(
                    "switches",
                    prepared.maps,
                    SWITCHES,
                    GAP_MS,
                );
                expect(result.switchMs).toHaveLength(SWITCHES);

                const sorted = [...result.switchMs].sort((a, b) => a - b);
                const where = `${gpu!.label}, window ${WINDOW.width} × ${WINDOW.height}, DPR 1, canvas ${prepared.canvas.join(" × ")}`;
                record({
                    id: `te-031-tab-switch-${mode}`,
                    ticket: "TE-031",
                    measurement: `Tab switch to an open reference map at the ${mode === "fit" ? "fitted" : "100%"} view, switch to the first frame submitted; ${where}`,
                    statistic: `p95 of ${SWITCHES} switches, ${GAP_MS} ms apart, after 4 warm-up switches`,
                    budgetMs: BUDGET_MS,
                    resultMs: percentile(sorted, 0.95),
                    details: {
                        adapter: run.adapter,
                        medianMs: percentile(sorted, 0.5),
                        maxMs: sorted[sorted.length - 1],
                        medianDrawMs: percentile(
                            [...result.drawMs].sort((a, b) => a - b),
                            0.5,
                        ),
                        tiers: [...new Set(result.tiers)],
                        sprites: Math.max(...result.sprites),
                        switchMs: result.switchMs,
                    },
                });
            } finally {
                await run.close();
            }
        }, 600_000);
    }
});
