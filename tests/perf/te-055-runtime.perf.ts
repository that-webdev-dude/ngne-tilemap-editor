import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { describe, expect, it } from "vitest";
import type { FileData, RuntimeConfig, RuntimeRecord } from "./harness/te-055-runtime";
import { WINDOW, gpu, openPage } from "./browser";
import { record } from "./record";

// TE-055 and ENGINE §6: the game runtime budget, p95 `game.stats.renderMs` of the fixture game
// (tests/fixtures/game) drawing the exported reference project: the stacked HUD scene,
// `pixelSnap` on, tile animations on, panning. 480 × 270 shown ×3 (a typical pixel-art game)
// ≤ 8 ms on Intel UHD; 1920 × 1080 ×1, all 8 layers full, recorded. Run alone on the reference
// machine, one GPU at a time (tests/perf/README.md):
//
//     PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-055-runtime.perf.ts
//     PERF_GPU=rtx-4060  npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-055-runtime.perf.ts
//
// Without PERF_GPU the benchmark is skipped. Each test records one result (`-480x270`,
// `-1920x1080`). The export is written to test-results/te-055-runtime/ and removed after.

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
// Under test-results/, which the dev server does not watch: a write elsewhere in the checkout
// can reload the page.
const FOLDER = join(ROOT, "test-results", "te-055-runtime");
const PAGE = "/tests/perf/harness/te-055-runtime.html";
const WARMUP_MS = 2000;
const MEASURE_MS = 10_000;
const BUDGET_MS = 8;

const percentile = (values: number[], p: number) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
};

const describeBrowser = gpu ? describe : describe.skip;

describeBrowser("te-055 game runtime", () => {
    /** Exports the reference project in the page and writes the folder; returns its URL. */
    async function writeExport(page: Page): Promise<string> {
        const files = await page.evaluate<FileData[]>(
            `import("/tests/perf/harness/te-055-runtime.ts").then((m) => m.exportReference())`,
        );
        rmSync(FOLDER, { recursive: true, force: true });
        mkdirSync(FOLDER, { recursive: true });
        for (const file of files)
            writeFileSync(join(FOLDER, file.name), Buffer.from(file.base64, "base64"));
        return `/${relative(ROOT, FOLDER).split(sep).join("/")}/`;
    }

    async function measure(
        config: RuntimeConfig,
    ): Promise<{ result: RuntimeRecord; adapter: string }> {
        const run = await openPage(1, PAGE);
        try {
            const folder = await writeExport(run.page);
            const result = await run.page.evaluate<RuntimeRecord>(
                `import("/tests/perf/harness/te-055-runtime.ts").then((m) => m.run(${JSON.stringify(folder)}, ${JSON.stringify(config)}))`,
            );
            expect(result.reports).toEqual([]);
            expect(result.pixelSnap).toBe(true);
            expect(result.renderMs.length).toBeGreaterThan(0);
            return { result, adapter: run.adapter };
        } finally {
            await run.close();
            rmSync(FOLDER, { recursive: true, force: true });
        }
    }

    function details(adapter: string, result: RuntimeRecord): Record<string, unknown> {
        return {
            adapter,
            frames: result.renderMs.length,
            canvas: result.canvas,
            sprites: result.sprites,
            drawCalls: result.drawCalls,
            renderMs: {
                median: percentile(result.renderMs, 50),
                p95: percentile(result.renderMs, 95),
                p99: percentile(result.renderMs, 99),
                max: Math.max(...result.renderMs),
            },
            frameMsP95: percentile(result.frameMs, 95),
        };
    }

    it("draws 480 × 270 shown ×3 with p95 renderMs within 8 ms", async () => {
        const { result, adapter } = await measure({
            width: 480,
            height: 270,
            cssScale: 3,
            warmupMs: WARMUP_MS,
            measureMs: MEASURE_MS,
        });
        record({
            id: "te-055-runtime-480x270",
            ticket: "TE-055",
            measurement: `Game runtime: the fixture game drawing the exported reference project (8 full layers, 2 tilesets, parallax, animated tiles) at 480 × 270 shown ×3 with a stacked HUD scene, pixelSnap on, panning; game.stats.renderMs; ${gpu!.label}, window ${WINDOW.width} × ${WINDOW.height}, DPR 1`,
            statistic: `p95 of ${result.renderMs.length} frames over ${MEASURE_MS / 1000} s after ${WARMUP_MS / 1000} s`,
            budgetMs: BUDGET_MS,
            resultMs: percentile(result.renderMs, 95),
            details: details(adapter, result),
        });
    }, 600_000);

    it("draws 1920 × 1080 ×1 with all 8 layers full, recorded", async () => {
        const { result, adapter } = await measure({
            width: 1920,
            height: 1080,
            cssScale: 1,
            warmupMs: WARMUP_MS,
            measureMs: MEASURE_MS,
        });
        record({
            id: "te-055-runtime-1920x1080",
            ticket: "TE-055",
            measurement: `Game runtime: the fixture game drawing the exported reference project (8 full layers, 2 tilesets, parallax, animated tiles) at 1920 × 1080 ×1 with a stacked HUD scene, pixelSnap on, panning; game.stats.renderMs; ${gpu!.label}, window ${WINDOW.width} × ${WINDOW.height}, DPR 1`,
            statistic: `p95 of ${result.renderMs.length} frames over ${MEASURE_MS / 1000} s after ${WARMUP_MS / 1000} s`,
            resultMs: percentile(result.renderMs, 95),
            details: details(adapter, result),
        });
    }, 600_000);
});
