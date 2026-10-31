import { GENERATOR } from "../generator";
import type { PixelBuffer, Tileset } from "../model";
import { ATLAS_FORMAT, ATLAS_VERSION } from "../sprite/export/atlasFormat";
import type { AtlasMeta } from "../sprite/export/atlasFormat";
import { pack, type PackOptions } from "../sprite/export/pack";
import { PackError, type PackErrorCode } from "../sprite/export/packErrors";
import type { AtlasAnimation, AtlasFrame } from "../sprite/export/sprite-runtime";
import { cropPixels } from "../sprite/pixels";

// `core/pack` (SPEC §10.2): a tileset packed by the sprite editor's packer, unchanged, and
// turned into the `ngne-sprite-atlas` of FORMAT §4. The export writes the image and the atlas;
// the viewport and the preview upload the same image and draw from its UV table (ENGINE §3).

/** The packer options of SPEC §10.2. */
export const TILESET_PACK_OPTIONS: PackOptions = {
    layout: "grid",
    padding: 0,
    extrude: 1,
    trim: false,
    mergeDuplicates: true,
};

/** Where each tile lies in the packed image, by tile ID. Tiles that share pixels share a rect. */
export interface TileUvTable {
    /** Tile IDs, ascending. Entry `i` of `rects` and `uv` is the tile `ids[i]`. */
    ids: readonly number[];
    /** Entry of a tile ID in `ids`. */
    index: ReadonlyMap<number, number>;
    /** `x, y, w, h` in pixels per entry: the even rectangle, its extrusion ring outside it. */
    rects: Int32Array;
    /** `u, v, uw, vh` per entry: the rectangle as fractions of the image, as NGNE samples it. */
    uv: Float32Array;
}

export interface PackedTileset {
    /** The atlas image, `<exportName>.png`. Every pixel with alpha 0 is 0,0,0,0. */
    image: PixelBuffer;
    /** The content of `<exportName>.atlas.json` (FORMAT §4). */
    atlas: AtlasMeta;
    uvTable: TileUvTable;
}

/** `pack` failed for a tileset; the message names it. `code` is the packer's. */
export class TilesetPackError extends Error {
    override readonly name = "TilesetPackError";
    readonly code: PackErrorCode;
    readonly tilesetId: string;
    readonly tilesetName: string;
    /** With `atlas-size`: the size the atlas would need. */
    readonly required: { width: number; height: number } | undefined;

    constructor(tileset: Tileset, cause: PackError) {
        super(`Tileset ${JSON.stringify(tileset.name)} cannot be packed: ${cause.message}`, {
            cause,
        });
        this.code = cause.code;
        this.tilesetId = tileset.id;
        this.tilesetName = tileset.name;
        this.required = cause.required;
    }
}

/** The ID of a tile's frame in the atlas: `<name>-<tileId>`. */
export function tileFrameId(exportName: string, tileId: number): string {
    return `${exportName}-${tileId}`;
}

/** The pixels of the tile at display position `position` of the tileset's stored grid. */
function tilePixels(tileset: Tileset, position: number): PixelBuffer {
    const { tileWidth, tileHeight, columns } = tileset;
    return cropPixels(tileset.pixels, {
        x: (position % columns) * tileWidth,
        y: Math.floor(position / columns) * tileHeight,
        width: tileWidth,
        height: tileHeight,
    });
}

/**
 * Packs a tileset (SPEC §10.2): its tiles in ID order, through `pack` of `core/sprite` with
 * `TILESET_PACK_OPTIONS`, into the atlas of FORMAT §4: one frame `<name>-<tileId>` per tile,
 * `sourceW/H` the tile size, offsets 0, the even rectangle, pivot `[0, 1]`; one `loop`
 * animation per animated tile. Deterministic: the same tileset gives the same image bytes and
 * the same atlas. The tileset is not changed.
 *
 * Throws `TilesetPackError` naming the tileset when `pack` fails, as when the image would be
 * larger than 8192 px a side.
 */
export function packTileset(tileset: Tileset): PackedTileset {
    const name = tileset.exportName;
    const placed = tileset.tiles
        .map((tile, position) => ({ tile, position }))
        .sort((a, b) => a.tile.id - b.tile.id);
    const tiles = placed.map(({ tile }) => tile);
    const frames = placed.map(({ position }) => tilePixels(tileset, position));

    let result;
    try {
        result = pack(frames, TILESET_PACK_OPTIONS);
    } catch (error) {
        if (error instanceof PackError) throw new TilesetPackError(tileset, error);
        throw error;
    }
    const { atlas: image, rects } = result;

    const rectOf: (typeof rects)[number][] = [];
    for (const rect of rects) {
        for (const index of rect.frameIndices) rectOf[index] = rect;
    }

    const count = tiles.length;
    const uvTable: TileUvTable = {
        ids: tiles.map((tile) => tile.id),
        index: new Map(tiles.map((tile, index) => [tile.id, index])),
        rects: new Int32Array(count * 4),
        uv: new Float32Array(count * 4),
    };
    const atlasFrames: [string, AtlasFrame][] = [];
    tiles.forEach((tile, index) => {
        const { x, y, w, h } = rectOf[index];
        uvTable.rects.set([x, y, w, h], index * 4);
        uvTable.uv.set(
            [x / image.width, y / image.height, w / image.width, h / image.height],
            index * 4,
        );
        atlasFrames.push([
            tileFrameId(name, tile.id),
            {
                x,
                y,
                w,
                h,
                sourceW: tileset.tileWidth,
                sourceH: tileset.tileHeight,
                offsetX: 0,
                offsetY: 0,
                pivot: [0, 1],
            },
        ]);
    });

    const animations: [string, AtlasAnimation][] = tiles
        .filter((tile) => tile.animation.length > 0)
        .map((tile) => {
            const entries = tile.animation.map(({ tile: frame, ms }) => ({
                frame: tileFrameId(name, frame),
                ms,
            }));
            const durationMs = entries.reduce((sum, entry) => sum + entry.ms, 0);
            return [tileFrameId(name, tile.id), { playback: "loop", durationMs, entries }];
        });

    // `Object.fromEntries` defines members; the frame IDs are not integer-like, so the members
    // keep the tile ID order.
    const atlas: AtlasMeta = {
        format: ATLAS_FORMAT,
        version: ATLAS_VERSION,
        generator: GENERATOR,
        image: `${name}.png`,
        width: image.width,
        height: image.height,
        frames: Object.fromEntries(atlasFrames),
        animations: Object.fromEntries(animations),
    };
    return { image, atlas, uvTable };
}
