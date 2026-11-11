import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GOLDENS, fixtureMaps, fixtureReport, goldenName, goldenText } from "./te-061-support";

// TE-061: the import report of every TMJ fixture (SPEC §13 Fixtures, DESIGN §9) equals its
// committed golden in tests/fixtures/tmj-reports: the files the map needs, then the summary and
// the dropped or changed items grouped by BRIEF §7 row, or the refusal with its message.
//
// To write the goldens again after a deliberate change of the conversion:
// `WRITE_GOLDEN=1 npx vitest run te-061-reports`, then review the diff.

const maps = fixtureMaps();

if (process.env.WRITE_GOLDEN === "1") {
    mkdirSync(GOLDENS, { recursive: true });
    for (const name of maps) {
        writeFileSync(new URL(goldenName(name), GOLDENS), goldenText(await fixtureReport(name)));
    }
}

describe("TE-061 import reports", () => {
    it("has one golden per fixture map and no other", () => {
        expect(maps.length).toBeGreaterThan(20);
        const goldens = readdirSync(fileURLToPath(GOLDENS)).sort();
        expect(goldens).toEqual(maps.map(goldenName).sort());
    });

    it.each(maps)("%s: the report equals its golden", async (name) => {
        const golden = readFileSync(new URL(goldenName(name), GOLDENS), "utf8");
        expect(goldenText(await fixtureReport(name))).toBe(golden);
    });
});
