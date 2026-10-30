import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Manifest {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
}
interface Lockfile {
    packages: Record<string, { version?: string }>;
}

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const manifest = JSON.parse(read("package.json")) as Manifest;
const lockfile = JSON.parse(read("package-lock.json")) as Lockfile;

/**
 * One table of SUITE §5, by its header cell, as `{ name: version }`. A row may name several
 * packages (`react`, `react-dom`); its version is the first `x.y.z` of the second cell.
 */
function suiteTable(header: string): Record<string, string> {
    const suite = read("docs/SUITE.md");
    const section = /^## 5\. Stack$([\s\S]*?)^## /m.exec(suite)?.[1] ?? "";
    const lines = section.split("\n");
    const start = lines.findIndex((line) => line.startsWith(`| ${header} |`));
    if (start < 0) throw new Error(`SUITE §5 has no table "${header}"`);
    const table: Record<string, string> = {};
    for (const line of lines.slice(start + 2)) {
        if (!line.startsWith("|")) break;
        const [names = "", version = ""] = line.split("|").slice(1, 3);
        const exact = /^\s*(\d+\.\d+\.\d+)/.exec(version)?.[1];
        if (!exact) throw new Error(`SUITE §5 row without a version: ${line}`);
        for (const [, name] of names.matchAll(/`([^`]+)`/g)) table[name!] = exact;
    }
    return table;
}

describe("package.json", () => {
    it("has exactly the runtime dependencies of SUITE §5", () => {
        expect(manifest.dependencies).toEqual(suiteTable("Runtime dependency"));
        expect(manifest.dependencies["@ngne/core"]).toBe("0.3.0");
    });

    it("has exactly the development dependencies of SUITE §5", () => {
        expect(manifest.devDependencies).toEqual(suiteTable("Dev dependency"));
    });

    it("pins every dependency to an exact version, and the lockfile installs it", () => {
        const all = { ...manifest.dependencies, ...manifest.devDependencies };
        for (const [name, version] of Object.entries(all)) {
            expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
            expect(lockfile.packages[`node_modules/${name}`]?.version, name).toBe(version);
        }
    });
});
