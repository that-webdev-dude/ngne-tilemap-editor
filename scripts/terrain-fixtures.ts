import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { terrainFixtureFiles } from "../tests/unit/support/terrainFixtures.ts";

// TE-042: writes the terrain fixtures of SPEC §5.2 into tests/fixtures/terrain/, replacing
// what is there. The definitions, the hand-traced goldens and the writers are in
// tests/unit/support/terrainFixtures.ts; the TE-042 test checks the committed files against
// them byte for byte.
//
//     node scripts/terrain-fixtures.ts

const folder = fileURLToPath(new URL("../tests/fixtures/terrain/", import.meta.url));
const files = terrainFixtureFiles();

mkdirSync(folder, { recursive: true });
for (const name of readdirSync(folder)) {
    if (!files.has(name)) rmSync(`${folder}${name}`);
}
for (const [name, bytes] of files) writeFileSync(`${folder}${name}`, bytes);
console.log(`Wrote ${files.size} files to tests/fixtures/terrain/.`);
