import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sequentialIds } from "../../src/core/model";
import {
    TmjError,
    applyColorKey,
    convertTmjMap,
    convertTmjTilesets,
    formatLocation,
    parseXml,
    resolveTmjPath,
    tsxToJson,
} from "../../src/core/tmj";
import { emptyProject } from "./te-022-support";

// TE-060: the parts of TMJ tileset conversion that are not a fixture row: the TSX reader (XML
// without DOM globals), paths relative to the file that names them, the colour key, and what a
// tileset's collision shapes, animations and wang sets drop and report.

describe("parseXml", () => {
    it("reads elements, attributes, text, CDATA and references", () => {
        const root = parseXml(
            '\uFEFF<?xml version="1.0"?>\n<!-- c --><!DOCTYPE x>' +
                '<a k=\'1 &amp; 2\' n="x&#10;y"><b/>t&lt;&#x41;<![CDATA[<raw>]]><!-- d --><c z="&quot;">in</c></a>\n',
            "Test",
        );
        expect(root.name).toBe("a");
        expect(root.attributes).toEqual({ k: "1 & 2", n: "x\ny" });
        expect(root.text).toBe("t<A<raw>");
        expect(root.children.map((child) => child.name)).toEqual(["b", "c"]);
        expect(root.children[1]).toMatchObject({ attributes: { z: '"' }, text: "in" });
    });

    it("normalises white space in attribute values", () => {
        expect(parseXml('<a v="1\n\t2"/>', "Test").attributes.v).toBe("1  2");
    });

    for (const [text, why] of [
        ["", "the document is empty"],
        ["<a>", "element a is not closed"],
        ["<a></b>", "closed by another"],
        ["<a x=1/>", "not quoted"],
        ['<a x="1" x="2"/>', "repeated"],
        ["<a>&nope;</a>", "unknown"],
        ["<a>&amp</a>", "unterminated"],
        ["<a/><b/>", "after the root"],
        ["<a><!-- open</a>", "unclosed comment"],
        ["< a/>", "a name is expected"],
    ] as const) {
        it(`refuses ${JSON.stringify(text)}`, () => {
            expect(() => parseXml(text, "Test")).toThrow(why);
            expect(() => parseXml(text, "Test")).toThrow(TmjError);
        });
    }
});

describe("tsxToJson", () => {
    it("reads offsets, transformations, properties of every type and object shapes", () => {
        const json = tsxToJson(
            `<tileset name="t" class="C" tilewidth="8" tileheight="8" tilerendersize="grid">
 <tileoffset x="2" y="-3"/>
 <transformations hflip="1" vflip="0" rotate="0" preferuntransformed="0"/>
 <image source="a.png" trans="ff00ff" width="16" height="8"/>
 <properties>
  <property name="s">multi
line</property>
  <property name="i" type="int" value="5"/>
  <property name="f" type="float" value="0.5"/>
  <property name="b" type="bool" value="false"/>
  <property name="o" type="object" value="3"/>
  <property name="e" type="string" propertytype="Facing" value="up"/>
  <property name="c" type="class" propertytype="Stats">
   <properties><property name="hp" type="int" value="3"/></properties>
  </property>
  <property name="l" type="list"><item type="int" value="1"/></property>
 </properties>
 <tile id="1" class="Old">
  <objectgroup draworder="index">
   <object id="1" name="n" type="T" x="1" y="2" width="3" height="4" rotation="30" visible="0"/>
   <object id="2" x="0" y="0"><capsule/></object>
   <object id="3" x="0" y="0"><text>Hi</text></object>
  </objectgroup>
 </tile>
</tileset>`,
            "T",
        );
        expect(json).toMatchObject({
            type: "tileset",
            name: "t",
            class: "C",
            tilewidth: 8,
            tilerendersize: "grid",
            image: "a.png",
            transparentcolor: "#ff00ff",
            tileoffset: { x: 2, y: -3 },
            transformations: { hflip: true, vflip: false },
            properties: [
                { name: "s", type: "string", value: "multi\nline" },
                { name: "i", type: "int", value: 5 },
                { name: "f", type: "float", value: 0.5 },
                { name: "b", type: "bool", value: false },
                { name: "o", type: "object", value: 3 },
                { name: "e", type: "string", propertytype: "Facing", value: "up" },
                { name: "c", type: "class", propertytype: "Stats", value: { hp: 3 } },
                { name: "l", type: "list", value: [{ type: "int", value: 1 }] },
            ],
            tiles: [
                {
                    id: 1,
                    class: "Old",
                    objectgroup: {
                        objects: [
                            { id: 1, name: "n", type: "T", rotation: 30, visible: false },
                            { id: 2, capsule: true },
                            { id: 3, text: { text: "Hi" } },
                        ],
                    },
                },
            ],
        });
    });

    it("refuses what is not a tileset or not a number", () => {
        expect(() => tsxToJson("<map/>", "T")).toThrow("not a Tiled tileset");
        expect(() => tsxToJson('<tileset tilewidth="x"/>', "T")).toThrow("not a number");
        expect(() =>
            tsxToJson('<tileset><tile id="0"><objectgroup><object><polygon points="1"/>', "T"),
        ).toThrow(TmjError);
        expect(() =>
            tsxToJson(
                '<tileset><tile id="0"><objectgroup><object><polygon points="1,2,3"/></object></objectgroup></tile></tileset>',
                "T",
            ),
        ).toThrow("is not a point");
    });
});

describe("resolveTmjPath", () => {
    it("makes a path relative to the map's folder", () => {
        expect(resolveTmjPath("", "tiles.tsj")).toBe("tiles.tsj");
        expect(resolveTmjPath("", "./a\\b.png")).toBe("a/b.png");
        expect(resolveTmjPath("sets", "../images/a.png")).toBe("images/a.png");
        expect(resolveTmjPath("sets/deep", "./../x.png")).toBe("sets/x.png");
        expect(resolveTmjPath("", "../shared/t.tsx")).toBe("../shared/t.tsx");
        expect(resolveTmjPath("../shared", "../../a.png")).toBe("../../a.png");
        expect(resolveTmjPath("sets", "/abs/a.png")).toBe("/abs/a.png");
        expect(resolveTmjPath("sets", "C:\\art\\..\\a.png")).toBe("C:/a.png");
    });
});

describe("applyColorKey", () => {
    it("makes opaque pixels of the colour transparent, others unchanged", () => {
        const pixels = {
            width: 3,
            height: 1,
            data: new Uint8ClampedArray([255, 0, 255, 255, 255, 0, 255, 128, 255, 0, 254, 255]),
        };
        applyColorKey(pixels, 0xff00ffff);
        expect([...pixels.data]).toEqual([0, 0, 0, 0, 255, 0, 255, 128, 255, 0, 254, 255]);
    });
});

describe("dropped and changed tileset data", () => {
    const FOLDER = new URL("../fixtures/tmj/", import.meta.url);
    const map = JSON.parse(readFileSync(new URL("tileset-embedded.tmj", FOLDER), "utf8")) as {
        tilesets: Record<string, unknown>[];
    };

    async function convert(tileset: Record<string, unknown>) {
        const json = structuredClone(map);
        json.tilesets[0] = { ...json.tilesets[0], ...tileset };
        const conversion = convertTmjMap(JSON.stringify(json), {
            fileName: "t.tmj",
            newId: sequentialIds("m"),
        });
        return convertTmjTilesets(emptyProject(), conversion.tilesets, {
            fileName: "t.tmj",
            files: {
                text: () => undefined,
                bytes: (path) => new Uint8Array(readFileSync(new URL(path, FOLDER))),
            },
            newId: sequentialIds("t"),
        });
    }

    it("collision shapes: rotation, names, classes and properties dropped; bad shapes too", async () => {
        const many = Array.from({ length: 65 }, (_, id) => ({
            id,
            x: 0,
            y: 0,
            width: 1,
            height: 1,
        }));
        const { added, report } = await convert({
            tiles: [
                {
                    id: 0,
                    objectgroup: {
                        objects: [
                            {
                                id: 1,
                                name: "n",
                                type: "T",
                                x: 1,
                                y: 1,
                                width: 2,
                                height: 2,
                                rotation: 45,
                                properties: [{ name: "p", type: "int", value: 1 }],
                            },
                            { id: 2, template: "x.tj" },
                            { id: 3, gid: 1 },
                            { id: 4, x: 5000, y: 0, width: 1, height: 1 },
                            { id: 5, polygon: [{ x: 0 }] },
                        ],
                    },
                },
                { id: 1, objectgroup: { objects: many } },
            ],
        });
        const tileset = added[0]!;
        expect(tileset.tiles[0]!.collision).toEqual([
            { shape: "rectangle", x: 1, y: 1, width: 2, height: 2 },
        ]);
        expect(tileset.tiles[1]!.collision).toHaveLength(64);
        expect(report.map((entry) => `${entry.row}: ${entry.detail} ×${entry.count}`)).toEqual([
            "collision-shapes: Rotation 45° dropped ×1",
            'collision-shapes: Name "n" dropped ×1',
            'collision-shapes: Class "T" dropped ×1',
            "collision-shapes: Properties dropped ×1",
            "collision-shapes: Template instance dropped ×1",
            "collision-shapes: Tile object dropped ×1",
            "out-of-range: Shape dropped: Collision coordinates lie within −4096..4096. ×1",
            "out-of-range: Shape dropped: its points are malformed ×1",
            "out-of-range: Shape dropped: more than 64 ×1",
        ]);
        expect(formatLocation(report[0]!.where)).toBe(
            'Tileset "tiles-embedded" › Tile 0 › Object "n" (1)',
        );
    });

    it("animations: missing frame tiles drop the animation, durations are clamped", async () => {
        const { added, report } = await convert({
            tiles: [
                { id: 0, animation: [{ tileid: 99, duration: 100 }] },
                {
                    id: 1,
                    animation: [
                        { tileid: 1, duration: 0 },
                        { tileid: 2, duration: 70000 },
                    ],
                },
                { id: 50, type: "Gone" },
            ],
        });
        const tileset = added[0]!;
        expect(tileset.tiles[0]!.animation).toEqual([]);
        expect(tileset.tiles[1]!.animation).toEqual([
            { tile: 1, ms: 1 },
            { tile: 2, ms: 65535 },
        ]);
        expect(report.map((entry) => `${entry.detail} ×${entry.count}`)).toEqual([
            "Animation dropped: frame tile 99 does not exist ×1",
            "Frame durations clamped to 1..65535 ms ×2",
            "Tile data dropped: the image has no such tile ×1",
        ]);
    });

    it("wang sets: classes, properties and bad entries reported; IDs masked by type", async () => {
        const { added, report } = await convert({
            tileoffset: { x: 5000, y: -2 },
            wangsets: [
                {
                    name: "",
                    class: "K",
                    properties: [{ name: "p", type: "int", value: 1 }],
                    type: "edge",
                    colors: [
                        { name: "", color: "nope", tile: 99, class: "C", probability: 1 },
                        { name: "B", color: "#ff112233", tile: -1, properties: [{}] },
                    ],
                    wangtiles: [
                        { tileid: 0, wangid: [1, 2, 1, 2, 1, 2, 1, 2] },
                        { tileid: 0, wangid: [1, 0, 1, 0, 1, 0, 1, 0] },
                        { tileid: 99, wangid: [1, 0, 1, 0, 1, 0, 1, 0] },
                        { tileid: 1, wangid: [3, 0, 0, 0, 0, 0, 0, 0] },
                        { tileid: 2, wangid: [1, 0] },
                    ],
                },
                { name: "Odd", type: "diagonal", colors: [] },
                { name: "Empty", type: "mixed", colors: [] },
            ],
        });
        const tileset = added[0]!;
        expect(tileset.offsetX).toBe(4096);
        expect(tileset.offsetY).toBe(-2);
        expect(tileset.terrainSets).toEqual([
            {
                name: "Terrain set 1",
                type: "edge",
                colors: [
                    { name: "Terrain 1", color: "#000000ff", tile: null },
                    { name: "B", color: "#112233ff", tile: null },
                ],
                tiles: [{ tile: 0, wangId: [1, 0, 1, 0, 1, 0, 1, 0] }],
            },
        ]);
        expect(report.map((entry) => `${entry.row}: ${entry.detail}`)).toEqual([
            "out-of-range: Tile offset x 5000 clamped to 4096",
            "out-of-range: Blank name replaced",
            'out-of-range: Terrain "Terrain 1": blank name replaced',
            'out-of-range: Terrain "Terrain 1": colour nope replaced by black',
            'out-of-range: Terrain "Terrain 1": icon tile 99 dropped',
            'terrain-sets: Terrain "Terrain 1": class "C" dropped',
            'terrain-sets: Terrain "B": properties dropped',
            'terrain-sets: Terrain set: class "K" dropped',
            "terrain-sets: Terrain set: properties dropped",
            "out-of-range: Terrain tile dropped: listed twice",
            "out-of-range: Terrain tile dropped: no such tile",
            "out-of-range: Terrain tile dropped: it names no terrain of the set",
            "out-of-range: Terrain tile dropped: bad wangid",
            "out-of-range: Terrain set dropped: type diagonal is unknown",
            "out-of-range: Terrain set dropped: it has 0 terrains, not 1 to 254",
        ]);
        expect(formatLocation(report[1]!.where)).toBe(
            'Tileset "tiles-embedded" › Terrain set "Terrain set 1"',
        );
    });

    it("an undecodable image refuses the map", async () => {
        const json = structuredClone(map);
        json.tilesets[0] = { ...json.tilesets[0], image: "bad.png" };
        const conversion = convertTmjMap(JSON.stringify(json), { fileName: "t.tmj" });
        const bad = new Uint8Array(readFileSync(new URL("tiles.png", FOLDER))).slice(0, 60);
        await expect(
            convertTmjTilesets(emptyProject(), conversion.tilesets, {
                fileName: "t.tmj",
                files: { text: () => undefined, bytes: () => bad },
            }),
        ).rejects.toMatchObject({ code: "format", message: expect.stringContaining("bad.png") });
    });
});
