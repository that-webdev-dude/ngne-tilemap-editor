import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, preview } from "vite";
import type { PreviewServer } from "vite";
import { WINDOW, checkedAdapter, freePort, gpu, launchChrome } from "./browser";
import { record } from "./record";

// TE-064 and ENGINE §6: cold load to interactive, production build, local, ≤ 2 s. The app is
// built for production (`vite build` with the project's configuration, into a temporary folder)
// and served by `vite preview` on 127.0.0.1. Each load starts a new Chrome with a fresh profile
// (no HTTP, code or shader cache, no service worker, no stored project), 1920 × 1080 at DPR 1.
//
// "Interactive" is the sprite editor's (its tests/perf/README.md at `ea5c91d`, RULES 1): the app
// is interactive when the user can start work. Past the WebGPU check that gates the editor, the
// shell shows the empty state, whose first action is New Project (TE-047), and that action
// responds. A script that runs before the app's measures it from the navigation's start:
// - `shell`: the first animation frame in which the empty state's New Project button is in the
//   document with a box;
// - from then on, at every animation frame (at most every 50 ms) until the dialog is there, it
//   clicks the button; a click that comes before the app can answer it is lost, as a user's
//   would be;
// - `interactive`: the first animation frame in which the New Project dialog (`role="dialog"`,
//   named "New Project") is in the document with a box. That frame paints it.
// The result is the largest `interactive` of 10 loads. A page with the development test hook or
// Vite's client is no production build and fails the run, as does a wrong adapter (checked in
// each load's page after it was measured). Run alone on the reference machine, one GPU at a time
// (tests/perf/README.md):
//
//     PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-064-cold-load.perf.ts
//     PERF_GPU=rtx-4060  npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-064-cold-load.perf.ts
//
// Without PERF_GPU the benchmark is skipped.

const BUDGET_MS = 2000;
const LOADS = 10;
const CLICK_INTERVAL_MS = 50;
const LOAD_LIMIT_MS = 30_000;

interface ColdLoadState {
    appReadyAt: number | null;
    shell: number | null;
    interactive: number | null;
    clicks: number;
    longTasks: [number, number][];
}

interface LoadRecord {
    /** Navigation start → interactive. */
    interactiveMs: number;
    shellMs: number;
    clicks: number;
    appReadyMs: number;
    firstContentfulPaintMs: number;
    domContentLoadedMs: number;
    loadEventMs: number;
    longTasks: number;
    longestTaskMs: number;
    transferBytes: number;
    production: boolean;
}

/**
 * Runs in the page before its own scripts: notes `<html data-app-ready>`, the first animation
 * frame with the New Project button on screen, clicks it until the New Project dialog is on
 * screen, and every long task.
 */
function installLoadProbe(clickIntervalMs: number): void {
    const state: ColdLoadState = {
        appReadyAt: null,
        shell: null,
        interactive: null,
        clicks: 0,
        longTasks: [],
    };
    (window as unknown as { __coldLoad: ColdLoadState }).__coldLoad = state;
    new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
            state.longTasks.push([entry.startTime, entry.duration]);
    }).observe({ type: "longtask", buffered: true });
    new MutationObserver(() => {
        if (state.appReadyAt === null && document.documentElement?.dataset.appReady !== undefined)
            state.appReadyAt = performance.now();
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-app-ready"] });
    const hasBox = (element: Element | null) => {
        if (!element) return false;
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
    };
    const newProjectButton = () =>
        Array.from(document.querySelectorAll<HTMLButtonElement>("[data-empty-state] button")).find(
            (button) => button.textContent?.trim() === "New Project",
        ) ?? null;
    const newProjectDialog = () =>
        Array.from(document.querySelectorAll('[role="dialog"]')).find((dialog) => {
            const labelId = dialog.getAttribute("aria-labelledby");
            const label = labelId ? document.getElementById(labelId)?.textContent : null;
            return (label ?? dialog.getAttribute("aria-label"))?.trim() === "New Project";
        }) ?? null;
    let lastClick = -Infinity;
    const frame = (time: number) => {
        if (hasBox(newProjectDialog())) {
            state.interactive = performance.now();
            return;
        }
        const button = newProjectButton();
        if (button && hasBox(button)) {
            state.shell ??= performance.now();
            if (time - lastClick >= clickIntervalMs) {
                lastClick = time;
                state.clicks += 1;
                button.click();
            }
        }
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
}

function percentile(sorted: number[], fraction: number): number {
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

const describeBrowser = gpu ? describe : describe.skip;

describeBrowser("te-064 cold load", () => {
    let folder = "";
    let server: PreviewServer | null = null;
    let url = "";

    beforeAll(async () => {
        folder = mkdtempSync(join(tmpdir(), "ngne-te-064-"));
        // Vitest runs with NODE_ENV=test, under which Vite would build with `import.meta.env.DEV`
        // true (and the app's test hook in it): the build is the production one of
        // `npm run build`, as the sprite editor's cold load builds it.
        const nodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";
        try {
            await build({
                mode: "production",
                logLevel: "error",
                build: { outDir: folder, emptyOutDir: true },
            });
        } finally {
            process.env.NODE_ENV = nodeEnv;
        }
        const port = await freePort();
        server = await preview({
            logLevel: "error",
            build: { outDir: folder },
            preview: { host: "127.0.0.1", port, strictPort: true, open: false },
        });
        url = `http://127.0.0.1:${port}/`;
    }, 300_000);

    afterAll(async () => {
        await server?.close();
        if (folder !== "") rmSync(folder, { recursive: true, force: true });
    });

    async function load(): Promise<LoadRecord & { adapter: string }> {
        const { browser, page } = await launchChrome(1);
        try {
            await page.addInitScript(installLoadProbe, CLICK_INTERVAL_MS);
            await page.goto(url);
            await page.waitForFunction(
                () =>
                    (window as unknown as { __coldLoad: ColdLoadState }).__coldLoad.interactive !==
                    null,
                undefined,
                { timeout: LOAD_LIMIT_MS, polling: 50 },
            );
            // The paint timing entry is reported a little after the frame; for the details only.
            await page
                .waitForFunction(
                    () =>
                        performance
                            .getEntriesByType("paint")
                            .some((entry) => entry.name === "first-contentful-paint"),
                    undefined,
                    { timeout: 2000, polling: 50 },
                )
                .catch(() => {});
            const loaded = await page.evaluate((): LoadRecord => {
                const state = (window as unknown as { __coldLoad: ColdLoadState }).__coldLoad;
                const navigation = performance.getEntriesByType("navigation")[0] as
                    PerformanceNavigationTiming | undefined;
                const paint = performance
                    .getEntriesByType("paint")
                    .find((entry) => entry.name === "first-contentful-paint");
                const resources = performance.getEntriesByType(
                    "resource",
                ) as PerformanceResourceTiming[];
                return {
                    interactiveMs: state.interactive!,
                    shellMs: state.shell ?? -1,
                    clicks: state.clicks,
                    appReadyMs: state.appReadyAt ?? -1,
                    firstContentfulPaintMs: paint?.startTime ?? -1,
                    domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? -1,
                    loadEventMs: navigation?.loadEventEnd ?? -1,
                    longTasks: state.longTasks.length,
                    longestTaskMs: Math.max(0, ...state.longTasks.map(([, duration]) => duration)),
                    transferBytes:
                        (navigation?.transferSize ?? 0) +
                        resources.reduce((sum, entry) => sum + entry.transferSize, 0),
                    production:
                        !("__ngneTest" in window) &&
                        document.querySelector('script[src*="/@vite/client"]') === null,
                };
            });
            // The adapter is checked after the load, so the check adds nothing to it.
            const adapter = await checkedAdapter(page);
            return { ...loaded, adapter };
        } finally {
            await browser.close();
        }
    }

    it("loads the production build cold to interactive, 1920 × 1080, DPR 1", async () => {
        const loads: (LoadRecord & { adapter: string })[] = [];
        for (let n = 0; n < LOADS; n++) {
            const loaded = await load();
            expect(loaded.production).toBe(true);
            expect(loaded.shellMs).toBeGreaterThan(0);
            expect(loaded.interactiveMs).toBeGreaterThanOrEqual(loaded.shellMs);
            loads.push(loaded);
        }
        const interactive = loads.map((loaded) => loaded.interactiveMs).sort((a, b) => a - b);
        const median = (values: number[]) =>
            percentile(
                [...values].sort((a, b) => a - b),
                0.5,
            );
        record({
            id: "te-064-cold-load",
            ticket: "TE-064",
            measurement: `Cold load of the production build served locally (vite preview), navigation start to interactive (the first animation frame with the New Project dialog on screen, its button clicked at every frame from the first one that shows it); new Chrome with a fresh profile per load; ${gpu!.label}, window ${WINDOW.width} × ${WINDOW.height}, DPR 1`,
            statistic: `max of ${LOADS} loads`,
            budgetMs: BUDGET_MS,
            resultMs: interactive[interactive.length - 1]!,
            details: {
                adapter: loads[0]!.adapter,
                medianMs: percentile(interactive, 0.5),
                interactiveMs: loads.map((loaded) => loaded.interactiveMs),
                shellMs: loads.map((loaded) => loaded.shellMs),
                clicks: loads.map((loaded) => loaded.clicks),
                appReadyMedianMs: median(loads.map((loaded) => loaded.appReadyMs)),
                firstContentfulPaintMedianMs: median(
                    loads.map((loaded) => loaded.firstContentfulPaintMs),
                ),
                domContentLoadedMedianMs: median(loads.map((loaded) => loaded.domContentLoadedMs)),
                loadEventMedianMs: median(loads.map((loaded) => loaded.loadEventMs)),
                longTasksMax: Math.max(...loads.map((loaded) => loaded.longTasks)),
                longestTaskMs: Math.max(...loads.map((loaded) => loaded.longestTaskMs)),
                transferBytes: loads[0]!.transferBytes,
            },
        });
    });
});
