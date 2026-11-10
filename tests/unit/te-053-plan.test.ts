import { describe, expect, it } from "vitest";
import {
    EXPORT_MARKER_FILE,
    RUNTIME_FILE,
    exportFileNames,
    exportFiles,
    exportMarkerBytes,
    readExportMarker,
} from "../../src/core/export";
import { GENERATOR } from "../../src/core/generator";
import { assertInvariants } from "../../src/core/model";
import type { Tileset } from "../../src/core/model";
import { TilesetPackError, packTileset } from "../../src/core/pack";
import { generateRuntime } from "../../src/core/runtime/generate";
import { validateAtlas } from "../../src/core/sprite/export/validateAtlas";
import { decodePng } from "../../src/core/sprite/png";
import { tilemapFor, validateTilemap } from "../../src/core/tilemap";
import { createExportProject } from "../support/exportProject";
import { sha256Hex } from "../support/sha256";

// TE-053: the export plan of SPEC §10.2 (`core/export`): every file of the export folder of
// FORMAT §5, its name and bytes, in write order, for a project with two maps, two tilesets and
// an image; a tileset whose atlas would exceed 8192 px fails naming the tileset.

const decoder = new TextDecoder("utf-8", { fatal: true });
const textOf = (bytes: Uint8Array) => decoder.decode(bytes);

const NAMES = [
    "ngne-tilemap.export.json",
    "grass.png",
    "rocks.png",
    "sky.png",
    "grass.atlas.json",
    "rocks.atlas.json",
    "level-1.tilemap.json",
    "level-2.tilemap.json",
    "ngne-tilemap.ts",
];

describe("export plan", () => {
    const project = createExportProject();
    const files = exportFiles(project);
    const file = (name: string) => files.find((each) => each.name === name)!;

    it("builds a valid project", () => {
        expect(() => assertInvariants(project)).not.toThrow();
    });

    it("names every file of FORMAT §5 in write order: marker, PNGs, atlases, tilemaps, runtime", () => {
        expect(files.map((each) => each.name)).toEqual(NAMES);
        expect(files.map((each) => each.kind)).toEqual([
            "marker",
            "tileset-png",
            "tileset-png",
            "image-png",
            "atlas",
            "atlas",
            "tilemap",
            "tilemap",
            "runtime",
        ]);
        expect(exportFileNames(project)).toEqual(NAMES);
        expect(EXPORT_MARKER_FILE).toBe(NAMES[0]);
        expect(RUNTIME_FILE).toBe(NAMES.at(-1));
    });

    it("writes the marker naming the project (FORMAT §5)", () => {
        const bytes = file(EXPORT_MARKER_FILE).bytes;
        expect(textOf(bytes)).toBe(
            `${JSON.stringify(
                {
                    format: "ngne-tilemap-export",
                    version: 1,
                    generator: GENERATOR,
                    projectId: "export-project",
                    projectName: "Export test",
                },
                null,
                4,
            )}\n`,
        );
        expect(readExportMarker(bytes)).toEqual({
            projectId: "export-project",
            projectName: "Export test",
        });
    });

    it("writes each tileset's packed PNG and its atlas, which validate (FORMAT §4)", async () => {
        for (const tileset of project.tilesets) {
            const packed = packTileset(tileset);
            const png = file(`${tileset.exportName}.png`).bytes;
            const image = await decodePng(png);
            expect(image.width).toBe(packed.image.width);
            expect(image.height).toBe(packed.image.height);
            expect(sha256Hex(image.data)).toBe(sha256Hex(packed.image.data));
            const text = textOf(file(`${tileset.exportName}.atlas.json`).bytes);
            expect(text).toBe(`${JSON.stringify(packed.atlas, null, 4)}\n`);
            const atlas = validateAtlas(JSON.parse(text), image);
            expect(atlas.image).toBe(`${tileset.exportName}.png`);
            expect(Object.keys(atlas.frames)).toEqual(
                tileset.tiles.map((tile) => `${tileset.exportName}-${tile.id}`),
            );
        }
        // Grass tiles 0 and 3 have the same pixels: one rectangle.
        const grass = JSON.parse(textOf(file("grass.atlas.json").bytes));
        const { x, y } = grass.frames["grass-0"];
        expect(grass.frames["grass-3"]).toMatchObject({ x, y });
        expect(Object.keys(grass.animations)).toEqual(["grass-1"]);
        // Rocks tiles are 15 × 9: rectangles of 16 × 10.
        const rocks = JSON.parse(textOf(file("rocks.atlas.json").bytes));
        expect(rocks.frames["rocks-0"]).toMatchObject({ w: 16, h: 10, sourceW: 15, sourceH: 9 });
    });

    it("writes the image's PNG with its pixels, colour type 6, bit depth 8", async () => {
        const png = file("sky.png").bytes;
        // IHDR: bit depth at byte 24, colour type at 25.
        expect([png[24], png[25]]).toEqual([8, 6]);
        const image = await decodePng(png);
        const sky = project.images[0]!;
        expect([image.width, image.height]).toEqual([sky.pixels.width, sky.pixels.height]);
        expect(sha256Hex(image.data)).toBe(sha256Hex(sky.pixels.data));
    });

    it("writes each map's tilemap, which validates against the atlases (FORMAT §3)", () => {
        const atlases = Object.fromEntries(
            project.tilesets.map((tileset) => [
                tileset.exportName,
                JSON.parse(textOf(file(`${tileset.exportName}.atlas.json`).bytes)),
            ]),
        );
        for (const map of project.maps) {
            const text = textOf(file(`${map.exportName}.tilemap.json`).bytes);
            expect(text).toBe(tilemapFor(project, map));
            const tilemap = validateTilemap(JSON.parse(text), atlases);
            expect(tilemap.name).toBe(map.exportName);
        }
        // Level 2 uses Rocks only; Level 1 both tilesets and the image.
        const level1 = JSON.parse(textOf(file("level-1.tilemap.json").bytes));
        const level2 = JSON.parse(textOf(file("level-2.tilemap.json").bytes));
        expect(level1.tilesets.map((each: { name: string }) => each.name)).toEqual([
            "grass",
            "rocks",
        ]);
        expect(level2.tilesets.map((each: { name: string }) => each.name)).toEqual(["rocks"]);
        expect(level1.layers.some((layer: { image?: string }) => layer.image === "sky.png")).toBe(
            true,
        );
    });

    it("writes the runtime generated for the folder's maps, tilesets and images", () => {
        const text = textOf(file(RUNTIME_FILE).bytes);
        expect(text).toBe(
            generateRuntime({
                tilemaps: ["level-1", "level-2"],
                tilesets: ["grass", "rocks"],
                images: ["sky"],
            }),
        );
        expect(text).toContain('export type TilemapName = "level-1" | "level-2";');
    });

    it("gives the same bytes every time and leaves the project as it was", () => {
        const before = JSON.stringify(project.tilesets.map((tileset) => tileset.tiles));
        const again = exportFiles(project);
        expect(again.map((each) => sha256Hex(each.bytes))).toEqual(
            files.map((each) => sha256Hex(each.bytes)),
        );
        expect(JSON.stringify(project.tilesets.map((tileset) => tileset.tiles))).toBe(before);
        expect(exportFiles(createExportProject()).map((each) => sha256Hex(each.bytes))).toEqual(
            files.map((each) => sha256Hex(each.bytes)),
        );
    });
});

/**
 * A tileset of 962 distinct tiles of 256 × 1 px: its atlas needs ⌈√962⌉ = 32 columns of
 * 256 + 2 px, 8256 px, over the 8192 px of FORMAT §4 (31 columns hold 961 tiles).
 */
function overflowingTileset(slot: number): Tileset {
    const count = 962;
    const width = 256;
    const data = new Uint8ClampedArray(width * count * 4);
    for (let tile = 0; tile < count; tile += 1) {
        for (let x = 0; x < width; x += 1) {
            const at = (tile * width + x) * 4;
            data[at] = tile & 0xff;
            data[at + 1] = tile >> 8;
            data[at + 2] = x;
            data[at + 3] = 255;
        }
    }
    return {
        id: "too-wide",
        name: "Too wide",
        exportName: "too-wide",
        class: "",
        slot,
        tileWidth: width,
        tileHeight: 1,
        offsetX: 0,
        offsetY: 0,
        columns: 1,
        pixels: { width, height: count, data },
        nextTileId: count,
        source: { kind: "image", fileName: "too-wide.png", margin: 0, spacing: 0 },
        tiles: Array.from({ length: count }, (_, id) => ({
            id,
            sourceKey: [0, id] as [number, number],
            fingerprint: sha256Hex(data.subarray(id * width * 4, (id + 1) * width * 4)),
            class: "",
            collision: [],
            animation: [],
            properties: [],
        })),
        terrainSets: [],
        properties: [],
    };
}

describe("export plan overflow", () => {
    it("fails naming the tileset whose atlas would exceed 8192 px", () => {
        const project = createExportProject();
        project.tilesets.push(overflowingTileset(3));
        expect(() => assertInvariants(project)).not.toThrow();
        let thrown: unknown;
        try {
            exportFiles(project);
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(TilesetPackError);
        const error = thrown as TilesetPackError;
        expect(error.code).toBe("atlas-size");
        expect(error.tilesetName).toBe("Too wide");
        expect(error.message).toContain('Tileset "Too wide"');
        expect(error.required).toEqual({ width: 8256, height: 31 * 4 });
    });
});

describe("export marker", () => {
    const valid = exportMarkerBytes({ id: "p-1", name: "Meadow ✿ game" });
    const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

    it("reads back what it writes, text beyond ASCII included", () => {
        expect(readExportMarker(valid)).toEqual({ projectId: "p-1", projectName: "Meadow ✿ game" });
    });

    it("reads anything else as no marker", () => {
        const base = { format: "ngne-tilemap-export", version: 1, generator: "x", projectId: "p" };
        expect(readExportMarker(new Uint8Array([0xff, 0x00]))).toBeNull();
        expect(readExportMarker(json([]))).toBeNull();
        expect(readExportMarker(json(null))).toBeNull();
        expect(
            readExportMarker(json({ ...base, projectName: "n", format: "ngne-tilemap" })),
        ).toBeNull();
        expect(readExportMarker(json({ ...base, projectName: "n", version: 2 }))).toBeNull();
        expect(readExportMarker(json({ ...base, projectName: 4 }))).toBeNull();
        expect(readExportMarker(json({ ...base, projectId: "", projectName: "n" }))).toBeNull();
        expect(readExportMarker(json({ ...base, projectName: "n" }))).toEqual({
            projectId: "p",
            projectName: "n",
        });
    });
});
