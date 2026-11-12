import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extraEnvironment, namedEntry, record } from "../perf/record";
import type { PerfEntry } from "../perf/record";

// TE-064: the benchmark record names one GPU's records with PERF_SUFFIX, adds the machine's facts
// of PERF_ENV to the environment, and writes to PERF_OUT (tests/perf/README.md).

const ENTRY: PerfEntry = {
    id: "te-013-pan-submit-dpr1",
    ticket: "TE-013",
    measurement: "pan",
    statistic: "p95",
    budgetMs: 10,
    resultMs: 7.5,
    details: {},
};

describe("te-064 benchmark record", () => {
    beforeEach(() => {
        // The shell that runs the tests may set them; each test sets what it needs.
        for (const name of ["PERF_ID", "PERF_SUFFIX", "PERF_ENV", "PERF_OUT", "PERF_RECORD"])
            vi.stubEnv(name, "");
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("appends PERF_SUFFIX to every record's id and keeps the benchmark's id", () => {
        vi.stubEnv("PERF_SUFFIX", "intel-uhd");
        const first = namedEntry(ENTRY);
        const second = namedEntry({ ...ENTRY, id: "te-013-pan-dropped-dpr1" });
        expect(first.id).toBe("te-013-pan-submit-dpr1-intel-uhd");
        expect(first.benchmarkId).toBe("te-013-pan-submit-dpr1");
        expect(second.id).toBe("te-013-pan-dropped-dpr1-intel-uhd");
    });

    it("rejects a PERF_SUFFIX that is no plain file name, and PERF_ID with PERF_SUFFIX", () => {
        vi.stubEnv("PERF_SUFFIX", "../x");
        expect(() => namedEntry(ENTRY)).toThrow(/PERF_SUFFIX/);
        vi.stubEnv("PERF_SUFFIX", "rtx-4060");
        vi.stubEnv("PERF_ID", "te-013-cloud");
        expect(() => namedEntry(ENTRY)).toThrow(/both set/);
    });

    it("leaves the id alone without PERF_SUFFIX or PERF_ID", () => {
        expect(namedEntry(ENTRY)).toEqual(ENTRY);
    });

    it("reads PERF_ENV as a JSON object only", () => {
        expect(extraEnvironment()).toEqual({});
        vi.stubEnv("PERF_ENV", '{"chrome":"157.0","powerPlan":"Balanced"}');
        expect(extraEnvironment()).toEqual({ chrome: "157.0", powerPlan: "Balanced" });
        vi.stubEnv("PERF_ENV", "[1]");
        expect(() => extraEnvironment()).toThrow(/JSON object/);
    });

    it("writes the record under its suffixed id to PERF_OUT with the machine's facts", () => {
        const folder = mkdtempSync(join(tmpdir(), "te-064-record-"));
        try {
            vi.spyOn(console, "log").mockImplementation(() => {});
            vi.stubEnv("PERF_RECORD", "1");
            vi.stubEnv("PERF_SUFFIX", "rtx-4060");
            vi.stubEnv("PERF_OUT", folder);
            vi.stubEnv("PERF_ENV", '{"powerMode":"Best performance"}');
            record(ENTRY);
            const written = JSON.parse(
                readFileSync(join(folder, "te-013-pan-submit-dpr1-rtx-4060.json"), "utf8"),
            );
            expect(written.id).toBe("te-013-pan-submit-dpr1-rtx-4060");
            expect(written.benchmarkId).toBe("te-013-pan-submit-dpr1");
            expect(written.pass).toBe(true);
            expect(written.environment.powerMode).toBe("Best performance");
            expect(typeof written.environment.cpu).toBe("string");
        } finally {
            vi.restoreAllMocks();
            rmSync(folder, { recursive: true, force: true });
        }
    });
});
