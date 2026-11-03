import { MAX_ANIMATION_FRAMES, MAX_TILE_SIZE } from "../model";
import type { Project } from "../model";
import { AtlasError } from "../sprite/export/errors";
import { validateAtlas } from "../sprite/export/validateAtlas";
import type { AtlasFrame } from "../sprite/export/sprite-runtime";
import { decodePng } from "../sprite/png";
import { buildTileset, storedColumns, storedImage, storedOrigin, tilesetNameOf } from "./build";
import type { TilesetImport, TilesetImportOptions, TilesetImportWarning } from "./build";
import { TilesetImportError } from "./errors";
import type { PngDecoder } from "./gridPng";
import { readPngSize } from "./pngSize";
import { checkLimits, checkPackability } from "./room";
import type { TilesetShape } from "./room";

// `ngne-sprite-atlas` → tileset (SPEC §6.1). The atlas is checked with the sprite editor's
// `validateAtlas` against the size its PNG states. Every frame is a tile, IDs 0.. in the order of
// `frames`, source key = frame ID; a frame is rebuilt at its source size with its rectangle's
// content at `offsetX, offsetY`. Pivots are ignored. Each animation animates the tile of its
// first entry's frame; `once` is imported as looping and a second animation on the same frame is
// dropped, both with a warning.

/** Frames named in a message: the first few, then how many more. */
function listed(frames: readonly string[]): string {
    const shown = frames.slice(0, 8).map((id) => JSON.stringify(id));
    const more = frames.length - shown.length;
    return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
}

/** Throws when frames are above 256 px a side or of different source sizes. */
function checkFrameSizes(frames: readonly (readonly [string, AtlasFrame])[]): void {
    const large = frames.filter(([, f]) => f.sourceW > MAX_TILE_SIZE || f.sourceH > MAX_TILE_SIZE);
    if (large.length > 0) {
        const ids = large.map(([id]) => id);
        throw new TilesetImportError(
            "frame-size",
            `A tile is at most ${MAX_TILE_SIZE} px a side; the frames ${listed(ids)} are larger.`,
            { frames: ids },
        );
    }
    const bySize = new Map<string, string[]>();
    for (const [id, frame] of frames) {
        const size = `${frame.sourceW} × ${frame.sourceH}`;
        const group = bySize.get(size);
        if (group) group.push(id);
        else bySize.set(size, [id]);
    }
    if (bySize.size > 1) {
        const groups = [...bySize].map(([size, ids]) => `${size} px: ${listed(ids)}`);
        throw new TilesetImportError(
            "frame-size",
            `The tiles of a tileset share one size, but the frames differ (${groups.join("; ")}).`,
            { frames: frames.map(([id]) => id) },
        );
    }
}

/**
 * Imports an atlas, its parsed `<name>.atlas.json` (`json`) and its PNG (`png`), as a new
 * tileset of `project` (not added yet: see `addTilesetCommand`). `options.fileName` is the
 * JSON's file name. The atlas, the frame sizes, the limits and packability are checked before
 * `decode` runs. Rejects with `TilesetImportError`, or the decoder's `PngError`.
 */
export async function importAtlas(
    project: Project,
    json: unknown,
    png: Uint8Array,
    options: TilesetImportOptions,
    decode: PngDecoder = decodePng,
): Promise<TilesetImport> {
    let atlas;
    try {
        atlas = validateAtlas(json, readPngSize(png));
    } catch (error) {
        if (!(error instanceof AtlasError)) throw error;
        throw new TilesetImportError("atlas", error.message, { cause: error });
    }
    const frames = Object.entries(atlas.frames);
    checkFrameSizes(frames);
    const { sourceW: tileWidth, sourceH: tileHeight } = frames[0]![1];
    const shape: TilesetShape = {
        name: tilesetNameOf(options.fileName),
        tileCount: frames.length,
        tileWidth,
        tileHeight,
        columns: storedColumns(frames.length, tileWidth, tileHeight),
    };
    checkLimits(project, shape);
    // Without pixels, frames are distinct unless they share their rectangle and its placement.
    const placements = new Set(
        frames.map(([, f]) => `${f.x},${f.y},${f.w},${f.h},${f.offsetX},${f.offsetY}`),
    );
    checkPackability(shape, placements.size);

    const tileOf = new Map(frames.map(([id], index) => [id, index]));
    for (const [id, animation] of Object.entries(atlas.animations)) {
        if (animation.entries.length > MAX_ANIMATION_FRAMES) {
            throw new TilesetImportError(
                "limit",
                `The animation ${JSON.stringify(id)} has ${animation.entries.length} entries; ` +
                    `a tile's animation holds at most ${MAX_ANIMATION_FRAMES} frames.`,
            );
        }
    }

    const image = await decode(png);
    const pixels = storedImage(shape);
    frames.forEach(([, frame], k) => {
        const to = storedOrigin(shape, k);
        // The even rectangle may reach one pixel past its source frame (FORMAT §4): cut it there.
        const width = Math.min(frame.w, tileWidth - frame.offsetX);
        const height = Math.min(frame.h, tileHeight - frame.offsetY);
        for (let dy = 0; dy < height; dy++) {
            const from = ((frame.y + dy) * image.width + frame.x) * 4;
            const target = ((to.y + frame.offsetY + dy) * pixels.width + to.x + frame.offsetX) * 4;
            pixels.data.set(image.data.subarray(from, from + width * 4), target);
        }
    });
    const tileset = buildTileset(
        project,
        options,
        { kind: "atlas", fileName: options.fileName, margin: 0, spacing: 0 },
        shape,
        pixels,
        frames.map(([id]) => id),
    );

    const warnings: TilesetImportWarning[] = [];
    const animatedBy = new Map<number, string>();
    for (const [id, animation] of Object.entries(atlas.animations)) {
        const first = animation.entries[0]!.frame;
        const host = tileOf.get(first)!;
        const earlier = animatedBy.get(host);
        if (earlier !== undefined) {
            warnings.push({
                code: "duplicate-animation",
                animation: id,
                message:
                    `The animation ${JSON.stringify(id)} was left out: the animation ` +
                    `${JSON.stringify(earlier)} already starts on the frame ${JSON.stringify(first)}.`,
            });
            continue;
        }
        animatedBy.set(host, id);
        tileset.tiles[host]!.animation = animation.entries.map((entry) => ({
            tile: tileOf.get(entry.frame)!,
            ms: entry.ms,
        }));
        if (animation.playback === "once") {
            warnings.push({
                code: "once-animation",
                animation: id,
                message: `The animation ${JSON.stringify(id)} plays once in the atlas; it loops here.`,
            });
        }
    }
    return { tileset, warnings };
}
