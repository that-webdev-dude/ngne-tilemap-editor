import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CellStore, cellValue } from "../../src/core/cells";
import { createGroupLayer, createImageLayer, createTileLayer } from "../../src/core/model";
import type { Project } from "../../src/core/model";
import { tilemapFor } from "../../src/core/tilemap";
import {
    FIXTURE_GENERATOR,
    MEADOW_TILEMAP,
    formatExample,
    grassTileset,
    meadowProject,
} from "./te-049-support";

// TE-049: `tilemapFor` (FORMAT §3.7).

/** A tilemap's parsed JSON, loosely typed for reading members in a test. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

function written(project: Project, index = 0): Loose {
    return JSON.parse(tilemapFor(project, project.maps[index]!));
}

describe("tilemapFor: the meadow fixture", () => {
    it("writes the meadow project as the fixture, byte for byte", () => {
        const project = meadowProject();
        const text = tilemapFor(project, project.maps[0]!, FIXTURE_GENERATOR);
        expect(text).toBe(readFileSync(MEADOW_TILEMAP, "utf8"));
    });

    it("the fixture holds the FORMAT §3.10 example", () => {
        expect(JSON.parse(readFileSync(MEADOW_TILEMAP, "utf8"))).toEqual(formatExample());
    });

    it("writing twice, or a copy of the project, gives identical bytes", () => {
        const project = meadowProject();
        const first = tilemapFor(project, project.maps[0]!);
        expect(tilemapFor(project, project.maps[0]!)).toBe(first);
        const other = meadowProject();
        expect(tilemapFor(other, other.maps[0]!)).toBe(first);
    });

    it("lays out the text as FORMAT §3.7 says: four spaces, one data row per line, LF", () => {
        const project = meadowProject();
        const text = tilemapFor(project, project.maps[0]!);
        expect(text.endsWith("}\n")).toBe(true);
        expect(text).not.toContain("\r");
        expect(text).toContain('\n    "format": "ngne-tilemap",\n');
        expect(text).toContain(
            '"data": [\n' +
                "                0, 0, 3, 0,\n" +
                "                0, 2147483649, 0, 2684354562,\n" +
                "                4, 4, 4, 4\n" +
                "            ]",
        );
    });

    it("writes ASCII only, escaping every other character", () => {
        const project = meadowProject();
        const map = project.maps[0]!;
        map.name = "Wiese été \u{1f33f}";
        map.properties.push({ name: "名前", type: "string", value: "café" });
        const text = tilemapFor(project, map);
        expect([...text].every((char) => char.charCodeAt(0) < 0x80)).toBe(true);
        expect(text).toContain('"title": "Wiese \\u00e9t\\u00e9 \\ud83c\\udf3f"');
        const json = JSON.parse(text) as Loose;
        expect(json.title).toBe(map.name);
        expect(json.properties[1]).toEqual({ name: "名前", type: "string", value: "café" });
    });

    it("writes the members of FORMAT §3.2 in the order of the table and no other", () => {
        const project = meadowProject();
        expect(Object.keys(written(project))).toEqual([
            "format",
            "version",
            "generator",
            "project",
            "name",
            "title",
            "class",
            "orientation",
            "width",
            "height",
            "tileWidth",
            "tileHeight",
            "backgroundColor",
            "parallaxOriginX",
            "parallaxOriginY",
            "tilesets",
            "groups",
            "layers",
            "properties",
        ]);
    });
});

describe("tilemapFor: groups and effective values", () => {
    /** Outer group > inner group > tile layer, plus layers beside them and an image layer. */
    function nestedProject(): Project {
        const project = meadowProject();
        project.images.push({
            id: "sky-id",
            name: "Sky",
            exportName: "sky",
            pixels: { width: 32, height: 8, data: new Uint8ClampedArray(32 * 8 * 4) },
        });
        const map = project.maps[0]!;
        const inner = createTileLayer(10, "Deep");
        inner.cells = new CellStore();
        inner.cells.set(0, 0, cellValue(1, 3));
        Object.assign(inner, {
            opacity: 100,
            offsetX: 1,
            offsetY: 1,
            parallaxX: 2,
            parallaxY: 0.5,
            locked: true,
            properties: [
                { name: "z", type: "int", value: 2 },
                { name: "a", type: "bool", value: true },
            ],
        });
        const innerGroup = Object.assign(createGroupLayer(11, "Inner"), {
            visible: false,
            opacity: 200,
            offsetX: 3,
            offsetY: 4,
            parallaxX: 0.5,
            parallaxY: 2,
            layers: [inner],
        });
        const sky = Object.assign(createImageLayer(13, "Sky", "sky-id"), {
            repeatX: true,
            opacity: 51,
        });
        const outerGroup = Object.assign(createGroupLayer(12, "Outer"), {
            class: "world",
            opacity: 128,
            offsetX: 10,
            offsetY: -5,
            parallaxX: 0.5,
            locked: true,
            layers: [sky, innerGroup],
        });
        map.layers = [...map.layers, outerGroup];
        map.nextLayerId = 14;
        return project;
    }

    it("lists groups parents first and flattens layers in draw order", () => {
        const json = written(nestedProject());
        expect(json.groups.map((group: Loose) => [group.id, group.parentId])).toEqual([
            [4, null],
            [12, null],
            [11, 12],
        ]);
        expect(json.groups[1]).toEqual({
            id: 12,
            name: "Outer",
            class: "world",
            parentId: null,
            properties: [],
        });
        expect(json.layers.map((layer: Loose) => [layer.id, layer.groupId])).toEqual([
            [1, 4],
            [2, null],
            [13, 12],
            [10, 11],
        ]);
    });

    it("writes each layer's effective visibility, opacity, offset and parallax", () => {
        const deep = written(nestedProject()).layers[3];
        expect(deep).toMatchObject({
            visible: false,
            // round(255 × 128/255 × 200/255 × 100/255) = round(39.37)
            opacity: 39,
            offsetX: 14,
            offsetY: 0,
            parallaxX: 0.5,
            parallaxY: 1,
        });
        expect(deep).not.toHaveProperty("locked");
        expect(deep.properties).toEqual([
            { name: "a", type: "bool", value: true },
            { name: "z", type: "int", value: 2 },
        ]);
    });

    it("writes an image layer with its file, size and repeat", () => {
        const sky = written(nestedProject()).layers[2];
        expect(sky).toEqual({
            id: 13,
            type: "image",
            name: "Sky",
            class: "",
            groupId: 12,
            visible: true,
            // round(255 × 51/255 × 128/255) = round(25.6)
            opacity: 26,
            offsetX: 10,
            offsetY: -5,
            parallaxX: 0.5,
            parallaxY: 1,
            properties: [],
            image: "sky.png",
            imageWidth: 32,
            imageHeight: 8,
            repeatX: true,
            repeatY: false,
        });
    });
});

describe("tilemapFor: tilesets and firstGid spans", () => {
    /** Tilesets a (slot 1), b (slot 2, unused) and c (slot 3), each with gaps in its IDs. */
    function threeTilesets(): Project {
        const project = meadowProject();
        const a = { ...grassTileset(1), id: "a-id", exportName: "a", nextTileId: 9 };
        const b = { ...grassTileset(2), id: "b-id", exportName: "b", nextTileId: 20 };
        const c = { ...grassTileset(3), id: "c-id", exportName: "c", nextTileId: 6 };
        project.tilesets = [a, b, c];
        const map = project.maps[0]!;
        const layer = createTileLayer(20, "Spans");
        layer.cells.set(0, 0, cellValue(3, 0));
        layer.cells.set(1, 0, cellValue(1, 3, 5));
        layer.cells.set(2, 0, cellValue(3, 3, 2));
        map.layers = [layer];
        map.nextLayerId = 21;
        return project;
    }

    it("lists only the tilesets the cells use, in project order, spans back to back", () => {
        const json = written(threeTilesets());
        expect(
            json.tilesets.map((tileset: Loose) => [
                tileset.name,
                tileset.firstGid,
                tileset.nextTileId,
            ]),
        ).toEqual([
            ["a", 1, 9],
            ["c", 10, 6],
        ]);
        expect(json.tilesets[1].atlas).toBe("c.atlas.json");
    });

    it("writes each cell as the GID of its tileset's span with its flags", () => {
        const data = written(threeTilesets()).layers[0].data as number[];
        expect(data.slice(0, 4)).toEqual([
            10,
            (0xa0000000 | (1 + 3)) >>> 0,
            (0x40000000 | (10 + 3)) >>> 0,
            0,
        ]);
    });

    it("writes no tileset for a map without cells", () => {
        const project = threeTilesets();
        project.maps[0]!.layers = [createTileLayer(20, "Empty")];
        expect(written(project).tilesets).toEqual([]);
    });

    it("lists the tiles with data in ID order and no other", () => {
        const project = meadowProject();
        const tileset = project.tilesets[0]!;
        tileset.tiles = [...tileset.tiles].reverse();
        tileset.tiles[3] = {
            ...tileset.tiles[3]!,
            properties: [{ name: "p", type: "color", value: "#AABBCCDD" }],
        };
        const tiles = written(project).tilesets[0].tiles;
        expect(tiles.map((tile: Loose) => tile.id)).toEqual([0, 3]);
        expect(tiles[0]).toEqual({
            id: 0,
            class: "",
            collision: [],
            properties: [{ name: "p", type: "color", value: "#aabbccdd" }],
        });
    });
});
