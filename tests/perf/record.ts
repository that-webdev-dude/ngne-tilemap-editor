import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, platform, release, totalmem } from "node:os";
import { fileURLToPath } from "node:url";

// A benchmark measures and calls `record`. The result is always printed; the file under
// docs/evidence is written only with PERF_RECORD=1, which the orchestrator sets when it runs the
// measurement alone on the reference hardware (RULES 8).
//
// PERF_ID names one run's record: with it, the record is printed and written under
// that id instead of the benchmark's own, which it keeps as `benchmarkId`. A run on other
// hardware is then recorded beside the reference records without replacing them, for example
// `PERF_ID=te-017-paint-cloud-swiftshader` (tests/perf/README.md). Without PERF_ID nothing
// changes. A process records once under a PERF_ID: a second record would replace the first.
//
// PERF_SUFFIX names every record of a process: each is printed and written under
// `<benchmark id>-<suffix>`, keeping the benchmark's id as `benchmarkId`, so a benchmark that
// records several results is recorded once per GPU (`PERF_SUFFIX=intel-uhd`). PERF_ENV adds
// a JSON object of facts about the machine to the record's environment (the browser, power plan
// and refresh rate that `te-064-record-all.ts` reads). PERF_OUT writes the records to another
// directory than docs/evidence.

export interface PerfEntry {
    /** File name under docs/evidence without extension, for example `te-019-bucket-fill`. */
    id: string;
    ticket: string;
    /** What was measured, in one sentence. */
    measurement: string;
    /** How `resultMs` was taken from the samples, for example `median of 200 runs`. */
    statistic: string;
    /**
     * The budget the ticket or the SPEC states, in milliseconds. Without one the record is
     * for information: it has no `pass`, and the console says "no budget".
     */
    budgetMs?: number;
    /** The value compared with the budget, in milliseconds. */
    resultMs: number;
    /** The samples or summary statistics behind the result. */
    details: Record<string, unknown>;
    /**
     * What `resultMs` and `budgetMs` count: milliseconds (the default, when absent) or a
     * number of things, such as frames skipped. Written to the record only
     * when given.
     */
    unit?: "ms" | "count";
}

/** What PERF_ID and PERF_SUFFIX may be: a file name of lowercase letters, digits and single hyphens. */
const PERF_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The benchmark id last recorded under the current PERF_ID in this process. */
let recordedUnderId: { perfId: string; benchmarkId: string } | null = null;

/**
 * The entry as it is printed and written: under PERF_ID when that is set, or with PERF_SUFFIX
 * appended, with the benchmark's own id as `benchmarkId`. Throws for a PERF_ID or PERF_SUFFIX
 * that is no plain file name, for both set at once, and for a second record under the same
 * PERF_ID in one process.
 */
export function namedEntry(entry: PerfEntry): PerfEntry & { benchmarkId?: string } {
    const perfId = process.env.PERF_ID ?? "";
    const suffix = process.env.PERF_SUFFIX ?? "";
    if (perfId !== "" && suffix !== "") {
        throw new Error("PERF_ID and PERF_SUFFIX are both set; set one.");
    }
    if (suffix !== "") {
        if (!PERF_ID_PATTERN.test(suffix)) {
            throw new Error(
                `PERF_SUFFIX "${suffix}" is not a plain file name (a-z, 0-9, hyphens).`,
            );
        }
        return { ...entry, id: `${entry.id}-${suffix}`, benchmarkId: entry.id };
    }
    if (perfId === "") return entry;
    if (!PERF_ID_PATTERN.test(perfId)) {
        throw new Error(`PERF_ID "${perfId}" is not a plain file name (a-z, 0-9, hyphens).`);
    }
    if (recordedUnderId?.perfId === perfId) {
        throw new Error(
            `PERF_ID "${perfId}" already holds the record of ${recordedUnderId.benchmarkId}; ` +
                `${entry.id} would replace it. Run one benchmark per PERF_ID.`,
        );
    }
    recordedUnderId = { perfId, benchmarkId: entry.id };
    return { ...entry, id: perfId, benchmarkId: entry.id };
}

/** The facts of PERF_ENV, a JSON object; throws for anything else. */
export function extraEnvironment(): Record<string, unknown> {
    const text = process.env.PERF_ENV ?? "";
    if (text === "") return {};
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("PERF_ENV is not a JSON object.");
    }
    return value as Record<string, unknown>;
}

/** The console line of a record. */
export function recordLine(entry: PerfEntry): string {
    const count = entry.unit === "count";
    const shown = count ? String(entry.resultMs) : `${entry.resultMs.toFixed(3)} ms`;
    const result = `${entry.id}: ${shown} (${entry.statistic})`;
    if (entry.budgetMs === undefined) return `${result}, no budget`;
    const pass = entry.resultMs <= entry.budgetMs;
    const budget = count ? String(entry.budgetMs) : `${entry.budgetMs} ms`;
    return `${result}, budget ${budget}, ${pass ? "within" : "over"} budget`;
}

/**
 * Prints `entry`, and with PERF_RECORD=1 writes it to `<directory>/<id>.json` (PERF_OUT, else
 * docs/evidence) with the environment and the date, and `pass` when it has a budget. With
 * PERF_ID or PERF_SUFFIX the id is `namedEntry`'s.
 */
export function record(
    benchmarkEntry: PerfEntry,
    directory = process.env.PERF_OUT ||
        fileURLToPath(new URL("../../docs/evidence/", import.meta.url)),
): void {
    const entry = namedEntry(benchmarkEntry);
    console.log(recordLine(entry));
    if (process.env.PERF_RECORD !== "1") return;

    mkdirSync(directory, { recursive: true });
    const processors = cpus();
    const file = {
        ...entry,
        ...(entry.budgetMs === undefined ? {} : { pass: entry.resultMs <= entry.budgetMs }),
        environment: {
            node: process.version,
            platform: `${platform()} ${release()}`,
            cpu: processors[0]?.model.trim() ?? "unknown",
            cores: processors.length,
            memoryGb: Math.round(totalmem() / 2 ** 30),
            ...extraEnvironment(),
        },
        date: new Date().toISOString(),
    };
    const separator = directory.endsWith("/") || directory.endsWith("\\") ? "" : "/";
    writeFileSync(`${directory}${separator}${entry.id}.json`, `${JSON.stringify(file, null, 4)}\n`);
}
