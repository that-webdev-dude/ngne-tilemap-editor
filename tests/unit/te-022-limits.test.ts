import { describe, expect, it, vi } from "vitest";
import type { PixelBuffer, Project, Tileset } from "../../src/core/model";
import { TilesetImportError, importAtlas, importGridPng } from "../../src/core/tileset";
import type { FrameSpec } from "./te-022-support";
import { atlasJson, emptyProject, pngHeader } from "./te-022-support";
import { tileset as fixtureTileset } from "./te-006-support";

// TE-022: the pixel limits of FORMAT §2.8 and packability (SPEC §6.1) refuse an import before
// any pixel is decoded, with a message naming the limit. The decoder is a spy; the PNGs are
// headers only, so a decode that ran would fail anyway.

const grid = (tile: number) => ({
    fileName: "big.png",
    tileWidth: tile,
    tileHeight: tile,
    margin: 0,
    spacing: 0,
});

/** A project holding `tilesets` tilesets, each claiming `tiles` tiles and `side × side` px. */
function crowded(tilesets: number, tiles: number, side: number): Project {
    const project = emptyProject();
    for (let i = 0; i < tilesets; i++) {
        const tileset: Tileset = { ...fixtureTileset(`t${i}`, i + 1, 1), exportName: `t${i}` };
        tileset.tiles = Array.from({ length: tiles }, () => tileset.tiles[0]!);
        tileset.pixels = { width: side, height: side, data: new Uint8ClampedArray(0) };
        project.tilesets.push(tileset);
    }
    return project;
}

async function refusedBeforeDecoding(
    run: (decode: (bytes: Uint8Array) => Promise<PixelBuffer>) => Promise<unknown>,
    code: string,
    message: RegExp,
): Promise<void> {
    const decode = vi.fn<(bytes: Uint8Array) => Promise<PixelBuffer>>();
    const error = await run(decode).then(
        () => null,
        (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(TilesetImportError);
    expect((error as TilesetImportError).code).toBe(code);
    expect((error as TilesetImportError).message).toMatch(message);
    expect(decode).not.toHaveBeenCalled();
}

/** `count` frames of `size` px, on `distinct` different rectangles, in an 8192 px image. */
function frames(count: number, size: number, distinct: number): Record<string, FrameSpec> {
    const perRow = Math.floor(8192 / size);
    return Object.fromEntries(
        Array.from({ length: count }, (_, index) => {
            const at = index % distinct;
            const rect = { x: (at % perRow) * size, y: Math.floor(at / perRow) * size };
            return [`f${index}`, { ...rect, w: size, h: size, sourceW: size, sourceH: size }];
        }),
    );
}

describe("refusals before decoding", () => {
    it("refuses a grid PNG above 8192 px a side", async () => {
        await refusedBeforeDecoding(
            (decode) => importGridPng(emptyProject(), pngHeader(8193, 16), grid(16), decode),
            "limit",
            /at most 8192 px a side/,
        );
    });

    it("refuses more than 65 536 tiles in a tileset", async () => {
        await refusedBeforeDecoding(
            (decode) => importGridPng(emptyProject(), pngHeader(300, 300), grid(1), decode),
            "limit",
            /90000 tiles; a tileset holds at most 65536/,
        );
    });

    it("refuses more than 262 144 tiles in all tilesets", async () => {
        await refusedBeforeDecoding(
            (decode) => importGridPng(crowded(4, 65_536, 1), pngHeader(16, 16), grid(16), decode),
            "limit",
            /262145 tiles; all tilesets together hold at most 262144/,
        );
    });

    it("refuses more than 64 MP in all tileset images", async () => {
        await refusedBeforeDecoding(
            (decode) => importGridPng(crowded(1, 1, 8192), pngHeader(16, 16), grid(16), decode),
            "limit",
            /67109120 pixels; all tileset images together hold at most 67108864 \(64 MP\)/,
        );
    });

    it("refuses a 256th tileset", async () => {
        await refusedBeforeDecoding(
            (decode) => importGridPng(crowded(255, 1, 1), pngHeader(16, 16), grid(16), decode),
            "limit",
            /at most 255 tilesets/,
        );
    });

    it("refuses a grid PNG of more tiles than its export atlas holds", async () => {
        // 32 × 32 tiles of 256 px; the atlas holds 961 of them.
        await refusedBeforeDecoding(
            (decode) => importGridPng(emptyProject(), pngHeader(8192, 8192), grid(256), decode),
            "packability",
            /would have 1024 distinct tiles of 256 × 256 px; its export atlas holds at most 961/,
        );
    });

    it("refuses an atlas of more distinct frames than its export atlas holds", async () => {
        const json = atlasJson(8192, 8192, frames(1000, 256, 1000));
        await refusedBeforeDecoding(
            (decode) =>
                importAtlas(
                    emptyProject(),
                    json,
                    pngHeader(8192, 8192),
                    { fileName: "a.atlas.json" },
                    decode,
                ),
            "packability",
            /1000 distinct tiles of 256 × 256 px; its export atlas holds at most 961/,
        );
    });

    it("counts atlas frames on one rectangle once for packability, and then decodes", async () => {
        const json = atlasJson(8192, 8192, frames(1000, 256, 10));
        const decode = vi.fn(() => Promise.reject(new Error("decoded")));
        await expect(
            importAtlas(
                emptyProject(),
                json,
                pngHeader(8192, 8192),
                { fileName: "a.atlas.json" },
                decode,
            ),
        ).rejects.toThrow("decoded");
        expect(decode).toHaveBeenCalledOnce();
    });

    it("refuses an atlas animation longer than a tile's 1024 frames", async () => {
        const json = atlasJson(
            16,
            16,
            { a: { x: 0, y: 0, w: 2, h: 2, sourceW: 2, sourceH: 2 } },
            {
                long: {
                    entries: Array.from({ length: 1025 }, () => ["a", 10] as [string, number]),
                },
            },
        );
        await refusedBeforeDecoding(
            (decode) =>
                importAtlas(
                    emptyProject(),
                    json,
                    pngHeader(16, 16),
                    { fileName: "a.atlas.json" },
                    decode,
                ),
            "limit",
            /1025 entries; a tile's animation holds at most 1024 frames/,
        );
    });

    it("refuses an atlas whose frames break the size rules before decoding", async () => {
        const json = atlasJson(16, 16, {
            a: { x: 0, y: 0, w: 2, h: 2, sourceW: 2, sourceH: 2 },
            b: { x: 2, y: 0, w: 4, h: 4, sourceW: 4, sourceH: 4 },
        });
        await refusedBeforeDecoding(
            (decode) =>
                importAtlas(
                    emptyProject(),
                    json,
                    pngHeader(16, 16),
                    { fileName: "a.atlas.json" },
                    decode,
                ),
            "frame-size",
            /"a"/,
        );
    });
});
