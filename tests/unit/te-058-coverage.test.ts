import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// TE-058: every BRIEF §7 row and every SPEC §13 coverage item is named by at least one entry of
// tests/fixtures/tmj/README.md whose file exists. The BRIEF rows are read from the table in
// docs/BRIEF.md §7; the SPEC items are the Fixtures bullet of SPEC §13, one per kind of input.

const FOLDER = new URL("../fixtures/tmj/", import.meta.url);
const BRIEF = new URL("../../docs/BRIEF.md", import.meta.url);

/** The SPEC §13 Fixtures bullet, split into one item per input it names. */
const SPEC_ITEMS = [
    "isometric map",
    "hexagonal map",
    "infinite map",
    "csv data",
    "base64 uncompressed data",
    "zlib data",
    "gzip data",
    "zstd data",
    "all 8 flip combinations",
    "bit 28 set",
    "image tileset",
    "image-collection tileset, uniform",
    "image-collection tileset, mixed",
    "embedded tileset",
    "`.tsj` tileset",
    "`.tsx` tileset",
    "every object shape",
    "rotated object",
    "tile object",
    "text object",
    "capsule object",
    "templates",
    "every property type",
    "class property",
    "enum property",
    "`object` property",
    "`list` property",
    "tint",
    "blend mode",
    "terrain probabilities",
    "terrain transformations",
    "`transparentcolor`",
    "`tilerendersize`",
    "1000 × 40 side-scroller",
    "256 × 256 overworld with groups and parallax",
    "small dungeon with markers and collision",
];

interface Entry {
    readonly file: string;
    readonly brief: string[];
    readonly spec: string[];
    readonly uses: string[];
    readonly look: string;
}

/** The Input column of the BRIEF §7 table. */
function briefRows(): string[] {
    const text = readFileSync(BRIEF, "utf8");
    const section = text.slice(text.indexOf("## 7. TMJ import"), text.indexOf("## 8."));
    const rows = section
        .split("\n")
        .filter((line) => line.startsWith("| "))
        .slice(2) // header and separator
        .map((line) => line.split(" | ")[0]!.slice(2).trim());
    return rows;
}

function readmeEntries(): Entry[] {
    const text = readFileSync(new URL("README.md", FOLDER), "utf8");
    const parts = text.split(/^### `([^`]+)`$/m).slice(1);
    const entries: Entry[] = [];
    for (let i = 0; i < parts.length; i += 2) {
        const body = parts[i + 1]!;
        const line = (label: string) =>
            body
                .split("\n")
                .find((l) => l.startsWith(`- ${label}: `))
                ?.slice(label.length + 4) ?? "";
        const list = (label: string) => (line(label) ? line(label).split("; ") : []);
        entries.push({
            file: parts[i]!,
            brief: list("BRIEF §7"),
            spec: list("SPEC §13"),
            uses: [...line("Uses").matchAll(/`([^`]+)`/g)].map((match) => match[1]!),
            look: line("In Tiled"),
        });
    }
    return entries;
}

const exists = (path: string) => existsSync(new URL(path, FOLDER));

describe("TE-058 TMJ fixture coverage", () => {
    const entries = readmeEntries();

    it("reads the fifteen BRIEF §7 rows", () => {
        const rows = briefRows();
        expect(rows).toHaveLength(15);
        expect(rows).toContain("Non-orthogonal map");
        expect(rows).toContain(
            "Terrain probability, terrain-set transformations, tile probability",
        );
    });

    it.each(briefRows())("BRIEF §7 row %s is named by an entry whose file exists", (row) => {
        const named = entries.filter((entry) => entry.brief.includes(row));
        expect(named.length, row).toBeGreaterThan(0);
        expect(named.some((entry) => exists(entry.file))).toBe(true);
    });

    it.each(SPEC_ITEMS)("SPEC §13 item %s is named by an entry whose file exists", (item) => {
        const named = entries.filter((entry) => entry.spec.includes(item));
        expect(named.length, item).toBeGreaterThan(0);
        expect(named.some((entry) => exists(entry.file))).toBe(true);
    });

    it("names only BRIEF rows and SPEC items that exist", () => {
        const rows = new Set(briefRows());
        for (const entry of entries) {
            for (const row of entry.brief)
                expect(rows.has(row), `${entry.file}: ${row}`).toBe(true);
            for (const item of entry.spec) {
                expect(SPEC_ITEMS.includes(item), `${entry.file}: ${item}`).toBe(true);
            }
        }
    });

    it("lists every map once, with what it uses and how it looks in Tiled", () => {
        const maps = readdirSync(FOLDER).filter((name) => name.endsWith(".tmj"));
        expect(entries.map((entry) => entry.file).sort()).toEqual(maps.sort());
        for (const entry of entries) {
            expect(entry.look.length, entry.file).toBeGreaterThan(20);
            for (const use of entry.uses) expect(exists(use), `${entry.file} → ${use}`).toBe(true);
        }
    });
});
