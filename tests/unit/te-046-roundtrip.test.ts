import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, strFromU8 } from "fflate";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CellStore, assignFirstGids, cellValue, valueToGid } from "../../src/core/cells";
import { compositeThumbnail } from "../../src/core/compositor";
import { createTileLayer } from "../../src/core/model";
import type { Project, TileLayer } from "../../src/core/model";
import {
    PROJECT_FORMAT,
    PROJECT_GENERATOR,
    PROJECT_VERSION,
    deserialize,
    serialize,
} from "../../src/core/project";
import { decodePng } from "../../src/core/sprite/png";
import { createReferenceProject } from "../support/referenceProject";
import { comparable, everyMemberProject, makeTileset, tileLayerCount } from "./te-046-support";

// TE-046: the `.ngtilemap` writer and reader round-trip a project (FORMAT §2), write the same
// bytes for the same project, and read the committed golden file of version 1.
//
// The golden file is the every-member project as this writer writes it. To write it again
// after a deliberate change of the writer: `WRITE_GOLDEN=1 npx vitest run te-046-roundtrip`.

const GOLDEN = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../fixtures/format/golden-v1.ngtilemap",
);

if (process.env.WRITE_GOLDEN === "1") {
    mkdirSync(dirname(GOLDEN), { recursive: true });
    writeFileSync(GOLDEN, serialize(everyMemberProject()));
}

/** The entries of a written file by name. */
function entries(bytes: Uint8Array): Record<string, Uint8Array> {
    return unzipSync(bytes);
}

describe("serialize → deserialize", () => {
    it("gives back the every-member project", async () => {
        const project = everyMemberProject();
        const read = await deserialize(serialize(project));
        expect(tileLayerCount(read)).toBe(4);
        expect(comparable(read)).toEqual(comparable(project));
        // Slots come back as list positions, which the fixture already uses.
        expect(read.tilesets.map((tileset) => tileset.slot)).toEqual([1, 2, 3, 4]);
        expect(read).toEqual(
            expect.objectContaining({ id: project.id, exportSettings: { exportOnSave: true } }),
        );
    });

    it("gives back the reference project", { timeout: 60_000 }, async () => {
        const project = createReferenceProject();
        const bytes = serialize(project);
        const read = await deserialize(bytes);
        expect(comparable(read)).toEqual(comparable(project));
        expect(serialize(read)).toEqual(bytes);
    });

    it("gives back cells under other slots, through the GIDs of the file", async () => {
        const project = everyMemberProject();
        // Reorder the slots: the file has no slots, so the cells come back under list positions.
        const permuted = [3, 1, 4, 2];
        const before = comparable(project);
        const slotOf = new Map(
            project.tilesets.map((tileset, index) => [tileset.slot, permuted[index]!]),
        );
        for (const map of project.maps) {
            for (const layer of map.layers.flatMap(function flat(item): TileLayer[] {
                return item.type === "tile"
                    ? [item]
                    : item.type === "group"
                      ? item.layers.flatMap(flat)
                      : [];
            })) {
                const cells = new CellStore();
                for (let y = 0; y < map.height; y += 1) {
                    for (let x = 0; x < map.width; x += 1) {
                        const value = layer.cells.get(x, y);
                        if (value === 0) continue;
                        const slot = slotOf.get((value >>> 20) & 0xff)!;
                        cells.set(x, y, ((value & ~(0xff << 20)) | (slot << 20)) >>> 0);
                    }
                }
                layer.cells = cells;
            }
        }
        project.tilesets.forEach((tileset, index) => (tileset.slot = permuted[index]!));
        expect(comparable(project)).toEqual(before);
        const read = await deserialize(serialize(project));
        expect(comparable(read)).toEqual(before);
        expect(serialize(read)).toEqual(serialize(project));
    });
});

describe("byte stability", () => {
    it("serializing twice gives identical bytes", () => {
        expect(serialize(everyMemberProject())).toEqual(serialize(everyMemberProject()));
        const project = everyMemberProject();
        expect(serialize(project)).toEqual(serialize(project));
    });

    it("writes the entries of FORMAT §2.2 in its order, JSON deflated and PNG stored", () => {
        const bytes = serialize(everyMemberProject());
        const names = Object.keys(entries(bytes));
        expect(names).toEqual([
            "manifest.json",
            "project.json",
            "maps/map-town.json",
            "maps/map-dungeon.json",
            "tilesets/TS-image.png",
            "tilesets/ts-sprite.png",
            "tilesets/ts-atlas.png",
            "tilesets/ts_collection.png",
            "images/img-1.png",
            "images/img-2.png",
            "thumbs/map-town.png",
            "thumbs/map-dungeon.png",
        ]);
        // Local headers: method 8 for JSON, 0 for PNG; time 00:00, date 1980-01-01; no extra.
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let at = 0;
        for (const name of names) {
            expect(view.getUint32(at, true)).toBe(0x04034b50);
            expect(view.getUint16(at + 6, true)).toBe(0);
            expect(view.getUint16(at + 8, true)).toBe(name.endsWith(".json") ? 8 : 0);
            expect(view.getUint16(at + 10, true)).toBe(0);
            expect(view.getUint16(at + 12, true)).toBe(0x21);
            expect(view.getUint16(at + 28, true)).toBe(0);
            at += 30 + view.getUint16(at + 26, true) + view.getUint32(at + 18, true);
        }
    });

    it("writes the manifest, four-space indents, one map row per line and a final line feed", () => {
        const files = entries(serialize(everyMemberProject()));
        expect(JSON.parse(strFromU8(files["manifest.json"]!))).toEqual({
            format: PROJECT_FORMAT,
            version: PROJECT_VERSION,
            generator: PROJECT_GENERATOR,
        });
        expect(strFromU8(files["manifest.json"]!)).toBe(
            '{\n    "format": "ngne-tilemap-project",\n    "version": 1,\n' +
                '    "generator": "ngne-tilemap-editor 1.0.0"\n}\n',
        );
        const dungeon = strFromU8(files["maps/map-dungeon.json"]!);
        expect(dungeon.endsWith("}\n")).toBe(true);
        // 40 × 3 cells: three rows of 40 values, each on its own line.
        const block = /"data": \[\n((?:.*\n){3}) *\]/.exec(dungeon);
        expect(block).not.toBeNull();
        const rows = block![1]!.trimEnd().split("\n");
        expect(rows).toHaveLength(3);
        for (const row of rows) {
            expect(row.trim().replace(/,$/, "").split(", ")).toHaveLength(40);
            expect(row.startsWith(" ".repeat(16))).toBe(true);
        }
        // The members of the map in the order of the table.
        expect(Object.keys(JSON.parse(dungeon) as object)).toEqual([
            "id",
            "name",
            "exportName",
            "class",
            "orientation",
            "width",
            "height",
            "tileWidth",
            "tileHeight",
            "backgroundColor",
            "parallaxOriginX",
            "parallaxOriginY",
            "nextLayerId",
            "nextMarkerId",
            "tilesets",
            "layers",
            "properties",
        ]);
    });

    it("lists exactly the tilesets a map's cells use, in project order, from firstGid 1", () => {
        const files = entries(serialize(everyMemberProject()));
        const town = JSON.parse(strFromU8(files["maps/map-town.json"]!)) as { tilesets: unknown };
        const dungeon = JSON.parse(strFromU8(files["maps/map-dungeon.json"]!)) as {
            tilesets: unknown;
        };
        // nextTileId: 8, 7, 6, 5.
        expect(town.tilesets).toEqual([
            { tileset: "TS-image", firstGid: 1 },
            { tileset: "ts-sprite", firstGid: 9 },
            { tileset: "ts-atlas", firstGid: 16 },
        ]);
        expect(dungeon.tilesets).toEqual([{ tileset: "ts_collection", firstGid: 1 }]);
    });
});

describe("the golden file", () => {
    it("exists", () => {
        expect(existsSync(GOLDEN)).toBe(true);
    });

    it("reads as the every-member project and re-serializes to the same bytes", async () => {
        const golden = new Uint8Array(readFileSync(GOLDEN));
        const read = await deserialize(golden);
        expect(comparable(read)).toEqual(comparable(everyMemberProject()));
        expect(serialize(read)).toEqual(golden);
    });
});

describe("thumbnails (FORMAT §2.7)", () => {
    it("holds each map's composite at its thumbnail size as an 8-bit RGBA PNG", async () => {
        const project = everyMemberProject();
        const files = entries(serialize(project));
        for (const map of project.maps) {
            const bytes = files[`thumbs/${map.id}.png`]!;
            expect(bytes[25]).toBe(6); // colour type 6
            expect(bytes[24]).toBe(8); // bit depth 8
            const thumbnail = await decodePng(bytes);
            expect(thumbnail).toEqual(compositeThumbnail(project, map));
        }
        // Town: 72 × 30 px, kept. Dungeon: 640 × 24 px, scaled to 128 × round(4.8) = 5.
        const town = await decodePng(files["thumbs/map-town.png"]!);
        const dungeon = await decodePng(files["thumbs/map-dungeon.png"]!);
        expect([town.width, town.height]).toEqual([72, 30]);
        expect([dungeon.width, dungeon.height]).toEqual([128, 5]);

        // Checked against the tileset's pixels, not the compositor: dungeon pixel (x, 2) shows map
        // pixel (floor((x + 0.5) × 640 / 128), floor(2.5 × 24 / 5)) = (…, 12), cell row 1. Pixel 0
        // shows map pixel (2, 12): cell (0, 1), empty, so transparent. Pixel 4 shows map pixel
        // (22, 12): cell (1, 1), tile 0 of ts_collection (row 0 of its one-column image), at
        // (6, 4) inside the tile.
        const at = (buffer: { width: number; data: Uint8ClampedArray }, x: number, y: number) => [
            ...buffer.data.subarray((y * buffer.width + x) * 4, (y * buffer.width + x) * 4 + 4),
        ];
        const collection = project.tilesets[3]!.pixels;
        expect(at(dungeon, 0, 2)).toEqual([0, 0, 0, 0]);
        expect(at(collection, 6, 4)[3]).toBeGreaterThan(0); // a visible pixel, not a blank one
        expect(at(dungeon, 4, 2)).toEqual(at(collection, 6, 4));
    });

    it("is not needed by the reader", async () => {
        const files = entries(serialize(everyMemberProject()));
        delete files["thumbs/map-town.png"];
        files["thumbs/map-dungeon.png"] = new Uint8Array([1, 2, 3]);
        const { zipSync } = await import("fflate");
        const read = await deserialize(zipSync(files));
        expect(comparable(read)).toEqual(comparable(everyMemberProject()));
    });
});

/** A project of one map whose single tile layer holds `cells`, over `tilesets` (count, nextTileId). */
function cellProject(
    width: number,
    height: number,
    tilesets: readonly { tiles: number; slot: number; idBase?: number }[],
    cells: readonly number[],
): Project {
    const project = everyMemberProject();
    project.images = [];
    project.tilesets = tilesets.map(({ tiles, slot, idBase = 0 }, index) => {
        const tileset = makeTileset({
            id: `t${index}`,
            slot,
            kind: "image",
            tiles,
            columns: 4,
            tileWidth: 2,
            tileHeight: 2,
        });
        // Tile IDs from `idBase` on: large IDs make large GIDs and spans.
        for (const tile of tileset.tiles) tile.id += idBase;
        tileset.nextTileId += idBase;
        return tileset;
    });
    const layer = createTileLayer(1, "Cells");
    cells.forEach((value, index) => {
        if (value !== 0) layer.cells.set(index % width, Math.floor(index / width), value);
    });
    project.maps = [
        { ...project.maps[1]!, width, height, nextLayerId: 2, nextMarkerId: 1, layers: [layer] },
    ];
    return project;
}

describe("fast-check: cell values and GIDs through the file", () => {
    it("writes each cell as its GID and reads the same value back", async () => {
        const tilesetArb = fc.array(fc.integer({ min: 1, max: 9 }), { minLength: 1, maxLength: 4 });
        const scenario = tilesetArb.chain((counts) =>
            fc.record({
                counts: fc.constant(counts),
                idBases: fc.array(fc.integer({ min: 0, max: 1_048_560 }), {
                    minLength: counts.length,
                    maxLength: counts.length,
                }),
                slots: fc.shuffledSubarray(
                    Array.from({ length: 255 }, (_, i) => i + 1),
                    { minLength: counts.length, maxLength: counts.length },
                ),
                width: fc.integer({ min: 1, max: 7 }),
                height: fc.integer({ min: 1, max: 5 }),
                picks: fc.array(
                    fc.record({
                        empty: fc.boolean(),
                        tileset: fc.nat(),
                        tile: fc.nat(),
                        orientation: fc.integer({ min: 0, max: 7 }),
                    }),
                    { minLength: 35, maxLength: 35 },
                ),
            }),
        );
        await fc.assert(
            fc.asyncProperty(scenario, async ({ counts, idBases, slots, width, height, picks }) => {
                const tilesets = counts.map((tiles, index) => ({
                    tiles,
                    slot: slots[index]!,
                    idBase: idBases[index]!,
                }));
                const project = cellProject(width, height, tilesets, []);
                const cells = picks.slice(0, width * height).map((pick) => {
                    if (pick.empty) return 0;
                    const tileset = project.tilesets[pick.tileset % tilesets.length]!;
                    const tile = tileset.tiles[pick.tile % tileset.tiles.length]!;
                    return cellValue(tileset.slot, tile.id, pick.orientation as 0);
                });
                const withCells = cellProject(width, height, tilesets, cells);
                const bytes = serialize(withCells);

                // The file holds GIDs of the table of the tilesets used, in project order.
                const map = JSON.parse(
                    strFromU8(entries(bytes)[`maps/${withCells.maps[0]!.id}.json`]!),
                ) as { layers: { data: number[] }[] };
                const used = new Set(
                    cells.filter((value) => value !== 0).map((v) => (v >>> 20) & 0xff),
                );
                const table = assignFirstGids(withCells.tilesets.filter((t) => used.has(t.slot)));
                expect(map.layers[0]!.data).toEqual(cells.map((value) => valueToGid(value, table)));

                const read = await deserialize(bytes);
                expect(comparable(read)).toEqual(comparable(withCells));
            }),
            { numRuns: 60 },
        );
    });
});
