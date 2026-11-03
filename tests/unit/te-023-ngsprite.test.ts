import { describe, expect, it, vi } from "vitest";
import { assertInvariants, sequentialIds } from "../../src/core/model";
import { compositeFrame } from "../../src/core/sprite/composite/compositeFrame";
import { deserialize } from "../../src/core/sprite/project/deserialize";
import { encodeJson } from "../../src/core/sprite/project/json";
import { writeZip } from "../../src/core/sprite/project/zip";
import {
    TilesetImportError,
    importSprite,
    importSpriteDocument,
    planSprite,
    readSpriteOutline,
    spriteGridDefaults,
} from "../../src/core/tileset";
import type { SpriteImportOptions } from "../../src/core/tileset";
import { emptyProject } from "./te-022-support";
import { area, cellSprite, color, spriteFixture, tag, tilePixels } from "./te-023-support";

// TE-023: `.ngsprite` → tileset (SPEC §6.1). Read with the sprite editor's reader, frames
// composited with `compositeFrame` and cut by a grid; a cell equal to the same cell of an earlier
// frame is no new tile; source keys `[frameId, column, row]`; tags expanded with `expandTag`,
// every changing cell animating the tile it shows first, with warnings for a repeat count and a
// second animation on one tile.

const grid = (tileWidth: number, tileHeight: number, margin = 0, spacing = 0) => ({
    fileName: "cells.ngsprite",
    newId: sequentialIds("ts"),
    tileWidth,
    tileHeight,
    margin,
    spacing,
});

function refusal(run: () => unknown): TilesetImportError {
    let error: unknown = null;
    try {
        run();
    } catch (caught) {
        error = caught;
    }
    expect(error).toBeInstanceOf(TilesetImportError);
    return error as TilesetImportError;
}

async function rejection(promise: Promise<unknown>): Promise<TilesetImportError> {
    const error = await promise.then(
        () => null,
        (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(TilesetImportError);
    return error as TilesetImportError;
}

/** A `.ngsprite` whose manifest states schema version `version`. */
function spriteFileOfVersion(version: number): Uint8Array {
    const manifest = { format: "ngne-sprite-project", version, generator: "later" };
    return writeZip([
        { name: "manifest.json", data: encodeJson(manifest), stored: false },
        { name: "doc.json", data: encodeJson({ future: true }), stored: false },
    ]);
}

describe("grid defaults", () => {
    const doc = (width: number, height: number, cell: number[], offset = [0, 0]) => ({
        width,
        height,
        settings: {
            ...cellSprite(1, 1, 1, [[0]]).settings,
            grid: {
                width: cell[0]!,
                height: cell[1]!,
                offsetX: offset[0]!,
                offsetY: offset[1]!,
                visible: true,
            },
        },
    });

    it("takes the sprite's grid when its cell is at most 256 a side, its offset as margin", () => {
        expect(spriteGridDefaults(doc(512, 512, [16, 8], [3, 3]))).toEqual({
            tileWidth: 16,
            tileHeight: 8,
            margin: 3,
            spacing: 0,
        });
        expect(spriteGridDefaults(doc(512, 512, [256, 256]))).toMatchObject({ tileWidth: 256 });
        // A negative offset is no margin; nor is an offset that differs between the axes.
        expect(spriteGridDefaults(doc(64, 64, [16, 16], [-2, -2]))?.margin).toBe(0);
        expect(spriteGridDefaults(doc(64, 64, [16, 16], [2, 4]))?.margin).toBe(0);
    });

    it("takes the whole canvas when the cell is larger and the canvas at most 256 a side", () => {
        expect(spriteGridDefaults(doc(200, 256, [257, 16]))).toEqual({
            tileWidth: 200,
            tileHeight: 256,
            margin: 0,
            spacing: 0,
        });
    });

    it("has none when the cell and the canvas are both larger than 256", () => {
        expect(spriteGridDefaults(doc(257, 100, [16, 300]))).toBeNull();
        expect(spriteGridDefaults(doc(300, 300, [300, 300]))).toBeNull();
    });

    it("reads the defaults from a file without decoding it", () => {
        const outline = readSpriteOutline(spriteFixture().sprite);
        expect(outline.images.size).toBe(0);
        expect(spriteGridDefaults(outline)).toEqual({
            tileWidth: 8,
            tileHeight: 8,
            margin: 0,
            spacing: 0,
        });
    });
});

describe("tiles", () => {
    // Two cells a frame: frame 2 repeats frame 0; frame 1 shows at cell 0 what cell 1 showed.
    const sprite = () =>
        cellSprite(2, 2, 2, [
            [1, 2],
            [2, 3],
            [1, 2],
        ]);

    it("makes a tile of each new cell, frames in order and cells row by row", () => {
        const { tileset } = importSpriteDocument(emptyProject(), sprite(), grid(2, 2));
        expect(tileset.tiles.map((tile) => tile.id)).toEqual([0, 1, 2, 3]);
        expect(tileset.nextTileId).toBe(4);
        const colours = tileset.tiles.map((tile) => [...tilePixels(tileset, tile.id).slice(0, 4)]);
        // Colour 2 at cell 0 of frame 1 is a new tile: only the same cell of an earlier frame
        // counts. Frame 2 adds nothing.
        expect(colours).toEqual([color(1), color(2), color(2), color(3)]);
    });

    it("keys each tile by the frame, column and row of its first occurrence", () => {
        const { tileset } = importSpriteDocument(emptyProject(), sprite(), grid(2, 2));
        expect(tileset.tiles.map((tile) => tile.sourceKey)).toEqual([
            ["frame-0", 0, 0],
            ["frame-0", 1, 0],
            ["frame-1", 0, 0],
            ["frame-1", 1, 0],
        ]);
        expect(tileset.source).toEqual({
            kind: "sprite",
            fileName: "cells.ngsprite",
            margin: 0,
            spacing: 0,
        });
        expect([tileset.name, tileset.exportName]).toEqual(["cells", "cells"]);
        tileset.slot = 1;
        const project = emptyProject();
        project.tilesets.push(tileset);
        expect(() => assertInvariants(project)).not.toThrow();
    });

    it("cuts every frame by the margin and the spacing", () => {
        // 11 × 6 px: two whole 4 × 4 tiles a row after a margin of 1 and spacing of 1.
        const doc = cellSprite(11, 6, 1, [[0]]);
        const image = doc.images.get("image-0")!;
        for (let y = 0; y < 6; y++) {
            for (let x = 0; x < 11; x++) image.data.set([x, y, 9, 255], (y * 11 + x) * 4);
        }
        const { tileset } = importSpriteDocument(emptyProject(), doc, grid(4, 4, 1, 1));
        expect(tileset.tiles.map((tile) => tile.sourceKey)).toEqual([
            ["frame-0", 0, 0],
            ["frame-0", 1, 0],
        ]);
        expect([...tilePixels(tileset, 1).slice(0, 4)]).toEqual([6, 1, 9, 255]);
        expect(tileset.source).toMatchObject({ margin: 1, spacing: 1 });
    });

    it("composites every frame as the sprite editor exports it", async () => {
        const { sprite: bytes } = spriteFixture();
        const { doc } = await deserialize(bytes);
        const { tileset } = await importSprite(emptyProject(), bytes, {
            ...grid(8, 8),
            fileName: "tiles.ngsprite",
        });
        for (const tile of tileset.tiles) {
            const [frameId, column, row] = tile.sourceKey as [string, number, number];
            const composite = compositeFrame(doc, frameId);
            expect(tilePixels(tileset, tile.id)).toEqual(
                area(composite, column * 8, row * 8, 8, 8),
            );
        }
        // Frame c repeats frame a; frames b and d change one cell each, frame e all four.
        expect(tileset.tiles.map((tile) => tile.sourceKey)).toEqual([
            ["frame-a", 0, 0],
            ["frame-a", 1, 0],
            ["frame-a", 0, 1],
            ["frame-a", 1, 1],
            ["frame-b", 1, 0],
            ["frame-d", 0, 1],
            ["frame-e", 0, 0],
            ["frame-e", 1, 0],
            ["frame-e", 0, 1],
            ["frame-e", 1, 1],
        ]);
        // The hidden layer is white and the reference layer red, both over frame a's ground.
        expect([...tilePixels(tileset, 0).slice(0, 4)]).not.toEqual([255, 255, 255, 255]);
        expect([...tilePixels(tileset, 0).slice(0, 4)]).not.toEqual([255, 0, 0, 255]);
    });
});

describe("animations", () => {
    // Cell 0 changes every frame; cell 1 keeps one colour.
    const sprite = () =>
        cellSprite(2, 2, 2, [
            [1, 9],
            [2, 9],
            [3, 9],
        ]);
    const animations = (options: SpriteImportOptions, ...tags: ReturnType<typeof tag>[]) => {
        const doc = sprite();
        doc.tags = tags;
        const result = importSpriteDocument(emptyProject(), doc, options);
        return {
            ...result,
            animated: result.tileset.tiles
                .filter((tile) => tile.animation.length > 0)
                .map((tile) => [tile.id, tile.animation.map((frame) => [frame.tile, frame.ms])]),
        };
    };

    // Tiles: 0 colour 1, 1 colour 9, 2 colour 2, 3 colour 3. Durations 10, 20, 30.
    it("animates a changing cell's first tile through its tiles, forward", () => {
        const { animated, warnings } = animations(grid(2, 2), tag("walk", 0, 2));
        expect(animated).toEqual([
            [
                0,
                [
                    [0, 10],
                    [2, 20],
                    [3, 30],
                ],
            ],
        ]);
        expect(warnings).toEqual([]);
    });

    it("expands a reverse tag, on the tile it shows first", () => {
        const { animated } = animations(grid(2, 2), tag("back", 0, 2, "reverse"));
        expect(animated).toEqual([
            [
                3,
                [
                    [3, 30],
                    [2, 20],
                    [0, 10],
                ],
            ],
        ]);
    });

    it("expands a ping-pong tag without repeating either end", () => {
        const { animated } = animations(grid(2, 2), tag("bob", 0, 2, "pingpong"));
        expect(animated).toEqual([
            [
                0,
                [
                    [0, 10],
                    [2, 20],
                    [3, 30],
                    [2, 20],
                ],
            ],
        ]);
    });

    it("plays all frames when a sprite of several frames has no tag", () => {
        expect(animations(grid(2, 2)).animated).toEqual(
            animations(grid(2, 2), tag("all", 0, 2)).animated,
        );
        const still = importSpriteDocument(emptyProject(), cellSprite(2, 2, 1, [[1]]), grid(2, 2));
        expect(still.tileset.tiles.every((tile) => tile.animation.length === 0)).toBe(true);
    });

    it("loops a tag that repeats, every pass written out, with a warning", () => {
        const { animated, warnings } = animations(grid(2, 2), tag("twice", 0, 1, "forward", 2));
        expect(animated).toEqual([
            [
                0,
                [
                    [0, 10],
                    [2, 20],
                    [0, 10],
                    [2, 20],
                ],
            ],
        ]);
        expect(warnings).toEqual([
            {
                code: "once-animation",
                animation: "twice",
                message: 'The tag "twice" plays 2 times in the sprite; it loops here.',
            },
        ]);
    });

    it("keeps the first animation of a tile and warns about the others", () => {
        const { animated, warnings } = animations(
            grid(2, 2),
            tag("first", 0, 1),
            tag("second", 0, 2),
            tag("later", 1, 2),
        );
        expect(animated).toEqual([
            [
                0,
                [
                    [0, 10],
                    [2, 20],
                ],
            ],
            [
                2,
                [
                    [2, 20],
                    [3, 30],
                ],
            ],
        ]);
        expect(warnings).toEqual([
            {
                code: "duplicate-animation",
                animation: "second",
                message:
                    'The tag "second" was left out on 1 cell: the tile it starts on is ' +
                    'animated by the tag "first" already.',
            },
        ]);
    });

    it("refuses a tag that would animate a tile through more than 1024 frames", () => {
        const doc = cellSprite(
            1,
            1,
            1,
            Array.from({ length: 600 }, (_, f) => [f % 2]),
        );
        doc.tags = [tag("long", 0, 599, "pingpong")];
        const error = refusal(() => importSpriteDocument(emptyProject(), doc, grid(1, 1)));
        expect(error.code).toBe("limit");
        expect(error.message).toMatch(/"long" plays 1198 frames; .* at most 1024/);
    });

    it("imports a long tag that animates no cell", () => {
        // 1100 frames of one colour and no tag: the tag over all frames changes nothing.
        const doc = cellSprite(
            1,
            1,
            1,
            Array.from({ length: 1100 }, () => [1]),
        );
        const { tileset, warnings } = importSpriteDocument(emptyProject(), doc, grid(1, 1));
        expect(tileset.tiles).toHaveLength(1);
        expect(tileset.tiles[0]!.animation).toEqual([]);
        expect(warnings).toEqual([]);
    });
});

describe("limits", () => {
    /** A project whose one tileset holds `tiles` tiles, `room` short of the 262 144 of all. */
    function projectWithRoom(room: number) {
        const project = emptyProject();
        const { tileset } = importSpriteDocument(project, cellSprite(1, 1, 1, [[1]]), grid(1, 1));
        tileset.tiles = Array.from({ length: 262_144 - room }, () => tileset.tiles[0]!);
        project.tilesets.push(tileset);
        return project;
    }
    // Two cells, eight frames all alike: 16 cells, 2 tiles.
    const repeated = () =>
        cellSprite(
            1,
            1,
            2,
            Array.from({ length: 8 }, () => [1, 2]),
        );

    it("counts the tiles a sprite makes, not every cell of every frame", () => {
        const { tileset } = importSpriteDocument(projectWithRoom(2), repeated(), grid(1, 1));
        expect(tileset.tiles).toHaveLength(2);
    });

    it("refuses on the outline what one frame's cells already exceed", () => {
        const error = refusal(() => planSprite(projectWithRoom(1), repeated(), grid(1, 1)));
        expect(error.code).toBe("limit");
        expect(error.message).toMatch(/262145 tiles; .* at most 262144/);
    });

    it("refuses after compositing what the tiles made exceed", () => {
        const doc = cellSprite(1, 1, 2, [
            [1, 2],
            [3, 2],
        ]);
        expect(() => planSprite(projectWithRoom(2), doc, grid(1, 1))).not.toThrow();
        const error = refusal(() => importSpriteDocument(projectWithRoom(2), doc, grid(1, 1)));
        expect(error.code).toBe("limit");
        expect(error.message).toMatch(/262145 tiles; .* at most 262144/);
    });
});

describe("reading", () => {
    it("refuses a newer version naming both versions", async () => {
        const bytes = spriteFileOfVersion(2);
        const outline = refusal(() => readSpriteOutline(bytes));
        expect(outline.code).toBe("sprite");
        expect(outline.message).toBe(
            "The sprite project has schema version 2; this editor reads sprite projects up to " +
                "version 1.",
        );
        expect(outline.cause).toMatchObject({ code: "newer-version" });
        const read = vi.fn(deserialize);
        const error = await rejection(importSprite(emptyProject(), bytes, grid(1, 1), read));
        expect(error.message).toBe(outline.message);
        expect(read).not.toHaveBeenCalled();
    });

    it("refuses what the sprite editor's reader refuses", () => {
        const error = refusal(() => readSpriteOutline(new Uint8Array([1, 2, 3])));
        expect(error.code).toBe("sprite");
        expect(error.cause).toMatchObject({ code: "not-a-zip" });
    });

    it("refuses on the outline, before any image is decoded", async () => {
        const { sprite: bytes } = spriteFixture();
        const read = vi.fn(deserialize);
        // 32 × 32 tiles do not fit the 16 × 16 canvas.
        const noTiles = await rejection(importSprite(emptyProject(), bytes, grid(32, 32), read));
        expect(noTiles.code).toBe("no-tiles");
        const full = emptyProject();
        const { tileset } = await importSprite(emptyProject(), bytes, grid(16, 16));
        full.tilesets = Array.from({ length: 255 }, () => tileset);
        const limit = await rejection(importSprite(full, bytes, grid(8, 8), read));
        expect(limit.code).toBe("limit");
        expect(read).not.toHaveBeenCalled();
    });

    it("counts every cell of every frame for packability", () => {
        // 962 frames of one 256 × 256 cell: the atlas holds at most 961.
        const doc = cellSprite(1, 1, 1, [[0]]);
        doc.width = doc.height = 256;
        doc.frames = Array.from({ length: 962 }, (_, f) => ({ id: `f${f}`, durationMs: 100 }));
        doc.cels.clear();
        doc.images.clear();
        const error = refusal(() => planSprite(emptyProject(), doc, grid(256, 256)));
        expect(error.code).toBe("packability");
        expect(error.message).toMatch(/961/);
    });
});
