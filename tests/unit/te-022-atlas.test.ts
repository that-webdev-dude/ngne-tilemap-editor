import { describe, expect, it } from "vitest";
import { assertInvariants, sequentialIds } from "../../src/core/model";
import { TilesetImportError, importAtlas } from "../../src/core/tileset";
import type { TilesetImportError as ImportError } from "../../src/core/tileset";
import { atlasJson, emptyProject, pixelAt, png, positionImage } from "./te-022-support";

// TE-022: `ngne-sprite-atlas` → tileset (SPEC §6.1). Every frame a tile, IDs 0.. in `frames`
// order, source key = frame ID; a frame rebuilt at its source size with its content at
// `offsetX, offsetY`; sizes that differ or exceed 256 refused naming the frames; animations on
// the tile of their first entry's frame, `once` looped and a second animation on the same
// frame dropped, both warned about.

const options = { fileName: "hero.atlas.json", newId: sequentialIds("ts") };
const image = positionImage(8, 4);

/** Frames of 3 × 3 source pixels: "full" a 4 × 4 rectangle reaching 1 px past its frame,
 * "trim" a 2 × 2 rectangle at offset 1, 1, and "same" on the rectangle of "full". */
const FRAMES = {
    full: { x: 0, y: 0, w: 4, h: 4, sourceW: 3, sourceH: 3 },
    trim: { x: 4, y: 0, w: 2, h: 2, sourceW: 3, sourceH: 3, offsetX: 1, offsetY: 1 },
    same: { x: 0, y: 0, w: 4, h: 4, sourceW: 3, sourceH: 3 },
};

async function refusal(promise: Promise<unknown>): Promise<ImportError> {
    const error = await promise.then(
        () => null,
        (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(TilesetImportError);
    return error as ImportError;
}

describe("atlas import", () => {
    it("makes a tile of every frame in frames order, keyed by frame ID", async () => {
        const { tileset } = await importAtlas(
            emptyProject(),
            atlasJson(8, 4, FRAMES),
            png(image),
            options,
        );
        expect(tileset.tiles.map((tile) => [tile.id, tile.sourceKey])).toEqual([
            [0, "full"],
            [1, "trim"],
            [2, "same"],
        ]);
        expect([tileset.tileWidth, tileset.tileHeight, tileset.nextTileId]).toEqual([3, 3, 3]);
        expect(tileset.source).toEqual({
            kind: "atlas",
            fileName: "hero.atlas.json",
            margin: 0,
            spacing: 0,
        });
        expect(tileset.name).toBe("hero");
        expect(tileset.exportName).toBe("hero");
    });

    it("rebuilds each frame at its source size with its content at its offset", async () => {
        const { tileset } = await importAtlas(
            emptyProject(),
            atlasJson(8, 4, FRAMES),
            png(image),
            options,
        );
        const { pixels, columns } = tileset;
        expect(columns).toBe(2);
        expect([pixels.width, pixels.height]).toEqual([6, 6]);
        const tile = (k: number, x: number, y: number) =>
            pixelAt(pixels, (k % columns) * 3 + x, Math.floor(k / columns) * 3 + y);
        for (let y = 0; y < 3; y++) {
            for (let x = 0; x < 3; x++) {
                // The 4 × 4 rectangle is cut at its 3 × 3 frame.
                expect(tile(0, x, y), `full ${x},${y}`).toEqual([x, y, 7, 255]);
                expect(tile(2, x, y), `same ${x},${y}`).toEqual([x, y, 7, 255]);
                const inside = x >= 1 && y >= 1;
                expect(tile(1, x, y), `trim ${x},${y}`).toEqual(
                    inside ? [4 + x - 1, y - 1, 7, 255] : [0, 0, 0, 0],
                );
            }
        }
        expect(tileset.tiles[0]!.fingerprint).toBe(tileset.tiles[2]!.fingerprint);
        expect(tileset.tiles[1]!.fingerprint).not.toBe(tileset.tiles[0]!.fingerprint);
    });

    it("refuses frames of different source sizes, naming them", async () => {
        const json = atlasJson(8, 4, {
            a: { x: 0, y: 0, w: 2, h: 2, sourceW: 2, sourceH: 2 },
            b: { x: 2, y: 0, w: 2, h: 2, sourceW: 2, sourceH: 2 },
            c: { x: 4, y: 0, w: 4, h: 4, sourceW: 4, sourceH: 4 },
        });
        const error = await refusal(importAtlas(emptyProject(), json, png(image), options));
        expect(error.code).toBe("frame-size");
        expect(error.frames).toEqual(["a", "b", "c"]);
        expect(error.message).toMatch(/2 × 2 px: "a", "b"; 4 × 4 px: "c"/);
    });

    it("cuts a rectangle that reaches past its frame at an offset", async () => {
        // A 2 × 2 frame whose content is one pixel at 1, 1: its even rectangle runs 1 px past.
        const json = atlasJson(8, 4, {
            dot: { x: 2, y: 1, w: 2, h: 2, sourceW: 2, sourceH: 2, offsetX: 1, offsetY: 1 },
        });
        const { tileset } = await importAtlas(emptyProject(), json, png(image), options);
        const { pixels } = tileset;
        expect([pixels.width, pixels.height]).toEqual([2, 2]);
        expect([0, 1, 2].map((x) => pixelAt(pixels, x % 2, Math.floor(x / 2)))).toEqual([
            [0, 0, 0, 0],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
        ]);
        expect(pixelAt(pixels, 1, 1)).toEqual([2, 1, 7, 255]);
    });

    it("refuses frames of a source size above 256, naming them", async () => {
        const json = atlasJson(8, 4, {
            small: { x: 0, y: 0, w: 2, h: 2, sourceW: 2, sourceH: 2 },
            wide: { x: 2, y: 0, w: 2, h: 2, sourceW: 300, sourceH: 2 },
            tall: { x: 4, y: 0, w: 2, h: 2, sourceW: 2, sourceH: 257 },
        });
        const error = await refusal(importAtlas(emptyProject(), json, png(image), options));
        expect(error.code).toBe("frame-size");
        expect(error.frames).toEqual(["wide", "tall"]);
        expect(error.message).toMatch(/at most 256 px a side; the frames "wide", "tall"/);
    });

    it("puts each animation on its first frame's tile, loops `once` and drops a second one", async () => {
        const json = atlasJson(8, 4, FRAMES, {
            walk: {
                entries: [
                    ["trim", 100],
                    ["same", 50],
                    ["trim", 70],
                ],
            },
            jump: {
                playback: "once",
                entries: [
                    ["full", 30],
                    ["trim", 40],
                ],
            },
            sneak: { entries: [["trim", 10]] },
        });
        const project = emptyProject();
        const { tileset, warnings } = await importAtlas(project, json, png(image), options);
        expect(tileset.tiles.map((tile) => tile.animation)).toEqual([
            [
                { tile: 0, ms: 30 },
                { tile: 1, ms: 40 },
            ],
            [
                { tile: 1, ms: 100 },
                { tile: 2, ms: 50 },
                { tile: 1, ms: 70 },
            ],
            [],
        ]);
        expect(warnings.map(({ code, animation }) => [code, animation])).toEqual([
            ["once-animation", "jump"],
            ["duplicate-animation", "sneak"],
        ]);
        expect(warnings[1]!.message).toMatch(/"walk" already starts on the frame "trim"/);
        tileset.slot = 1;
        project.tilesets.push(tileset);
        expect(() => assertInvariants(project)).not.toThrow();
    });

    it("refuses what validateAtlas refuses", async () => {
        const json = atlasJson(8, 4, FRAMES) as { width: number };
        json.width = 9;
        const error = await refusal(importAtlas(emptyProject(), json, png(image), options));
        expect(error.code).toBe("atlas");
        expect(error.message).toMatch(/states an image of 9x4 px, but the image is 8x4 px/);
    });
});
