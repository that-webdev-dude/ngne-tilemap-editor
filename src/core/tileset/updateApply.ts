import { CELL_INDEX_MASK, CHUNK_BITS, FLAG_MASK, cellSlot, cellTileId, cellValue } from "../cells";
import type { CellRect } from "../cells";
import type { Command } from "../history";
import { cellPatchCommand } from "../history/cellPatch";
import {
    MAX_ANIMATION_FRAMES_PER_TILESET,
    MAX_IMAGE_SIDE,
    MAX_NEXT_TILE_ID,
    walkLayers,
} from "../model";
import type { PixelBuffer, Project, TerrainSet, Tile } from "../model";
import { storedColumns, storedOrigin } from "./build";
import { TilesetImportError, TilesetUpdateError } from "./errors";
import { checkLimits, checkPackability, storedSize } from "./room";
import type { TilesetShape } from "./room";
import { matchTiles } from "./updateMatch";
import { projectWithout, tileBytes, tileSizeChanged, updatedTileset } from "./updateSource";
import type { SourceTiles } from "./updateSource";

// The apply of "Update tileset from source" (SPEC §6.3), one history entry. Matched tiles keep
// their ID, class, properties, collision and animation and take their entry's key and pixels;
// entries no tile takes become new tiles at the end of the list, with new IDs and the
// animations the import gave them. Each ambiguous or missing tile is resolved: a candidate,
// Keep as is (pixels kept, key null), Delete (its cells erased in every map) or Replace with a
// tile of the source (its cells rewritten to it, flags kept). Delete and Replace remove the
// tile: animation frames and terrain on it go too, and the app empties the current stamp's and
// the clipboard's cells on it (SPEC §4.2), told by `touched.tilesetIds`, as it is on the undo
// of new tiles. The entry holds the before and after pixels of changed, new and removed tiles
// and the rewritten cells only: `do` and `undo` rebuild the stored image from the one they
// find, so maps change only through Delete and Replace.

/** The label of the history entry. */
export const UPDATE_FROM_SOURCE_LABEL = "Update Tileset from Source";

/** What becomes of an ambiguous or missing tile; `entry` indexes the source's entries. */
export type TileResolution =
    | { kind: "candidate"; entry: number }
    | { kind: "keep" }
    | { kind: "delete" }
    | { kind: "replace"; entry: number };

/** Bytes the command claims besides the pixels and cells it holds. */
const OVERHEAD_BYTES = 256;

/** The tileset's members the update replaces. */
interface TilesetState {
    tiles: Tile[];
    columns: number;
    nextTileId: number;
    terrainSets: TerrainSet[];
}

function refuse(message: string): TilesetUpdateError {
    return new TilesetUpdateError("resolution", message);
}

/** `frames` without those on removed tiles: the same array when none is. */
function withoutFrames<T extends { tile: number }>(frames: T[], removed: ReadonlySet<number>): T[] {
    return frames.some((frame) => removed.has(frame.tile))
        ? frames.filter((frame) => !removed.has(frame.tile))
        : frames;
}

/** Terrain sets without their tiles and colour icons on removed tiles. */
function withoutTerrain(sets: TerrainSet[], removed: ReadonlySet<number>): TerrainSet[] {
    const touches = (set: TerrainSet) =>
        set.tiles.some((t) => removed.has(t.tile)) ||
        set.colors.some((c) => c.tile !== null && removed.has(c.tile));
    if (!sets.some(touches)) return sets;
    return sets.map((set) =>
        touches(set)
            ? {
                  ...set,
                  colors: set.colors.map((c) =>
                      c.tile !== null && removed.has(c.tile) ? { ...c, tile: null } : c,
                  ),
                  tiles: set.tiles.filter((t) => !removed.has(t.tile)),
              }
            : set,
    );
}

/** The commands that rewrite the cells of removed tiles of `slot`, one per tile layer. */
function cellRewrites(
    project: Project,
    slot: number,
    rewrite: ReadonlyMap<number, number | null>,
): Command[] {
    const patches: Command[] = [];
    for (const map of project.maps) {
        const bounds = { x: 0, y: 0, width: map.width, height: map.height };
        for (const { layer } of walkLayers(map.layers)) {
            if (layer.type !== "tile") continue;
            const words: number[] = [];
            let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
            for (const chunk of layer.cells.chunksIn(bounds)) {
                for (let i = 0; i < chunk.cells.length; i++) {
                    const value = chunk.cells[i]!;
                    if (value === 0 || cellSlot(value) !== slot) continue;
                    const to = rewrite.get(cellTileId(value));
                    if (to === undefined) continue;
                    const x = (chunk.cx << CHUNK_BITS) + (i & CELL_INDEX_MASK);
                    const y = (chunk.cy << CHUNK_BITS) + (i >> CHUNK_BITS);
                    const after = to === null ? 0 : (value & FLAG_MASK) | cellValue(slot, to);
                    words.push(y * map.width + x, value, after >>> 0);
                    [x0, y0] = [Math.min(x0, x), Math.min(y0, y)];
                    [x1, y1] = [Math.max(x1, x), Math.max(y1, y)];
                }
            }
            if (words.length === 0) continue;
            const cellRect: CellRect = { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
            patches.push(
                cellPatchCommand({
                    label: UPDATE_FROM_SOURCE_LABEL,
                    mapId: map.id,
                    layerId: layer.id,
                    width: map.width,
                    words: Uint32Array.from(words),
                    cellRect,
                }),
            );
        }
    }
    return patches;
}

/**
 * The stored image of `to` (tiles and columns), its tiles taken from `held` or else from the
 * same tile in `image`, laid out as `from`.
 */
function rebuildImage(
    image: PixelBuffer,
    from: { tiles: readonly Tile[]; columns: number },
    to: { tiles: readonly Tile[]; columns: number },
    tileSize: { tileWidth: number; tileHeight: number },
    held: ReadonlyMap<number, Uint8Array>,
): PixelBuffer {
    const { tileWidth, tileHeight } = tileSize;
    const shape = (columns: number, tileCount: number): TilesetShape => ({
        name: "",
        tileCount,
        tileWidth,
        tileHeight,
        columns,
    });
    const fromShape = shape(from.columns, from.tiles.length);
    const toShape = shape(to.columns, to.tiles.length);
    const { width, height } = storedSize(toShape);
    const pixels: PixelBuffer = { width, height, data: new Uint8ClampedArray(width * height * 4) };
    const position = new Map(from.tiles.map((tile, k) => [tile.id, k]));
    const row = tileWidth * 4;
    to.tiles.forEach((tile, k) => {
        const bytes = held.get(tile.id) ?? tileBytes(image, fromShape, position.get(tile.id)!);
        const { x, y } = storedOrigin(toShape, k);
        for (let dy = 0; dy < tileHeight; dy++) {
            pixels.data.set(bytes.subarray(dy * row, (dy + 1) * row), ((y + dy) * width + x) * 4);
        }
    });
    return pixels;
}

/**
 * The command that updates tileset `tilesetId` of `project` from `source` (its source re-read,
 * `readUpdateSource`), with `resolutions` by tile ID for every ambiguous and missing tile of
 * `matchTiles`; null when the update changes nothing. Throws, before any change:
 * `TilesetUpdateError` "not-found", "source-kind" for a `"collection"` tileset, "tile-size"
 * ("The tile size changed from 16 × 16 to 32 × 32."), "resolution" for an ambiguous or missing
 * tile without a resolution, a resolution for another tile, a candidate not among the tile's
 * or taken twice, or an entry out of range; `TilesetImportError` ("limit", "packability") when
 * the updated tileset would exceed a limit of FORMAT §2.8 or its export atlas.
 */
export function updateFromSourceCommand(
    project: Project,
    tilesetId: string,
    source: SourceTiles,
    resolutions: ReadonlyMap<number, TileResolution> = new Map(),
): Command | null {
    const tileset = updatedTileset(project, tilesetId);
    const { tileWidth, tileHeight, slot } = tileset;
    if (tileset.source.kind === "collection") {
        throw new TilesetUpdateError(
            "source-kind",
            "A tileset of a collection of images is updated from its Tiled file.",
        );
    }
    if (source.tileWidth !== tileWidth || source.tileHeight !== tileHeight) {
        throw tileSizeChanged(tileset, source);
    }
    const { entries } = source;
    const match = matchTiles(tileset.tiles, entries);

    // Which entry each surviving old tile takes, and which tiles go.
    const entryOf = new Map(match.matched.map((m) => [m.tileId, m.entry]));
    const owner = new Map(match.matched.map((m) => [m.entry, m.tileId]));
    const kept = new Set<number>();
    const replaced = new Map<number, number>();
    const deleted = new Set<number>();
    const open = new Set([...match.ambiguous.map((a) => a.tileId), ...match.missing]);
    for (const id of resolutions.keys()) {
        if (!open.has(id)) throw refuse(`Tile ${id} is neither ambiguous nor missing.`);
    }
    const entryInRange = (entry: number) =>
        Number.isInteger(entry) && entry >= 0 && entry < entries.length;
    for (const id of open) {
        const resolution = resolutions.get(id);
        if (!resolution) throw refuse(`Tile ${id} is ambiguous or missing and has no resolution.`);
        switch (resolution.kind) {
            case "candidate": {
                const { entry } = resolution;
                const candidates = match.ambiguous.find((a) => a.tileId === id)?.candidates ?? [];
                if (!candidates.includes(entry)) {
                    throw refuse(`Entry ${entry} is not a candidate of tile ${id}.`);
                }
                if (owner.has(entry)) {
                    throw refuse(`Entry ${entry} is taken by tile ${owner.get(entry)} already.`);
                }
                owner.set(entry, id);
                entryOf.set(id, entry);
                break;
            }
            case "keep":
                kept.add(id);
                break;
            case "delete":
                deleted.add(id);
                break;
            case "replace":
                if (!entryInRange(resolution.entry)) {
                    throw refuse(`The source has no entry ${resolution.entry}.`);
                }
                replaced.set(id, resolution.entry);
                break;
        }
    }

    // New tiles: the entries no tile takes, in source order, with IDs from `nextTileId`.
    const idOfEntry = new Map(owner);
    const fresh = entries.flatMap((_, entry) => (owner.has(entry) ? [] : [entry]));
    let nextTileId = tileset.nextTileId;
    for (const entry of fresh) idOfEntry.set(entry, nextTileId++);
    if (nextTileId > MAX_NEXT_TILE_ID) {
        throw new TilesetImportError(
            "limit",
            `The update would give tile IDs up to ${nextTileId - 1}; a tile ID is at most ` +
                `${MAX_NEXT_TILE_ID - 1}.`,
        );
    }

    const removed = new Set([...deleted, ...replaced.keys()]);
    const tileSize = { columns: tileset.columns, tileWidth, tileHeight };
    const heldBefore = new Map<number, Uint8Array>();
    const heldAfter = new Map<number, Uint8Array>();
    tileset.tiles.forEach((tile, k) => {
        const entry = entryOf.get(tile.id);
        const changed = entry !== undefined && entries[entry]!.fingerprint !== tile.fingerprint;
        if (removed.has(tile.id) || changed)
            heldBefore.set(tile.id, tileBytes(tileset.pixels, tileSize, k));
        if (changed) heldAfter.set(tile.id, entries[entry]!.pixels);
    });

    // The tiles after: survivors in their order, then the new ones.
    const tiles: Tile[] = [];
    for (const tile of tileset.tiles) {
        if (removed.has(tile.id)) continue;
        const entry = entryOf.get(tile.id);
        const animation = withoutFrames(tile.animation, removed);
        const sourceKey =
            entry === undefined ? (kept.has(tile.id) ? null : tile.sourceKey) : entries[entry]!.key;
        const fingerprint = entry === undefined ? tile.fingerprint : entries[entry]!.fingerprint;
        const same =
            animation === tile.animation &&
            fingerprint === tile.fingerprint &&
            JSON.stringify(sourceKey) === JSON.stringify(tile.sourceKey);
        tiles.push(same ? tile : { ...tile, sourceKey, fingerprint, animation });
    }
    const animations = new Map(source.animations.map((a) => [a.entry, a.frames]));
    for (const entry of fresh) {
        const id = idOfEntry.get(entry)!;
        heldAfter.set(id, entries[entry]!.pixels);
        tiles.push({
            id,
            sourceKey: entries[entry]!.key,
            fingerprint: entries[entry]!.fingerprint,
            class: "",
            collision: [],
            animation: (animations.get(entry) ?? []).map((frame) => ({
                tile: idOfEntry.get(frame.entry)!,
                ms: frame.ms,
            })),
            properties: [],
        });
    }

    // The tileset after: kept columns while the stored image fits, else about square.
    const fits = Math.ceil(tiles.length / tileset.columns) * tileHeight <= MAX_IMAGE_SIDE;
    const columns = fits ? tileset.columns : storedColumns(tiles.length, tileWidth, tileHeight);
    const shape: TilesetShape = {
        name: tileset.name,
        tileCount: tiles.length,
        tileWidth,
        tileHeight,
        columns,
    };
    const others = projectWithout(project, tileset);
    checkLimits(others, shape);
    checkPackability(shape, new Set(tiles.map((tile) => tile.fingerprint)).size);
    const frames = tiles.reduce((sum, tile) => sum + tile.animation.length, 0);
    if (frames > MAX_ANIMATION_FRAMES_PER_TILESET) {
        throw new TilesetImportError(
            "limit",
            `The animations would hold ${frames} frames together; a tileset's animations ` +
                `hold at most ${MAX_ANIMATION_FRAMES_PER_TILESET}.`,
        );
    }

    const rewrite = new Map<number, number | null>([
        ...[...deleted].map((id): [number, null] => [id, null]),
        ...[...replaced].map(([id, entry]): [number, number] => [id, idOfEntry.get(entry)!]),
    ]);
    const patches = cellRewrites(project, slot, rewrite);

    const before: TilesetState = {
        tiles: tileset.tiles,
        columns: tileset.columns,
        nextTileId: tileset.nextTileId,
        terrainSets: tileset.terrainSets,
    };
    const after: TilesetState = {
        tiles,
        columns,
        nextTileId,
        terrainSets: withoutTerrain(tileset.terrainSets, removed),
    };
    const unchanged =
        patches.length === 0 &&
        heldAfter.size === 0 &&
        removed.size === 0 &&
        columns === before.columns &&
        tiles.length === before.tiles.length &&
        tiles.every((tile, k) => tile === before.tiles[k]);
    if (unchanged) return null;

    const tileByteCount = tileWidth * tileHeight * 4;
    const pixelBytes = (heldBefore.size + heldAfter.size) * tileByteCount;
    const cellBytes = patches.reduce((sum, patch) => sum + patch.bytes, 0);
    const imageBytes = (state: TilesetState) => {
        const { width, height } = storedSize({
            ...shape,
            columns: state.columns,
            tileCount: state.tiles.length,
        });
        return width * height * 4;
    };
    const growth = imageBytes(after) - imageBytes(before);

    return historyEntry({
        tilesetId,
        tileSize,
        before,
        after,
        heldBefore,
        heldAfter,
        patches,
        bytes: OVERHEAD_BYTES + pixelBytes + cellBytes,
        growth,
    });
}

/**
 * The history entry of an update. Made apart from `updateFromSourceCommand` so that its `do`
 * and `undo` close over what the entry holds and nothing else: closures of one function share
 * its scope, so made there they would keep the whole source re-read alive, uncounted.
 */
function historyEntry(entry: {
    tilesetId: string;
    tileSize: { tileWidth: number; tileHeight: number };
    before: TilesetState;
    after: TilesetState;
    heldBefore: ReadonlyMap<number, Uint8Array>;
    heldAfter: ReadonlyMap<number, Uint8Array>;
    patches: readonly Command[];
    bytes: number;
    growth: number;
}): Command {
    const { tilesetId, tileSize, before, after, heldBefore, heldAfter, patches } = entry;
    const apply = (
        session: { project: Project },
        from: TilesetState,
        to: TilesetState,
        held: ReadonlyMap<number, Uint8Array>,
    ) => {
        const target = updatedTileset(session.project, tilesetId);
        target.pixels = rebuildImage(target.pixels, from, to, tileSize, held);
        target.tiles = to.tiles;
        target.columns = to.columns;
        target.nextTileId = to.nextTileId;
        target.terrainSets = to.terrainSets;
    };
    return {
        label: UPDATE_FROM_SOURCE_LABEL,
        bytes: entry.bytes,
        ...(entry.growth > 0 ? { projectBytes: entry.growth } : {}),
        touched: {
            mapId: null,
            layerIds: [],
            cellRects: [],
            tilesetIds: [tilesetId],
            structure: false,
        },
        do(session) {
            apply(session, before, after, heldAfter);
            for (const patch of patches) patch.do(session);
        },
        undo(session) {
            for (let at = patches.length - 1; at >= 0; at--) patches[at]!.undo(session);
            apply(session, after, before, heldBefore);
        },
    };
}
