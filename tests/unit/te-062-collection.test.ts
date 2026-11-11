import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sequentialIds } from "../../src/core/model";
import { TilesetUpdateError, tileBytes } from "../../src/core/tileset";
import {
    TmjError,
    convertTmjMap,
    convertTmjTilesets,
    readTmjCollection,
    tmjCollectionImages,
    tmjCollectionOf,
} from "../../src/core/tmj";
import type { TmjFiles } from "../../src/core/tmj";
import { emptyProject } from "./te-022-support";

// TE-062: the source of a `"collection"` tileset re-read for Update Tileset from Source (SPEC
// §6.3): a TSJ, a TSX or a TMJ embedding the collection, converted as the TMJ import converts it
// (TE-060). Its entries are the import's tiles in Tiled's order, keyed by image file name, with
// the import's pixels, fingerprints and animations; the collection is picked in a TMJ by the
// tileset's name, else as the only one; an image tileset and another tile size are refused.

const FOLDER = new URL("../fixtures/tmj/", import.meta.url);
const read = (path: string): Buffer => readFileSync(new URL(path, FOLDER));

/** The fixture folder's images, by path from it. */
const files: TmjFiles = {
    text: () => undefined,
    bytes: (path) => {
        try {
            return new Uint8Array(read(path));
        } catch {
            return undefined;
        }
    },
};

const PROPS = { name: "props", tileWidth: 16, tileHeight: 16 };

interface RawTile {
    id: number;
    image: string;
    animation?: { tileid: number; duration: number }[];
}

/** A Tiled image collection's JSON. */
function collection(name: string, tiles: RawTile[]): Record<string, unknown> {
    return { name, tilewidth: 16, tileheight: 16, tilecount: tiles.length, columns: 0, tiles };
}

/** A TMJ embedding `tilesets`. */
function mapText(tilesets: Record<string, unknown>[]): string {
    let firstgid = 1;
    return JSON.stringify({
        type: "map",
        orientation: "orthogonal",
        width: 1,
        height: 1,
        tilewidth: 16,
        tileheight: 16,
        infinite: false,
        layers: [],
        tilesets: tilesets.map((tileset) => {
            const out = { firstgid, ...tileset };
            firstgid += 16;
            return out;
        }),
    });
}

async function rejection(run: () => Promise<unknown>): Promise<unknown> {
    try {
        await run();
    } catch (error) {
        return error;
    }
    throw new Error("Expected a refusal.");
}

describe("the collection re-read as the import converts it", () => {
    it("props.tsj: the import's tiles in Tiled's order, keyed by file name, with its pixels", async () => {
        const name = "collection-uniform.tmj";
        const map = convertTmjMap(read(name).toString("utf8"), {
            fileName: name,
            template: () => undefined,
            newId: sequentialIds("m"),
        });
        const conversion = await convertTmjTilesets(emptyProject(), map.tilesets, {
            fileName: name,
            files: { ...files, text: (path) => read(path).toString("utf8") },
            newId: sequentialIds("t"),
        });
        const imported = conversion.added.find((tileset) => tileset.name === "props")!;
        const source = await readTmjCollection(
            PROPS,
            read("props.tsj").toString("utf8"),
            "props.tsj",
            files,
        );
        expect(source.tileWidth).toBe(16);
        expect(source.entries.map((entry) => entry.key)).toEqual([
            "crate.png",
            "barrel.png",
            "bush.png",
        ]);
        expect(source.entries.map((entry) => [entry.key, entry.fingerprint])).toEqual(
            imported.tiles.map((tile) => [tile.sourceKey, tile.fingerprint]),
        );
        source.entries.forEach((entry, k) => {
            expect(entry.pixels).toEqual(tileBytes(imported.pixels, imported, k));
        });
        expect(source.animations).toEqual([]);
        expect(
            tmjCollectionImages(
                tmjCollectionOf(read("props.tsj").toString("utf8"), "props.tsj", "props"),
            ),
        ).toEqual(["images/crate.png", "images/barrel.png", "images/bush.png"]);
    });

    it("a TSX of the collection gives the same entries as its TSJ", async () => {
        const tsx = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<tileset version="1.11" tiledversion="1.12.2" name="props" tilewidth="16" tileheight="16" tilecount="3" columns="0">',
            ' <grid orientation="orthogonal" width="1" height="1"/>',
            ' <tile id="0"><image source="images/crate.png" width="16" height="16"/></tile>',
            ' <tile id="1"><image source="images/barrel.png" width="16" height="16"/></tile>',
            ' <tile id="2"><image source="images/bush.png" width="16" height="16"/></tile>',
            "</tileset>",
        ].join("\n");
        const fromTsx = await readTmjCollection(PROPS, tsx, "props.tsx", files);
        const fromTsj = await readTmjCollection(
            PROPS,
            read("props.tsj").toString("utf8"),
            "props.tsj",
            files,
        );
        expect(fromTsx).toEqual(fromTsj);
    });

    it("animations name entries, whatever Tiled's tile IDs", async () => {
        const text = JSON.stringify(
            collection("props", [
                { id: 5, image: "images/crate.png" },
                {
                    id: 9,
                    image: "images/barrel.png",
                    animation: [
                        { tileid: 9, duration: 100 },
                        { tileid: 5, duration: 200 },
                    ],
                },
            ]),
        );
        const source = await readTmjCollection(PROPS, text, "props.tsj", files);
        expect(source.entries.map((entry) => entry.key)).toEqual(["crate.png", "barrel.png"]);
        expect(source.animations).toEqual([
            {
                entry: 1,
                frames: [
                    { entry: 1, ms: 100 },
                    { entry: 0, ms: 200 },
                ],
            },
        ]);
    });

    it("a collection without images has no entries", async () => {
        const text = JSON.stringify(collection("props", []));
        const source = await readTmjCollection(PROPS, text, "props.tsj", files);
        expect(source).toEqual({
            tileWidth: 16,
            tileHeight: 16,
            entries: [],
            animations: [],
            warnings: [],
        });
    });
});

describe("the collection of a TMJ", () => {
    const crate = collection("props", [{ id: 0, image: "images/crate.png" }]);
    const bush = collection("plants", [{ id: 0, image: "images/bush.png" }]);
    const grid = { name: "tiles", image: "tiles.png", tilewidth: 16, tileheight: 16 };

    it("is the one named as the tileset, else the only one", async () => {
        const named = await readTmjCollection(PROPS, mapText([bush, crate]), "level.tmj", files);
        expect(named.entries.map((entry) => entry.key)).toEqual(["crate.png"]);
        const renamed = { ...PROPS, name: "renamed" };
        const sole = await readTmjCollection(renamed, mapText([grid, bush]), "level.tmj", files);
        expect(sole.entries.map((entry) => entry.key)).toEqual(["bush.png"]);
    });

    it("is refused when several are embedded and none is named so, or none is", () => {
        const renamed = "renamed";
        expect(() => tmjCollectionOf(mapText([bush, crate]), "level.tmj", renamed)).toThrow(
            new TmjError("format", "The map level.tmj embeds no image collection named “renamed”."),
        );
        expect(() => tmjCollectionOf(mapText([grid]), "level.tmj", "props")).toThrow(
            "The map level.tmj embeds no image collection.",
        );
        expect(() => tmjCollectionOf(mapText([crate, crate]), "level.tmj", "props")).toThrow(
            new TmjError(
                "format",
                "The map level.tmj embeds several image collections named “props”.",
            ),
        );
    });
});

describe("refusals", () => {
    it("an image tileset is not a collection", async () => {
        const error = await rejection(() =>
            readTmjCollection(PROPS, read("tiles.tsj").toString("utf8"), "tiles.tsj", files),
        );
        expect(error).toBeInstanceOf(TilesetUpdateError);
        expect(error).toMatchObject({ code: "source-kind" });
    });

    it("tiles of another size", async () => {
        const error = await rejection(() =>
            readTmjCollection(
                { ...PROPS, tileWidth: 32, tileHeight: 32 },
                read("props.tsj").toString("utf8"),
                "props.tsj",
                files,
            ),
        );
        expect(error).toBeInstanceOf(TilesetUpdateError);
        expect(error).toMatchObject({
            code: "tile-size",
            message: "The tile size changed from 32 × 32 to 16 × 16.",
        });
    });

    it("an image not given names its path", async () => {
        const text = JSON.stringify(collection("props", [{ id: 0, image: "images/cask.png" }]));
        const error = await rejection(() => readTmjCollection(PROPS, text, "props.tsj", files));
        expect(error).toBeInstanceOf(TmjError);
        expect(error).toMatchObject({ code: "missing-file", path: "images/cask.png" });
    });

    it("a file that is no Tiled map or tileset", () => {
        expect(() =>
            tmjCollectionOf(JSON.stringify({ type: "template" }), "door.tj", "props"),
        ).toThrow(TmjError);
    });
});
