import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Verbatim copies stay byte-identical to their sprite editor source (DESIGN §3): every
// verbatim row of docs/PROVENANCE.md hashes to its recorded SHA-256, and every file of the
// sprite core subtree has a row.

const ROOT = new URL("../../", import.meta.url);
const PROVENANCE = readFileSync(new URL("docs/PROVENANCE.md", ROOT), "utf8");

interface Row {
    path: string;
    kind: string;
    sha256: string;
}

const rows: Row[] = PROVENANCE.split("\n")
    .filter((line) => line.startsWith("| `"))
    .map((line) => line.split("|").map((cell) => cell.trim().replaceAll("`", "")))
    .map((cells) => ({ path: cells[1]!, kind: cells[3]!, sha256: cells[5]! }));
const verbatim = rows.filter((row) => row.kind === "verbatim");

function sha256(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

/** The verbatim rows whose file, as `read` gives it, does not hash to the recorded value. */
function mismatches(read: (path: string) => Uint8Array): string[] {
    return verbatim.filter((row) => sha256(read(row.path)) !== row.sha256).map((row) => row.path);
}

const readLocal = (path: string) => readFileSync(new URL(path, ROOT));

describe("provenance", () => {
    it("has a SHA-256 on every verbatim row", () => {
        expect(verbatim.length).toBeGreaterThan(0);
        for (const row of verbatim) expect(row.sha256, row.path).toMatch(/^[0-9a-f]{64}$/);
    });

    it("finds every verbatim file byte-identical to its recorded hash", () => {
        expect(mismatches(readLocal)).toEqual([]);
    });

    it("fails a copied file with one byte changed", () => {
        const edited = "src/core/sprite/export/pack.ts";
        const read = (path: string) => {
            const bytes = new Uint8Array(readLocal(path));
            if (path === edited) bytes[100] ^= 1;
            return bytes;
        };
        expect(mismatches(read)).toEqual([edited]);
    });

    it("records every file of src/core/sprite as a verbatim row", () => {
        const root = fileURLToPath(ROOT);
        const files = readdirSync(join(root, "src/core/sprite"), {
            recursive: true,
            withFileTypes: true,
        })
            .filter((entry) => entry.isFile())
            .map((entry) => relative(root, join(entry.parentPath, entry.name)))
            .map((path) => path.replaceAll("\\", "/"))
            .sort();
        const recorded = verbatim
            .map((row) => row.path)
            .filter((path) => path.startsWith("src/core/sprite/"))
            .sort();
        expect(recorded).toEqual(files);
    });
});
