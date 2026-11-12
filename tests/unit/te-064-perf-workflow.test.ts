import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// TE-064: CI runs the perf pages report-only. The Perf workflow runs every benchmark on
// SwiftShader on each push, in a workflow of its own (so it gates no required run, as
// runtime-latest.yml), keeps the records as an artifact instead of writing docs/evidence, and no
// benchmark compares a result with its budget.

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");

describe("te-064 perf workflow", () => {
    const perf = read(".github/workflows/perf.yml");

    it("runs every benchmark on each push and pull request", () => {
        expect(perf).toMatch(/^on:\n {4}push:\n {4}pull_request:\n/m);
        expect(perf).toContain("npx vitest run --config vitest.perf.config.ts --silent=false\n");
        // No file filter after the command: every `*.perf.ts` of vitest.perf.config.ts.
        expect(read("vitest.perf.config.ts")).toContain('include: ["tests/perf/**/*.perf.ts"]');
    });

    it("runs on software WebGPU and keeps the records out of docs/evidence", () => {
        expect(perf).toContain("PERF_GPU: swiftshader\n");
        expect(perf).toContain("PERF_OUT: perf-results\n");
        expect(perf).toMatch(/PERF_SUFFIX: ci-swiftshader\n/);
        expect(perf).toMatch(/- name: Upload benchmark records\n\s+if: always\(\)\n/);
    });

    it("is not part of the required CI workflow", () => {
        expect(read(".github/workflows/ci.yml")).not.toContain("vitest.perf.config");
    });

    it("has no benchmark that asserts a budget", () => {
        const files = readdirSync(`${ROOT}tests/perf`).filter((name) => name.endsWith(".perf.ts"));
        expect(files.length).toBeGreaterThan(0);
        for (const name of files) {
            const source = read(`tests/perf/${name}`);
            // A budget is compared only by `record` (printed as within or over budget).
            expect(source, name).not.toMatch(/expect\([^)]*resultMs/);
            expect(source, name).not.toMatch(
                /expect\([^)]*\)\.toBeLessThan(?:OrEqual)?\(\s*[A-Z_]*BUDGET/,
            );
        }
    });
});
