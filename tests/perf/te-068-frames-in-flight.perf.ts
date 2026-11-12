import { describe, expect, it } from "vitest";
import type { PanRecord, Prepared } from "./harness/te-013-pan";
import type { Built } from "./harness/te-015-chunk";
import type { Opened, PaintRecord } from "./harness/te-017-paint";
import type { FlightRecord } from "./harness/te-068-frames-in-flight";
import { WINDOW, gpu, openApp } from "./browser";
import type { BrowserRun } from "./browser";
import { record } from "./record";

// TE-068 and ENGINE §6: GPU frames in flight, max ≤ 2, during three scenarios on the reference
// map, 1920 × 1080 at DPR 1, each in a Chrome of its own:
//
// - pan: the TE-013 scripted pan at the live-tier threshold (5 s after 1 s warm-up);
// - overview: the same pan with the whole map in view, in the chunk tier (TE-015's overview);
// - paint: the TE-017 stroke of the stamp brush (one press and 200 drag moves, sent as input).
//
// The page module (harness/te-068-frames-in-flight.ts) counts, right after each frame is
// submitted, the frames the GPU has not finished, that frame included; it also times the last
// submit to the GPU going idle. Run alone on the reference machine, one GPU at a time
// (tests/perf/README.md):
//
//     PERF_GPU=intel-uhd npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-068-frames-in-flight.perf.ts
//     PERF_GPU=rtx-4060  npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/te-068-frames-in-flight.perf.ts
//
// Without PERF_GPU the benchmark is skipped. Each scenario records one result; run one at a time
// with `-t` when a `PERF_ID` names the record.

const FLIGHT_BUDGET = 2;
const PAN_MS = 5000;
const WARMUP_MS = 1000;
const MOVES = 200;

function percentile(values: number[], fraction: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

/** Calls `name` of the page module `module` (under tests/perf/harness) in the running editor. */
function caller(run: BrowserRun, module: string) {
    return <T>(name: string, ...args: unknown[]) =>
        run.page.evaluate<T>(
            `import("/tests/perf/harness/${module}.ts").then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
        );
}

function recordFlight(
    scenario: "pan" | "overview" | "paint",
    what: string,
    run: BrowserRun,
    flight: FlightRecord,
    details: Record<string, unknown>,
): void {
    // NGNE submits one command buffer per frame: the wrapper saw every frame of the viewport.
    expect(flight.submits).toBe(flight.frames);
    expect(flight.submits).toBeGreaterThan(0);
    const p95 = percentile(flight.inFlight, 0.95);
    console.log(
        `  p95 ${p95}, last submit to GPU idle ${flight.idleMs.toFixed(1)} ms, preview submits ${flight.otherSubmits} (max in flight ${flight.otherMaxInFlight})`,
    );
    record({
        id: `te-068-frames-in-flight-${scenario}`,
        ticket: "TE-068",
        measurement: `GPU frames in flight right after each submit, that frame included, during ${what}; ${gpu!.label}, window ${WINDOW.width} × ${WINDOW.height}, DPR 1`,
        statistic: `max of ${flight.submits} submitted frames`,
        unit: "count",
        budgetMs: FLIGHT_BUDGET,
        resultMs: Math.max(...flight.inFlight),
        details: {
            adapter: run.adapter,
            p95,
            median: percentile(flight.inFlight, 0.5),
            lastSubmitToIdleMs: flight.idleMs,
            frames: flight.frames,
            tiers: flight.tiers,
            previewSubmits: flight.otherSubmits,
            previewMaxInFlight: flight.otherMaxInFlight,
            ...details,
        },
    });
}

const describeBrowser = gpu ? describe : describe.skip;

describeBrowser("te-068 frames in flight", () => {
    it("pan at the live-tier threshold", async () => {
        const run = await openApp(1);
        try {
            const flight = caller(run, "te-068-frames-in-flight");
            const pan = caller(run, "te-013-pan");
            await flight("install");
            const prepared = await pan<Prepared>("prepare");
            await pan<PanRecord>("pan", WARMUP_MS);
            await flight("start");
            const panned = await pan<PanRecord>("pan", PAN_MS);
            const flown = await flight<FlightRecord>("stop");
            expect(flown.tiers).toEqual(["live"]);
            recordFlight("pan", "the TE-013 scripted pan at the live-tier threshold", run, flown, {
                canvas: prepared.canvas,
                sprites: prepared.sprites,
                durationMs: PAN_MS,
                callbackMedianMs: percentile(panned.submitMs, 0.5),
            });
        } finally {
            await run.close();
        }
    });

    it("pan at overview, in the chunk tier", async () => {
        const run = await openApp(1);
        try {
            const flight = caller(run, "te-068-frames-in-flight");
            const pan = caller(run, "te-013-pan");
            await flight("install");
            const opened = await caller(run, "te-015-chunk")<Built>("openReference");
            await pan<PanRecord>("pan", WARMUP_MS);
            await flight("start");
            const panned = await pan<PanRecord>("pan", PAN_MS);
            const flown = await flight<FlightRecord>("stop");
            expect(flown.tiers).toEqual(["chunk"]);
            recordFlight("overview", "the same pan with the whole map in view", run, flown, {
                canvas: opened.canvas,
                chunks: opened.chunks,
                durationMs: PAN_MS,
                callbackMedianMs: percentile(panned.submitMs, 0.5),
            });
        } finally {
            await run.close();
        }
    });

    it("paint stroke of the stamp brush", async () => {
        const run = await openApp(1);
        try {
            const flight = caller(run, "te-068-frames-in-flight");
            const paint = caller(run, "te-017-paint");
            await flight("install");
            const opened = await paint<Opened>("openReference");
            // TE-017's walk over 20 × 11 cells around the middle, a new cell at every move.
            const cells: [number, number][] = [];
            for (let n = 0; n <= MOVES; n++) {
                const row = Math.floor(n / 20);
                const column = row % 2 === 0 ? n % 20 : 19 - (n % 20);
                cells.push([118 + column, 122 + row]);
            }
            const at = (cell: [number, number]) =>
                paint<{ x: number; y: number }>("cellClient", cell[0], cell[1]);
            const { mouse } = run.page;
            const first = await at(cells[0]!);
            await mouse.move(first.x, first.y);
            await flight("start");
            await mouse.down();
            await paint("recorded", 1);
            for (let n = 1; n <= MOVES; n++) {
                const next = await at(cells[n]!);
                await mouse.move(next.x, next.y);
                await paint("recorded", n + 1);
            }
            await mouse.up();
            const flown = await flight<FlightRecord>("stop");
            const painted = await paint<PaintRecord>("result");
            expect(painted.undo).toBe("Stamp Brush");
            recordFlight("paint", "the TE-017 stroke of the stamp brush", run, flown, {
                canvas: opened.canvas,
                events: painted.ms.length,
                eventToFrameMedianMs: percentile(painted.ms, 0.5),
            });
        } finally {
            await run.close();
        }
    });
});
