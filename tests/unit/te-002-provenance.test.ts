import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { packNgsprite } from "../support/ngsprite";

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

// A verbatim `.ngsprite` is stored unpacked (`<file>.d/`, tests/support/ngsprite.ts) and is read
// as the archive its folder packs into.
const readLocal = (path: string): Uint8Array =>
    path.endsWith(".ngsprite.d/")
        ? packNgsprite(new URL(path, ROOT))
        : readFileSync(new URL(path, ROOT));

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

    // TE-003: the design system, primitives, shell and services copied from the sprite editor
    // (DESIGN §3.2, §3.3). Every file of these directories, and the files directly in src/ui,
    // is a copy with a row; src/ui/panels holds this editor's own dock sections.
    it("records every file of the copied interface directories", () => {
        const root = fileURLToPath(ROOT);
        const directories = [
            "src/app/dialogs",
            "src/app/notices",
            "src/app/platform",
            "src/ui/dialogs",
            "src/ui/dock",
            "src/ui/focus",
            "src/ui/gallery",
            "src/ui/platform",
            "src/ui/primitives",
            "src/ui/shell",
            "src/ui/styles",
            "src/ui/theme",
            "src/ui/toast",
        ];
        const files = [
            ...readdirSync(join(root, "src/ui"), { withFileTypes: true }),
            ...directories.flatMap((directory) =>
                readdirSync(join(root, directory), { recursive: true, withFileTypes: true }),
            ),
        ]
            .filter((entry) => entry.isFile())
            .map((entry) => relative(root, join(entry.parentPath, entry.name)))
            .map((path) => path.replaceAll("\\", "/"))
            .sort();
        expect(files.length).toBeGreaterThan(40);
        const recorded = new Set(rows.map((row) => row.path));
        expect(files.filter((path) => !recorded.has(path))).toEqual([]);
    });
});
