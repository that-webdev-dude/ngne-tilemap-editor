import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cellOrientation, cellSlot } from "../../src/core/cells";
import { RUNTIME_FILE, exportFiles } from "../../src/core/export";
import type { ExportFile } from "../../src/core/export";
import { effectiveValues, walkLayers } from "../../src/core/model";
import type { Project } from "../../src/core/model";
import { deserialize } from "../../src/core/project";
import { readTilemap } from "../../src/core/runtime/runtime";
import type * as Runtime from "../../src/core/runtime/runtime";
import { roundTripDifferences } from "../support/conformance";
import { CONFORMANCE_GRID, createConformanceProject } from "../support/conformanceProject";
import { createExportProject } from "../support/exportProject";
import { createReferenceProject } from "../support/referenceProject";

// TE-055, condition 2 of SPEC §10.3: export → `readTilemap` gives back the project's cells,
// flags, properties, collision and markers, for every map of the reference export project
// (tests/support/conformanceProject.ts), the FORMAT fixture golden-v1.ngtilemap, TE-053's export
// project and ENGINE §6's reference project. The files are the export's own bytes, and
// `readTilemap` is the one of the exported `ngne-tilemap.ts`, loaded as a game would load it.

const GOLDEN = fileURLToPath(new URL("../fixtures/format/golden-v1.ngtilemap", import.meta.url));

const FIXTURES: Record<string, () => Promise<Project>> = {
    "the reference export project": async () => createConformanceProject(),
    "the FORMAT fixture golden-v1.ngtilemap": async () => deserialize(readFileSync(GOLDEN)),
    "TE-053's export project": async () => createExportProject(),
    "ENGINE §6's reference project": async () => createReferenceProject(),
};

const decoder = new TextDecoder("utf-8", { fatal: true });

let folder = "";

beforeAll(() => {
    folder = mkdtempSync(join(tmpdir(), "te-055-"));
});

afterAll(() => {
    rmSync(folder, { recursive: true, force: true });
});

/** The exported `ngne-tilemap.ts` of `files`, as JavaScript, imported. */
async function exportedRuntime(
    files: readonly ExportFile[],
    name: string,
): Promise<typeof Runtime> {
    const runtime = files.find((file) => file.name === RUNTIME_FILE);
    if (!runtime) throw new Error("The export has no runtime.");
    const output = ts.transpileModule(decoder.decode(runtime.bytes), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    });
    const file = join(folder, `${name}.mjs`);
    writeFileSync(file, output.outputText);
    return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as typeof Runtime;
}

describe("export → readTilemap", () => {
    Object.entries(FIXTURES).forEach(([title, make], index) => {
        it(`gives back every map of ${title}`, { timeout: 120_000 }, async () => {
            const project = await make();
            const files = exportFiles(project);
            const runtime = await exportedRuntime(files, `fixture-${index}`);
            const text = (name: string) => {
                const file = files.find((item) => item.name === name);
                if (!file) throw new Error(`The export has no ${name}.`);
                return JSON.parse(decoder.decode(file.bytes)) as unknown;
            };
            const atlases = Object.fromEntries(
                project.tilesets.map((tileset) => [
                    tileset.exportName,
                    text(`${tileset.exportName}.atlas.json`),
                ]),
            );
            expect(project.maps.length).toBeGreaterThan(0);
            for (const map of project.maps) {
                const tilemap = runtime.readTilemap(
                    text(`${map.exportName}.tilemap.json`),
                    atlases,
                );
                expect(roundTripDifferences(project, map, tilemap), map.exportName).toEqual([]);
            }
        });
    });

    it("finds a changed cell, flag, property, collision shape and marker", () => {
        // The comparison is not blind: each change to the project is reported.
        const project = createConformanceProject();
        const files = exportFiles(project);
        const atlases = Object.fromEntries(
            project.tilesets.map((tileset) => {
                const file = files.find(
                    (item) => item.name === `${tileset.exportName}.atlas.json`,
                )!;
                return [tileset.exportName, JSON.parse(decoder.decode(file.bytes)) as unknown];
            }),
        );
        const map = project.maps.find((item) => item.exportName === "layers")!;
        const file = files.find((item) => item.name === `${map.exportName}.tilemap.json`)!;
        // The source runtime: the exported one is the same source plus tables (SPEC §11).
        const read = () => readTilemap(JSON.parse(decoder.decode(file.bytes)), atlases);

        const ground = map.layers[0]!;
        if (ground.type !== "tile") throw new Error("Ground is a tile layer.");
        const value = ground.cells.get(3, 2);
        ground.cells.set(3, 2, (value ^ 0x80000000) >>> 0);
        expect(roundTripDifferences(project, map, read()).join("\n")).toMatch(
            /layer 1: 1 cells differ/,
        );
        ground.cells.set(3, 2, value);
        expect(roundTripDifferences(project, map, read())).toEqual([]);

        project.tilesets[0]!.tiles[1]!.collision[0] = {
            shape: "rectangle",
            x: 0,
            y: 5,
            width: 16,
            height: 12,
        };
        map.properties[0] = { name: "music", type: "file", value: "cave.ogg" };
        const spawns = map.layers[4]!;
        if (spawns.type !== "marker") throw new Error("Spawns is a marker layer.");
        spawns.markers[0]!.x += 1;
        const found = roundTripDifferences(project, map, read()).join("\n");
        expect(found).toMatch(/tileset even tiles/);
        expect(found).toMatch(/map properties/);
        expect(found).toMatch(/layer 6 markers/);
    });
});

describe("the reference export project", () => {
    // What SPEC §10.3 asks the fixtures to cover, read from the project itself.
    const project = createConformanceProject();
    const tileLayers = project.maps.flatMap((map) =>
        [...walkLayers(map.layers)].flatMap(({ layer, ancestors }) =>
            layer.type === "tile"
                ? [{ map, layer, effective: effectiveValues(layer, ancestors) }]
                : [],
        ),
    );
    const tilesetOf = (slot: number) => project.tilesets.find((tileset) => tileset.slot === slot)!;
    /** The orientations each tileset is drawn in, over every map. */
    const orientations = new Map<string, Set<number>>();
    for (const { map, layer } of tileLayers) {
        for (let y = 0; y < map.height; y += 1) {
            for (let x = 0; x < map.width; x += 1) {
                const value = layer.cells.get(x, y);
                if (value === 0) continue;
                const name = tilesetOf(cellSlot(value)).exportName;
                const seen = orientations.get(name) ?? new Set<number>();
                seen.add(cellOrientation(value));
                orientations.set(name, seen);
            }
        }
    }

    it("draws all 8 orientations of odd, even and mixed tiles, of a tile larger than the grid and of a tile with an offset", () => {
        const odd = project.tilesets.filter((t) => t.tileWidth % 2 === 1 && t.tileHeight % 2 === 1);
        const even = project.tilesets.filter(
            (t) => t.tileWidth % 2 === 0 && t.tileHeight % 2 === 0,
        );
        const larger = project.tilesets.filter(
            (t) => t.tileWidth > CONFORMANCE_GRID && t.tileHeight > CONFORMANCE_GRID,
        );
        const offset = project.tilesets.filter((t) => t.offsetX !== 0 && t.offsetY !== 0);
        const mixed = project.tilesets.filter((t) => (t.tileWidth + t.tileHeight) % 2 === 1);
        for (const group of [odd, even, larger, offset, mixed]) {
            expect(group.length).toBeGreaterThan(0);
            for (const tileset of group) {
                expect([...(orientations.get(tileset.exportName) ?? [])].sort()).toEqual([
                    0, 1, 2, 3, 4, 5, 6, 7,
                ]);
            }
        }
    });

    it("has a parallax layer, an opacity layer and an image layer", () => {
        expect(
            tileLayers.some(
                ({ effective }) => effective.parallaxX !== 1 && effective.parallaxY !== 1,
            ),
        ).toBe(true);
        expect(tileLayers.some(({ effective }) => effective.opacity < 255)).toBe(true);
        expect(
            project.maps.some((map) =>
                [...walkLayers(map.layers)].some(({ layer }) => layer.type === "image"),
            ),
        ).toBe(true);
    });
});
