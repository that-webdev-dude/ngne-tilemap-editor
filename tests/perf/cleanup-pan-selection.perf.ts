import { describe, expect, it } from "vitest";
import type { PreparedSelection, SelectionPanRecord, Setup } from "./harness/cleanup-pan-selection";
import { WINDOW, gpu, openApp } from "./browser";
import { record } from "./record";

// M4 review, findings 2 and 3: does a marker selection or the Properties panel take TE-037's pan
// past the budget of ENGINE §6 (p95 ≤ 10 ms; frames more than 25 ms apart ≤ 1%)? TE-037's pan
// draws without telling the session store; this one pans through the store, as the app's
// navigation does, so the Properties panel re-renders (finding 2) and the selection is looked up
// by every listener and overlay that reads it (finding 3). The reference map with 2,000 markers at
// the live-tier threshold, 1920 × 1080 at DPR 1, the marker select tool chosen, in three setups:
//
// - none-open: no marker selected, the Properties panel open (it shows the marker layer);
// - none-closed: no marker selected, the panel collapsed;
// - selected-open: all 2,000 selected, the panel open (it shows the 2,000 markers);
// - selected-closed: all 2,000 selected, the panel collapsed (its body unmounted).
//
// Run alone on the reference machine, one GPU and one setup at a time:
//
//     PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/cleanup-pan-selection.perf.ts -t none-open
//
// `PERF_OUT=<directory>` writes the records there instead of docs/evidence (with PERF_RECORD=1).

const PAN_MS = 5000;
const WARMUP_MS = 1000;
const BUDGET_MS = 10;
const DROPPED_INTERVAL_MS = 25;
const DROPPED_FRACTION = 0.01;

function percentile(sorted: number[], fraction: number): number {
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

const sortedOf = (values: number[]) => [...values].sort((a, b) => a - b);

const describeBrowser = gpu ? describe : describe.skip;

const SETUPS: { label: string; setup: Setup; panel: boolean }[] = [
    { label: "none-open", setup: "none", panel: true },
    { label: "none-closed", setup: "none", panel: false },
    { label: "selected-open", setup: "selected", panel: true },
    { label: "selected-closed", setup: "selected", panel: false },
];

describeBrowser("cleanup pan selection", () => {
    for (const { label, setup, panel } of SETUPS) {
        it(`pans with 2,000 markers, ${label}`, async () => {
            const run = await openApp(1);
            try {
                const call = <T>(name: string, ...args: unknown[]) =>
                    run.page.evaluate<T>(
                        `import("/tests/perf/harness/cleanup-pan-selection.ts").then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
                    );
                const toggle = run.page.locator(
                    '[data-dock-panel="properties"] .dock-section__toggle',
                );
                if (!panel) await toggle.click();
                await expect.poll(() => toggle.getAttribute("aria-expanded")).toBe(String(panel));

                const prepared = await call<PreparedSelection>("prepareSelection", null, setup);
                expect(prepared.markers).toBe(2000);
                const subject = panel
                    ? await run.page.locator("[data-properties-subject]").textContent()
                    : null;
                await call<SelectionPanRecord>("panSelection", WARMUP_MS);
                const pan = await call<SelectionPanRecord>("panSelection", PAN_MS);

                const total = sortedOf(pan.totalMs);
                const frame = sortedOf(pan.frameMs);
                const step = sortedOf(pan.stepMs);
                const dropped = pan.intervalMs.filter((ms) => ms > DROPPED_INTERVAL_MS).length;
                const where = `${gpu!.label}, window ${WINDOW.width} × ${WINDOW.height}, DPR 1, canvas ${prepared.canvas.join(" × ")}, zoom ${prepared.zoom.toFixed(3)}`;
                record(
                    {
                        id: `cleanup-pan-selection-${label}-${process.env.PERF_GPU}`,
                        ticket: "M4 review",
                        measurement:
                            `Pan of the reference map (${prepared.sprites} sprites) with 2,000 markers in view ` +
                            `through the session store, ${prepared.selected} selected, Properties panel ` +
                            `${panel ? "open" : "collapsed"}, tool ${prepared.tool}: the app's frame callbacks ` +
                            `plus the store touch and its microtasks; ${where}`,
                        statistic: `p95 of ${pan.totalMs.length} frames of a ${PAN_MS / 1000} s pan after ${WARMUP_MS / 1000} s warm-up`,
                        budgetMs: BUDGET_MS,
                        resultMs: percentile(total, 0.95),
                        details: {
                            adapter: run.adapter,
                            medianMs: percentile(total, 0.5),
                            maxMs: total[total.length - 1],
                            frameP95Ms: percentile(frame, 0.95),
                            frameMedianMs: percentile(frame, 0.5),
                            stepP95Ms: percentile(step, 0.95),
                            stepMedianMs: percentile(step, 0.5),
                            stepMaxMs: step[step.length - 1],
                            frames: pan.totalMs.length,
                            droppedFrames: dropped,
                            droppedBudget: Math.floor(pan.intervalMs.length * DROPPED_FRACTION),
                            intervals: pan.intervalMs.length,
                            intervalMedianMs: percentile(sortedOf(pan.intervalMs), 0.5),
                            propertiesSubject: subject,
                            selected: prepared.selected,
                        },
                    },
                    process.env.PERF_OUT,
                );
            } finally {
                await run.close();
            }
        });
    }
});
