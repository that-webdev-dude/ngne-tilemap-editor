import { describe, expect, it } from "vitest";
import { assertInvariants, sequentialIds } from "../../src/core/model";
import type { PixelBuffer } from "../../src/core/model";
import {
    TilesetImportError,
    importGridPng,
    planGridPng,
    tileFingerprint,
} from "../../src/core/tileset";
import type { GridPngOptions } from "../../src/core/tileset";
import { emptyProject, pixelAt, png, positionImage } from "./te-022-support";

// TE-022: grid PNG → tileset (SPEC §6.1). Tiled's grid (`initializeTilesetTiles`, v1.12.2):
// tiles from `margin`, a step of the tile size plus `spacing`, every whole cell a tile, IDs row
// by row, source keys `[column, row]`, pixels copied into the stored grid without margin or
// spacing.

const options = (patch: Partial<GridPngOptions> = {}): GridPngOptions => ({
    fileName: "Forest Tiles.png",
    tileWidth: 3,
    tileHeight: 2,
    margin: 2,
    spacing: 1,
    newId: sequentialIds("ts"),
    ...patch,
});

/** Source pixel of pixel `(x, y)` of tile `(column, row)` in the grid of `options()`. */
const sourceOf = (column: number, row: number, x: number, y: number) => [
    2 + column * 4 + x,
    2 + row * 3 + y,
];

/** Every pixel of tile `k` of the stored image, row by row. */
function storedTile(pixels: PixelBuffer, columns: number, k: number): number[][] {
    const out: number[][] = [];
    const ox = (k % columns) * 3;
    const oy = Math.floor(k / columns) * 2;
    for (let y = 0; y < 2; y++)
        for (let x = 0; x < 3; x++) out.push(pixelAt(pixels, ox + x, oy + y));
    return out;
}

describe("grid PNG import", () => {
    it("slices with margin and spacing and stores the tiles without them", async () => {
        // 2 + 3 tiles of 3 with 1 between + 2 px left over; 2 + 2 tiles of 2 with 1 + 1 left.
        const image = positionImage(15, 8);
        const { tileset, warnings } = await importGridPng(emptyProject(), png(image), options());
        expect(warnings).toEqual([]);
        expect(tileset.columns).toBe(3);
        expect(tileset.tiles).toHaveLength(6);
        expect(tileset.pixels.width).toBe(9);
        expect(tileset.pixels.height).toBe(4);
        expect(tileset.pixels.data).toHaveLength(9 * 4 * 4);
        for (let k = 0; k < 6; k++) {
            const [column, row] = [k % 3, Math.floor(k / 3)];
            const expected: number[][] = [];
            for (let y = 0; y < 2; y++) {
                for (let x = 0; x < 3; x++) {
                    const [sx, sy] = sourceOf(column, row, x, y);
                    expected.push([sx!, sy!, 7, 255]);
                }
            }
            expect(storedTile(tileset.pixels, 3, k), `tile ${k}`).toEqual(expected);
        }
    });

    it("numbers the tiles 0.. row by row with [column, row] source keys", async () => {
        const { tileset } = await importGridPng(
            emptyProject(),
            png(positionImage(15, 8)),
            options(),
        );
        expect(tileset.tiles.map((tile) => tile.id)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(tileset.tiles.map((tile) => tile.sourceKey)).toEqual([
            [0, 0],
            [1, 0],
            [2, 0],
            [0, 1],
            [1, 1],
            [2, 1],
        ]);
        expect(tileset.nextTileId).toBe(6);
    });

    it("drops partial cells at the right and the bottom; the margin counts left and top only", () => {
        const project = emptyProject();
        const shape = (width: number, height: number) =>
            planGridPng(project, { width, height }, options());
        // Tiled: x runs from the margin while x <= width - tileWidth.
        expect(shape(13, 7)).toMatchObject({ columns: 3, tileCount: 6 });
        expect(shape(12, 7)).toMatchObject({ columns: 2, tileCount: 4 });
        expect(shape(13, 6)).toMatchObject({ columns: 3, tileCount: 3 });
        expect(shape(14, 9)).toMatchObject({ columns: 3, tileCount: 6 });
        expect(
            planGridPng(
                project,
                { width: 16, height: 16 },
                options({ margin: 0, spacing: 0, tileWidth: 5, tileHeight: 5 }),
            ),
        ).toMatchObject({ columns: 3, tileCount: 9 });
    });

    it("refuses an image with no whole tile and options out of range", () => {
        const project = emptyProject();
        expect(() => planGridPng(project, { width: 4, height: 8 }, options())).toThrow(
            expect.objectContaining({ code: "no-tiles" }),
        );
        for (const patch of [
            { tileWidth: 0 },
            { tileHeight: 257 },
            { margin: -1 },
            { spacing: 4097 },
        ]) {
            expect(
                () => planGridPng(project, { width: 15, height: 8 }, options(patch)),
                JSON.stringify(patch),
            ).toThrow(TilesetImportError);
        }
    });

    it("records the source, names the tileset after the file and makes its export name unique", async () => {
        const project = emptyProject();
        project.maps[0]!.exportName = "forest-tiles";
        const { tileset } = await importGridPng(project, png(positionImage(15, 8)), options());
        expect(tileset.source).toEqual({
            kind: "image",
            fileName: "Forest Tiles.png",
            margin: 2,
            spacing: 1,
        });
        expect(tileset.name).toBe("Forest Tiles");
        expect(tileset.exportName).toBe("forest-tiles-2");
        expect(tileset.id).toBe("ts1");
        expect([tileset.tileWidth, tileset.tileHeight]).toEqual([3, 2]);
    });

    it("fingerprints each tile from its stored pixels and passes the invariants once added", async () => {
        const project = emptyProject();
        const { tileset } = await importGridPng(project, png(positionImage(15, 8)), options());
        tileset.tiles.forEach((tile, k) => {
            const x = (k % 3) * 3;
            const y = Math.floor(k / 3) * 2;
            expect(tile.fingerprint).toBe(tileFingerprint(tileset.pixels, x, y, 3, 2));
        });
        expect(new Set(tileset.tiles.map((tile) => tile.fingerprint)).size).toBe(6);
        tileset.slot = 1;
        project.tilesets.push(tileset);
        expect(() => assertInvariants(project)).not.toThrow();
    });
});
