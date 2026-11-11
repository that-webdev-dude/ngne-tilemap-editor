import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertInvariants, sequentialIds } from "../../src/core/model";
import type { PixelBuffer, Project, Tileset } from "../../src/core/model";
import { decodePng, encodePng } from "../../src/core/sprite/png";
import { importGridPng, tileFingerprint } from "../../src/core/tileset";
import {
    TmjError,
    convertTmjMap,
    convertTmjTilesets,
    groupReport,
    tiledColor,
    tmjImagePixels,
} from "../../src/core/tmj";
import type {
    TmjFiles,
    TmjMapConversion,
    TmjReportEntry,
    TmjReportRow,
    TmjTilesetConversion,
} from "../../src/core/tmj";
import { emptyProject, pngHeader } from "./te-022-support";

// TE-060: TMJ tileset conversion (SPEC §13, BRIEF §7). Every tileset of tests/fixtures/tmj
// converts to the project tileset its README describes, with the report entries of its row;
// TSX and TSJ of one tileset convert identically; colour keys are applied; mixed-size
// collections and tiles above 256 px are refused; an external tileset already in the project is
// reused.

const FOLDER = new URL("../fixtures/tmj/", import.meta.url);

const read = (path: string): Buffer | undefined => {
    try {
        return readFileSync(new URL(path, FOLDER));
    } catch {
        return undefined;
    }
};

/** The fixture folder, with `extra` files over it (text or bytes by path). */
function filesWith(extra: Record<string, string | Uint8Array> = {}): TmjFiles {
    return {
        text: (path) => {
            const own = extra[path];
            if (typeof own === "string") return own;
            return read(path)?.toString("utf8");
        },
        bytes: (path) => {
            const own = extra[path];
            if (own instanceof Uint8Array) return own;
            const bytes = read(path);
            return bytes === undefined ? undefined : new Uint8Array(bytes);
        },
    };
}

const fixtureText = (name: string): string => read(name)!.toString("utf8");

interface Imported {
    readonly map: TmjMapConversion;
    readonly tilesets: TmjTilesetConversion;
}

async function importMap(
    name: string,
    project: Project = emptyProject(),
    options: { text?: string; extra?: Record<string, string | Uint8Array> } = {},
): Promise<Imported> {
    const map = convertTmjMap(options.text ?? fixtureText(name), {
        fileName: name,
        template: (path) => read(path)?.toString("utf8"),
        newId: sequentialIds("m"),
    });
    const tilesets = await convertTmjTilesets(project, map.tilesets, {
        fileName: name,
        files: filesWith(options.extra),
        takenExportNames: [map.map.exportName],
        newId: sequentialIds("t"),
    });
    return { map, tilesets };
}

/**
 * Adds an import to `project` as the import will (TE-061): new tilesets, the images of its image
 * layers, then the map. The map's cells keep their map-local slots, so this holds for an import
 * into a project without tilesets and without reuse.
 */
async function addImport(project: Project, { map, tilesets }: Imported): Promise<void> {
    for (const tileset of tilesets.added) {
        tileset.slot = project.tilesets.length + 1;
        project.tilesets.push(tileset);
    }
    for (const image of map.images) {
        const pixels = await tmjImagePixels(
            new Uint8Array(read(image.path)!),
            image.transparentColor,
            image.path,
        );
        project.images.push({ id: image.id, name: image.id, exportName: image.id, pixels });
    }
    project.maps.push(map.map);
}

async function refusal(run: () => Promise<unknown>): Promise<TmjError> {
    try {
        await run();
    } catch (error) {
        if (error instanceof TmjError) return error;
        throw error;
    }
    throw new Error("Expected the import to be refused.");
}

const rows = (report: readonly TmjReportEntry[]): Partial<Record<TmjReportRow, number>> =>
    Object.fromEntries(groupReport(report).map((group) => [group.row, group.count]));

const details = (report: readonly TmjReportEntry[], row: TmjReportRow): string[] =>
    report.filter((entry) => entry.row === row).map((entry) => entry.detail);

const decoded = async (path: string): Promise<PixelBuffer> => decodePng(read(path)!);

function tile(tileset: Tileset, id: number) {
    const found = tileset.tiles.find((entry) => entry.id === id);
    if (!found) throw new Error(`No tile ${id}.`);
    return found;
}

function only(conversion: TmjTilesetConversion): Tileset {
    expect(conversion.added).toHaveLength(1);
    return conversion.added[0]!;
}

/** A tileset as plain data, its pixels as an array. Both imports number IDs alike. */
function content(tileset: Tileset): unknown {
    const { pixels } = tileset;
    return { ...tileset, pixels: { ...pixels, data: [...pixels.data] } };
}

describe("image tilesets", () => {
    it("converts an embedded tileset as TE-022 cuts the grid, IDs Tiled's", async () => {
        const { map, tilesets } = await importMap("tileset-embedded.tmj");
        const tileset = only(tilesets);
        expect(tileset).toMatchObject({
            name: "tiles-embedded",
            exportName: "tiles-embedded",
            class: "",
            tileWidth: 16,
            tileHeight: 16,
            columns: 8,
            offsetX: 0,
            offsetY: 0,
            nextTileId: 32,
            source: { kind: "image", fileName: "tiles.png", margin: 0, spacing: 0 },
            terrainSets: [],
            properties: [],
        });
        expect(tileset.tiles.map((entry) => entry.id)).toEqual([...Array(32).keys()]);
        expect(tile(tileset, 25).sourceKey).toEqual([1, 3]);
        const png = await decoded("tiles.png");
        expect(tileset.pixels.width).toBe(png.width);
        expect(tileset.pixels.height).toBe(png.height);
        expect([...tileset.pixels.data]).toEqual([...png.data]);
        expect(tilesets.slots).toEqual([tileset]);
        expect(tilesets.report).toEqual([]);
        expect(map.tilesets[0]!.usedTileIds).toEqual([0, 3, 4, 9, 24]);
    });

    it("names an external tileset after its file and reads its image beside it", async () => {
        const { tilesets } = await importMap("tileset-tsj.tmj");
        const tileset = only(tilesets);
        expect(tileset.name).toBe("tiles");
        expect(tileset.source).toEqual({
            kind: "image",
            fileName: "tiles.png",
            margin: 0,
            spacing: 0,
        });
        const embedded = only((await importMap("tileset-embedded.tmj")).tilesets);
        expect(tileset.tiles).toEqual(embedded.tiles);
        expect(tilesets.report).toEqual([]);
    });

    it("reads a TSX tileset: class and properties of its tiles", async () => {
        const { tilesets } = await importMap("tileset-tsx.tmj");
        const tileset = only(tilesets);
        expect(tileset.name).toBe("tiles-xml");
        expect(tile(tileset, 5)).toMatchObject({
            class: "Wall",
            properties: [{ name: "solid", type: "bool", value: true }],
        });
        expect(tile(tileset, 4)).toMatchObject({ class: "", properties: [] });
        expect(tilesets.report).toEqual([]);
    });

    it("keeps the class and properties of an embedded tileset and its tiles", async () => {
        const { tilesets } = await importMap("properties.tmj");
        const tileset = only(tilesets);
        expect(tileset).toMatchObject({ name: "typed", class: "Palette" });
        expect(tile(tileset, 0)).toMatchObject({
            class: "Grass",
            properties: [{ name: "walkable", type: "bool", value: true }],
        });
        expect(tilesets.report).toEqual([]);
    });

    it("keeps collision, animations and classes, dropping points, polylines and names", async () => {
        const { tilesets } = await importMap("dungeon.tmj");
        const tileset = only(tilesets);
        expect(tileset.name).toBe("dungeon");
        expect(tile(tileset, 5)).toMatchObject({
            class: "Wall",
            collision: [{ shape: "rectangle", x: 0, y: 0, width: 16, height: 16 }],
        });
        expect(tile(tileset, 12)).toMatchObject({
            collision: [{ shape: "rectangle", x: 4, y: 0, width: 8, height: 16 }],
            animation: [
                { tile: 12, ms: 200 },
                { tile: 13, ms: 200 },
            ],
        });
        expect(tile(tileset, 20).collision).toEqual([
            { shape: "ellipse", x: 2, y: 2, width: 12, height: 12 },
        ]);
        expect(tile(tileset, 21).collision).toEqual([
            {
                shape: "polygon",
                x: 0,
                y: 16,
                points: [
                    [0, 0],
                    [16, 0],
                    [16, -16],
                ],
            },
        ]);
        expect(tilesets.report).toEqual([
            {
                row: "collision-shapes",
                detail: "Point dropped",
                count: 1,
                where: { tileset: "dungeon", tile: 21, object: { id: 2, name: "anchor" } },
            },
            {
                row: "collision-shapes",
                detail: "Polyline dropped",
                count: 1,
                where: { tileset: "dungeon", tile: 21, object: { id: 3, name: "edge" } },
            },
        ]);
    });

    it("converts wang sets to terrain sets, dropping probabilities and transformations", async () => {
        const { tilesets } = await importMap("terrain.tmj");
        const tileset = only(tilesets);
        expect(tileset.terrainSets).toEqual([
            {
                name: "Ground",
                type: "corner",
                colors: [
                    { name: "Grass", color: "#5a9e3aff", tile: 0 },
                    { name: "Dirt", color: "#8a5a2bff", tile: 1 },
                ],
                tiles: [
                    { tile: 0, wangId: [0, 1, 0, 1, 0, 1, 0, 1] },
                    { tile: 1, wangId: [0, 2, 0, 2, 0, 2, 0, 2] },
                ],
            },
        ]);
        expect(rows(tilesets.report)).toEqual({ "terrain-probability": 3 });
        expect(details(tilesets.report, "terrain-probability")).toEqual([
            "Terrain-set transformations dropped (hflip, vflip, rotate)",
            "Tile probability 0.25 dropped",
            'Terrain "Dirt": probability 0.5 dropped',
        ]);
        const project = emptyProject();
        await addImport(project, await importMap("terrain.tmj"));
        expect(() => assertInvariants(project)).not.toThrow();
    });

    it("reports tile render size Grid and keeps the tiles at their own size", async () => {
        const { tilesets } = await importMap("tilerendersize.tmj");
        const tileset = only(tilesets);
        expect(tileset).toMatchObject({ tileWidth: 32, tileHeight: 32, nextTileId: 2 });
        expect(tilesets.report).toEqual([
            {
                row: "tile-render-size",
                detail: "Tile render size Grid dropped: tiles draw at tile size",
                count: 1,
                where: { tileset: "big" },
            },
        ]);
    });

    it("refuses a map whose cells name a tile beyond the tileset's image", async () => {
        const text = fixtureText("tileset-embedded.tmj").replace("[1, 1, 1, 1", "[40, 1, 1, 1");
        const error = await refusal(() => importMap("tileset-embedded.tmj", undefined, { text }));
        expect(error.code).toBe("gid");
        expect(error.message).toContain("tile 39");
    });

    it("refuses a missing tileset or image, naming its path", async () => {
        const missingTileset = await refusal(() =>
            importMap("tileset-tsj.tmj", undefined, {
                text: fixtureText("tileset-tsj.tmj").replace("tiles.tsj", "sets/gone.tsj"),
            }),
        );
        expect(missingTileset).toMatchObject({ code: "missing-file", path: "sets/gone.tsj" });
        const missingImage = await refusal(() =>
            importMap("tileset-tsj.tmj", undefined, {
                extra: { "tiles.tsj": fixtureText("tiles.tsj").replace("tiles.png", "gone.png") },
            }),
        );
        expect(missingImage).toMatchObject({ code: "missing-file", path: "gone.png" });
    });

    it("resolves an external tileset's image relative to the tileset", async () => {
        const text = fixtureText("tileset-tsj.tmj").replace("tiles.tsj", "sets/tiles.tsj");
        const tsj = fixtureText("tiles.tsj").replace('"tiles.png"', '"..\\/tiles.png"');
        const { tilesets } = await importMap("tileset-tsj.tmj", undefined, {
            text,
            extra: { "sets/tiles.tsj": tsj },
        });
        expect(only(tilesets).source.fileName).toBe("tiles.png");
    });
});

describe("TSX and TSJ", () => {
    // Each tileset in Tiled's other format, as Tiled 1.12.2 writes it, served under the same
    // path: the tileset is named after its file, so the two conversions can be compared whole.
    const TILES_XML_TSJ = JSON.stringify({
        columns: 8,
        image: "tiles.png",
        imageheight: 64,
        imagewidth: 128,
        margin: 0,
        name: "tiles-xml",
        spacing: 0,
        tilecount: 32,
        tiledversion: "1.12.2",
        tileheight: 16,
        tiles: [
            { id: 5, properties: [{ name: "solid", type: "bool", value: true }], type: "Wall" },
        ],
        tilewidth: 16,
        type: "tileset",
        version: "1.11",
    });

    const DUNGEON_TSX = `<?xml version="1.0" encoding="UTF-8"?>
<tileset version="1.11" tiledversion="1.12.2" name="dungeon" tilewidth="16" tileheight="16" tilecount="32" columns="8">
 <image source="tiles.png" width="128" height="64"/>
 <tile id="5" type="Wall">
  <objectgroup draworder="index">
   <object id="1" x="0" y="0" width="16" height="16"/>
  </objectgroup>
 </tile>
 <tile id="12">
  <objectgroup draworder="index">
   <object id="1" x="4" y="0" width="8" height="16"/>
  </objectgroup>
  <animation>
   <frame tileid="12" duration="200"/>
   <frame tileid="13" duration="200"/>
  </animation>
 </tile>
 <tile id="20">
  <objectgroup draworder="index">
   <object id="1" x="2" y="2" width="12" height="12">
    <ellipse/>
   </object>
  </objectgroup>
 </tile>
 <tile id="21">
  <objectgroup draworder="index">
   <object id="1" x="0" y="16">
    <polygon points="0,0 16,0 16,-16"/>
   </object>
   <object id="2" name="anchor" x="8" y="8">
    <point/>
   </object>
   <object id="3" name="edge" x="0" y="16">
    <polyline points="0,0 16,-16"/>
   </object>
  </objectgroup>
 </tile>
</tileset>
`;

    const TERRAIN_TSX = `<?xml version="1.0" encoding="UTF-8"?>
<tileset version="1.11" tiledversion="1.12.2" name="terrain" tilewidth="16" tileheight="16" tilecount="32" columns="8">
 <transformations hflip="1" vflip="1" rotate="1" preferuntransformed="1"/>
 <image source="tiles.png" width="128" height="64"/>
 <tile id="0" probability="0.25"/>
 <wangsets>
  <wangset name="Ground" type="corner" tile="0">
   <wangcolor name="Grass" color="#5a9e3a" tile="0" probability="1"/>
   <wangcolor name="Dirt" color="#8a5a2b" tile="1" probability="0.5"/>
   <wangtile tileid="0" wangid="0,1,0,1,0,1,0,1"/>
   <wangtile tileid="1" wangid="0,2,0,2,0,2,0,2"/>
  </wangset>
 </wangsets>
</tileset>
`;

    const PROPS_TSX = `<?xml version="1.0" encoding="UTF-8"?>
<tileset version="1.11" tiledversion="1.12.2" name="props" tilewidth="16" tileheight="16" tilecount="3" columns="0">
 <grid orientation="orthogonal" width="1" height="1"/>
 <tile id="0">
  <image source="images/crate.png" width="16" height="16"/>
 </tile>
 <tile id="1">
  <image source="images/barrel.png" width="16" height="16"/>
 </tile>
 <tile id="2">
  <image source="images/bush.png" width="16" height="16"/>
 </tile>
</tileset>
`;

    const cases = [
        { map: "tileset-tsx.tmj", path: "tiles-xml.tsx", other: TILES_XML_TSJ },
        { map: "dungeon.tmj", path: "dungeon.tsj", other: DUNGEON_TSX },
        { map: "terrain.tmj", path: "terrain.tsj", other: TERRAIN_TSX },
        { map: "collection-uniform.tmj", path: "props.tsj", other: PROPS_TSX },
    ];

    for (const { map, path, other } of cases) {
        it(`${path} converts as the same tileset in the other format`, async () => {
            const original = (await importMap(map)).tilesets;
            const swapped = (await importMap(map, undefined, { extra: { [path]: other } }))
                .tilesets;
            expect(swapped.added.map(content)).toEqual(original.added.map(content));
            expect(swapped.report).toEqual(original.report);
        });
    }
});

describe("image collections", () => {
    it("converts a collection of one tile size to a collection tileset", async () => {
        const { map, tilesets } = await importMap("collection-uniform.tmj");
        expect(tilesets.added).toHaveLength(2);
        const [props, tiles] = tilesets.added as [Tileset, Tileset];
        expect(props).toMatchObject({
            name: "props",
            tileWidth: 16,
            tileHeight: 16,
            nextTileId: 3,
            source: { kind: "collection", fileName: "props.tsj", margin: 0, spacing: 0 },
        });
        expect(props.tiles.map((entry) => [entry.id, entry.sourceKey])).toEqual([
            [0, "crate.png"],
            [1, "barrel.png"],
            [2, "bush.png"],
        ]);
        for (const [k, name] of ["crate", "barrel", "bush"].entries()) {
            const image = await decoded(`images/${name}.png`);
            expect(props.tiles[k]!.fingerprint).toBe(tileFingerprint(image, 0, 0, 16, 16));
        }
        expect(tiles.name).toBe("tiles");
        expect(tilesets.slots).toEqual([props, tiles]);
        expect(tilesets.report).toEqual([]);
        const project = emptyProject();
        await addImport(project, { map, tilesets });
        expect(() => assertInvariants(project)).not.toThrow();
    });

    it("keeps Tiled's IDs and next tile ID when IDs have gaps", async () => {
        // The bush becomes tile 7, as after deleting tiles in Tiled: its GID 3 becomes 8, and
        // the next tileset starts at 9 (Tiled's `firstgid += nextTileId`).
        const tsj = fixtureText("props.tsj").replace('"id":2,', '"id":7,');
        const json = JSON.parse(fixtureText("collection-uniform.tmj")) as {
            layers: { data: number[] }[];
            tilesets: { firstgid: number }[];
        };
        for (const layer of json.layers) {
            layer.data = layer.data.map((gid) => (gid === 3 ? 8 : gid >= 4 ? gid + 5 : gid));
        }
        json.tilesets[1]!.firstgid = 9;
        const { tilesets } = await importMap("collection-uniform.tmj", undefined, {
            extra: { "props.tsj": tsj },
            text: JSON.stringify(json),
        });
        const props = tilesets.added[0]!;
        expect(props.tiles.map((entry) => entry.id)).toEqual([0, 1, 7]);
        expect(props.nextTileId).toBe(8);
    });

    it("an embedded collection's source file is the map", async () => {
        const text = fixtureText("collection-uniform.tmj").replace(
            '{\n         "firstgid":1,\n         "source":"props.tsj"\n        }',
            JSON.stringify({ ...JSON.parse(fixtureText("props.tsj")), firstgid: 1 }),
        );
        const { tilesets } = await importMap("collection-uniform.tmj", undefined, { text });
        expect(tilesets.added[0]!.source.fileName).toBe("collection-uniform.tmj");
    });

    it("refuses a collection of mixed tile sizes", async () => {
        const error = await refusal(() => importMap("collection-mixed.tmj"));
        expect(error.code).toBe("mixed-sizes");
        expect(error.message).toContain("16 × 16, 16 × 32, 32 × 32");
    });
});

describe("tile sizes above 256", () => {
    const big = (width: number, height: number): Uint8Array =>
        encodePng({ width, height, data: new Uint8ClampedArray(width * height * 4) });

    it("refuse an image tileset", async () => {
        const json = JSON.parse(fixtureText("tileset-embedded.tmj")) as {
            tilesets: Record<string, unknown>[];
        };
        json.tilesets[0] = { ...json.tilesets[0], image: "huge.png", tilewidth: 300 };
        const error = await refusal(() =>
            importMap("tileset-embedded.tmj", undefined, {
                text: JSON.stringify(json),
                extra: { "huge.png": big(600, 16) },
            }),
        );
        expect(error.code).toBe("limit");
        expect(error.message).toContain("300 × 16");
    });

    it("refuse a collection whose one size is above 256", async () => {
        const json = JSON.parse(fixtureText("props.tsj")) as { tiles: Record<string, unknown>[] };
        json.tiles = json.tiles.map((entry, index) => ({ ...entry, image: `huge${index}.png` }));
        const error = await refusal(() =>
            importMap("collection-uniform.tmj", undefined, {
                extra: {
                    "props.tsj": JSON.stringify(json),
                    "huge0.png": big(257, 16),
                    "huge1.png": big(257, 16),
                    "huge2.png": big(257, 16),
                },
            }),
        );
        expect(error.code).toBe("limit");
        expect(error.message).toContain("257 × 16");
    });
});

describe("limits", () => {
    it("checks an image's size from its header before decoding it", async () => {
        const tsj = fixtureText("tiles.tsj").replace("tiles.png", "wide.png");
        const error = await refusal(() =>
            importMap("tileset-tsj.tmj", undefined, {
                extra: { "tiles.tsj": tsj, "wide.png": pngHeader(9000, 16) },
            }),
        );
        expect(error.code).toBe("limit");
        expect(error.message).toContain("9000 × 16");
    });

    it("counts the project's tilesets and the new ones", async () => {
        const project = emptyProject();
        const filler = only((await importMap("tileset-embedded.tmj")).tilesets);
        project.tilesets = Array.from({ length: 254 }, (_, index) => ({
            ...filler,
            id: `f${index}`,
            exportName: `f${index}`,
            pixels: { width: 1, height: 1, data: new Uint8ClampedArray(4) },
        }));
        const error = await refusal(() => importMap("collection-uniform.tmj", project));
        expect(error.code).toBe("limit");
        expect(error.message).toContain("255 tilesets");
    });
});

describe("colour keys", () => {
    it("applies a tileset's transparent colour when its pixels are copied", async () => {
        const { tilesets } = await importMap("transparent-color.tmj");
        const tileset = only(tilesets);
        const magenta = tiledColor("#ff00ff")!;
        const { data } = tileset.pixels;
        let keyed = 0;
        for (let at = 0; at < data.length; at += 4) {
            const value = ((data[at]! << 24) | (data[at + 1]! << 16) | (data[at + 2]! << 8)) >>> 0;
            expect(value === (magenta & 0xffffff00) >>> 0 && data[at + 3] === 255).toBe(false);
            if (data[at + 3] === 0) keyed += 1;
        }
        expect(keyed).toBeGreaterThan(0);
        const png = await decoded("keyed.png");
        // The disc's centre keeps its colour.
        const centre = (8 * png.width + 8) * 4;
        expect([...data.subarray(centre, centre + 4)]).toEqual([
            ...png.data.subarray(centre, centre + 4),
        ]);
        expect(tileset.tiles[0]!.fingerprint).not.toBe(tileFingerprint(png, 0, 0, 16, 16));
        expect(tilesets.report).toEqual([]);
    });

    it("applies an image layer's transparent colour", async () => {
        const { map } = await importMap("transparent-color.tmj");
        const [image] = map.images;
        expect(image).toMatchObject({ path: "images/backdrop.png" });
        const pixels = await tmjImagePixels(
            new Uint8Array(read(image!.path)!),
            image!.transparentColor,
            image!.path,
        );
        const at = (x: number, y: number) => [
            ...pixels.data.subarray((y * pixels.width + x) * 4, (y * pixels.width + x + 1) * 4),
        ];
        expect(at(20, 20)).toEqual([0, 0, 0, 0]);
        expect(at(120, 80)).toEqual([0, 0, 0, 0]);
        expect(at(2, 2)[3]).toBe(255);
        const plain = await tmjImagePixels(new Uint8Array(read(image!.path)!), null, image!.path);
        expect(plain.data[(20 * plain.width + 20) * 4 + 3]).toBe(255);
    });
});

describe("reuse", () => {
    it("re-importing a map reuses its external tileset", async () => {
        const project = emptyProject();
        const first = await importMap("dungeon.tmj", project);
        await addImport(project, first);
        const again = await importMap("dungeon.tmj", project);
        expect(again.tilesets.added).toEqual([]);
        expect(again.tilesets.slots).toEqual([project.tilesets[0]]);
        expect(again.tilesets.report).toEqual([]);
    });

    it("another map with the same external tileset reuses it", async () => {
        const project = emptyProject();
        await addImport(project, await importMap("encoding-csv.tmj", project));
        const other = await importMap("collection-uniform.tmj", project);
        expect(other.tilesets.added.map((tileset) => tileset.name)).toEqual(["props"]);
        expect(other.tilesets.slots[1]).toBe(project.tilesets[0]);
    });

    it("a tileset of another file over the same image is new", async () => {
        const project = emptyProject();
        await addImport(project, await importMap("tileset-tsj.tmj", project));
        const dungeon = await importMap("dungeon.tmj", project);
        expect(dungeon.tilesets.added.map((tileset) => tileset.name)).toEqual(["dungeon"]);
    });

    it("a tileset whose tiles changed is new, with a unique export name", async () => {
        const project = emptyProject();
        await addImport(project, await importMap("tileset-tsj.tmj", project));
        project.tilesets[0]!.tiles[3]!.fingerprint = "0".repeat(64);
        const again = await importMap("tileset-tsj.tmj", project);
        expect(again.tilesets.added).toHaveLength(1);
        expect(again.tilesets.added[0]!.exportName).toBe("tiles-2");
    });

    it("an embedded tileset is never reused", async () => {
        const project = emptyProject();
        await addImport(project, await importMap("tileset-embedded.tmj", project));
        const again = await importMap("tileset-embedded.tmj", project);
        expect(again.tilesets.added).toHaveLength(1);
        expect(again.tilesets.added[0]!.exportName).toBe("tiles-embedded-2");
    });
});

describe("every fixture", () => {
    const refused: Record<string, string> = {
        "collection-mixed.tmj": "mixed-sizes",
        "encoding-zstd.tmj": "zstd",
        "hexagonal.tmj": "orientation",
        "isometric.tmj": "orientation",
    };
    const fixtures = readdirSync(FOLDER).filter((name) => name.endsWith(".tmj"));

    for (const name of fixtures) {
        it(`${name} ${refused[name] ? `is refused (${refused[name]})` : "imports a valid project"}`, async () => {
            if (refused[name]) {
                const error = await refusal(() => importMap(name));
                expect(error.code).toBe(refused[name]);
                return;
            }
            const project = emptyProject();
            const imported = await importMap(name, project);
            await addImport(project, imported);
            expect(() => assertInvariants(project)).not.toThrow();
            expect(imported.tilesets.slots).toHaveLength(imported.map.tilesets.length);
        });
    }
});

describe("review findings", () => {
    const props = (): { tiles: Record<string, unknown>[] } & Record<string, unknown> =>
        JSON.parse(fixtureText("props.tsj")) as { tiles: Record<string, unknown>[] };

    it("a grid PNG tileset of the same name is not reused for a TSJ with tile data", async () => {
        const project = emptyProject();
        const png = await importGridPng(project, new Uint8Array(read("tiles.png")!), {
            fileName: "tiles.png",
            tileWidth: 16,
            tileHeight: 16,
            margin: 0,
            spacing: 0,
            newId: sequentialIds("g"),
        });
        png.tileset.slot = 1;
        project.tilesets.push(png.tileset);
        const dungeon = fixtureText("dungeon.tsj").replace('"name":"dungeon"', '"name":"tiles"');
        const imported = await importMap("tileset-tsj.tmj", project, {
            extra: { "tiles.tsj": dungeon },
        });
        expect(imported.tilesets.added).toHaveLength(1);
        expect(tile(imported.tilesets.added[0]!, 5).collision).toHaveLength(1);
        expect(rows(imported.tilesets.report)).toEqual({ "collision-shapes": 2 });
        // The same file without tile data is that tileset: the TSJ adds nothing to it.
        const plain = await importMap("tileset-tsj.tmj", project);
        expect(plain.tilesets.slots).toEqual([png.tileset]);
    });

    it("a reused tileset whose data changed in the project is new", async () => {
        const project = emptyProject();
        await addImport(project, await importMap("dungeon.tmj", project));
        project.tilesets[0]!.tiles[5]!.collision = [];
        const again = await importMap("dungeon.tmj", project);
        expect(again.tilesets.added).toHaveLength(1);
    });

    it("checks a collection image's size from its header before decoding it", async () => {
        const json = props();
        json.tiles[0] = { ...json.tiles[0], image: "huge.png", x: 0, y: 0, width: 16, height: 16 };
        let decoded = 0;
        const map = convertTmjMap(fixtureText("collection-uniform.tmj"), {
            fileName: "collection-uniform.tmj",
        });
        const error = await refusal(() =>
            convertTmjTilesets(emptyProject(), map.tilesets, {
                fileName: "collection-uniform.tmj",
                files: filesWith({
                    "props.tsj": JSON.stringify(json),
                    "huge.png": pngHeader(9000, 9000),
                }),
                decode: (bytes) => {
                    decoded += 1;
                    return decodePng(bytes);
                },
            }),
        );
        expect(error.code).toBe("limit");
        expect(error.message).toContain("9000 × 9000");
        expect(decoded).toBe(0);
    });

    it("an unused tileset without tiles is dropped and reported, as Tiled opens it", async () => {
        const json = JSON.parse(fixtureText("tileset-embedded.tmj")) as {
            tilesets: Record<string, unknown>[];
        };
        json.tilesets.push({ ...props(), name: "empty", tiles: [], firstgid: 100 });
        const { tilesets } = await importMap("tileset-embedded.tmj", undefined, {
            text: JSON.stringify(json),
        });
        expect(tilesets.added).toHaveLength(1);
        expect(tilesets.slots[1]).toBeNull();
        expect(tilesets.report).toEqual([
            {
                row: "out-of-range",
                detail: "Tileset without tiles dropped",
                count: 1,
                where: { tileset: "empty" },
            },
        ]);
    });

    it("an image tileset with no whole tile is dropped when unused", async () => {
        const json = JSON.parse(fixtureText("tileset-embedded.tmj")) as {
            tilesets: Record<string, unknown>[];
        };
        json.tilesets.push({
            ...json.tilesets[0],
            name: "tiny",
            tilewidth: 200,
            tileheight: 200,
            firstgid: 100,
        });
        const { tilesets } = await importMap("tileset-embedded.tmj", undefined, {
            text: JSON.stringify(json),
        });
        expect(tilesets.slots[1]).toBeNull();
        expect(details(tilesets.report, "out-of-range")).toEqual(["Tileset without tiles dropped"]);
    });

    it("an embedded tileset is checked for room before it is decoded", async () => {
        const project = emptyProject();
        const filler = only((await importMap("tileset-embedded.tmj")).tilesets);
        project.tilesets = Array.from({ length: 255 }, (_, index) => ({
            ...filler,
            id: `f${index}`,
            exportName: `f${index}`,
            pixels: { width: 1, height: 1, data: new Uint8ClampedArray(4) },
        }));
        let decoded = 0;
        const map = convertTmjMap(fixtureText("tileset-embedded.tmj"), {
            fileName: "tileset-embedded.tmj",
        });
        const error = await refusal(() =>
            convertTmjTilesets(project, map.tilesets, {
                fileName: "tileset-embedded.tmj",
                files: filesWith(),
                decode: (bytes) => {
                    decoded += 1;
                    return decodePng(bytes);
                },
            }),
        );
        expect(error.code).toBe("limit");
        expect(decoded).toBe(0);
    });

    it("a collection tile without an image still counts for the next tile ID", async () => {
        const json = props();
        json.tiles.push({ id: 9 });
        const { tilesets } = await importMap("collection-uniform.tmj", undefined, {
            extra: { "props.tsj": JSON.stringify(json) },
        });
        expect(tilesets.added[0]!.nextTileId).toBe(10);
        expect(details(tilesets.report, "out-of-range")).toEqual(["Tile without an image dropped"]);
    });
});
