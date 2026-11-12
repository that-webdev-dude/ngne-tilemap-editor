import { describe, expect, it } from "vitest";
import type { IdleRecord, Opened } from "./harness/te-064-idle";
import { WINDOW, gpu, openApp } from "./browser";
import { record } from "./record";

// TE-064 and ENGINE §6: the idle editor submits no frame (0 frames per second). The method is
// the sprite editor's idle benchmark (`se-070-idle` at `ea5c91d`, RULES 1). The reference map
// open at 1920 × 1080, DPR 1, in two views: 100% in its middle (the live tier) and View › Fit Map
// (the chunk tier). Once the chunk tier has no work left and 2 s more have passed, two windows of
// 10 s each with nothing done: the pointer outside the viewport (the window's top-left corner),
// then resting on the viewport's canvas after one move onto it. In each window the page counts
// every frame submitted to any of its GPU queues (viewport and preview), the app's animation-
// frame callbacks and its own animation frames (harness/te-064-idle.ts). A window with fewer than
// 20 animation frames per second of the page fails the run (the page was not running), and so
// does a view change afterwards that submits no frame (the counter must count). The result is the
// larger of the two windows' submits per second (`unit: count`) against a budget of 0. Run alone
// on the reference machine, one GPU at a time (tests/perf/README.md):
//
//     PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-064-idle.perf.ts
//     PERF_GPU=rtx-4060  npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-064-idle.perf.ts
//
// Without PERF_GPU the benchmark is skipped. Each view records one result.

const SETTLE_MS = 2000;
/** After the pointer's move onto the canvas: its hover redraws the overlay once. */
const POINTER_SETTLE_MS = 1000;
const WINDOW_MS = 10_000;
const MIN_PAGE_FPS = 20;
const BUDGET_FPS = 0;

const VIEWS = [
    { view: "100", label: "live", what: "at 100% in its middle" },
    { view: "fit", label: "overview", what: "fitted (View › Fit Map)" },
] as const;

const describeBrowser = gpu ? describe : describe.skip;

describeBrowser("te-064 idle", () => {
    for (const { view, label, what } of VIEWS) {
        it(`submits no frame while idle, reference map ${what}, 1920 × 1080, DPR 1`, async () => {
            const run = await openApp(1);
            try {
                const call = <T>(name: string, ...args: unknown[]) =>
                    run.page.evaluate<T>(
                        `import("/tests/perf/harness/te-064-idle.ts").then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
                    );
                // The pointer outside the viewport: no hover, no overlay redraw.
                await run.page.mouse.move(0, 0);
                const opened = await call<Opened>("openReference", view);
                expect(opened.tier).toBe(view === "100" ? "live" : "chunk");
                expect(opened.submits).toBeGreaterThan(0);
                await call("settle", SETTLE_MS);
                const outside = await call<IdleRecord>("idle", WINDOW_MS);

                const canvas = await run.page.evaluate(() => {
                    const box = window.__ngneTest!.viewport!.canvas.getBoundingClientRect();
                    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
                });
                await run.page.mouse.move(canvas.x, canvas.y);
                await call("settle", POINTER_SETTLE_MS);
                const resting = await call<IdleRecord>("idle", WINDOW_MS);

                const windows = { outside, resting };
                for (const span of Object.values(windows)) {
                    expect(span.pageAnimationFrames / (span.ms / 1000)).toBeGreaterThanOrEqual(
                        MIN_PAGE_FPS,
                    );
                }
                const afterwards = await call<number>("changeView");
                expect(afterwards).toBeGreaterThan(0);

                const perSecond = (span: IdleRecord) => span.submits / (span.ms / 1000);
                const summary = (span: IdleRecord) => ({
                    seconds: span.ms / 1000,
                    submits: span.submits,
                    viewportFrames: span.viewportFrames,
                    appAnimationFrames: span.appAnimationFrames,
                    pageAnimationFrames: span.pageAnimationFrames,
                    tier: span.tier,
                });
                record({
                    id: `te-064-idle-${label}`,
                    ticket: "TE-064",
                    measurement: `Idle editor, the reference map ${what}: frames submitted per second to any GPU queue of the page (viewport and preview), with nothing done; ${gpu!.label}, window ${WINDOW.width} × ${WINDOW.height}, DPR 1, canvas ${opened.canvas.join(" × ")}`,
                    statistic: `larger of two ${WINDOW_MS / 1000} s windows (pointer outside the viewport, then resting on the canvas), submits ÷ seconds, after ${SETTLE_MS / 1000} s settled`,
                    unit: "count",
                    budgetMs: BUDGET_FPS,
                    resultMs: Math.max(perSecond(outside), perSecond(resting)),
                    details: {
                        adapter: run.adapter,
                        outside: summary(outside),
                        resting: summary(resting),
                        submitsWhileOpening: opened.submits,
                        submitsAfterViewChange: afterwards,
                        zoom: opened.zoom,
                    },
                });
            } finally {
                await run.close();
            }
        });
    }
});
