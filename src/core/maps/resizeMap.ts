import { CELL_INDEX_MASK, CHUNK_BITS, CHUNK_SIZE, CellStore } from "../cells";
import type { Command, Touched } from "../history";
import { BYTES_PER_CHUNK, MAX_LAYER_OFFSET, MAX_MARKER_COORD, walkLayers } from "../model";
import type {
    ImageLayer,
    Marker,
    Project,
    ProjectMap,
    ProjectSession,
    Region,
    TileLayer,
} from "../model";
import { MapEditError, mapOf, newMapProblems } from "./mapCommands";

// Resize / Offset Map (SPEC §7.1; Tiled's `MapDocument::resizeMap`): a new width and height in
// cells and an offset in cells, the place of the old map's top-left cell in the new one. In one
// history entry, every tile layer's cells move by the offset and those outside the new bounds
// are removed; every marker moves by the offset in pixels and is kept even outside the bounds;
// every image layer's offset moves by the offset in pixels (Tiled's `SetLayerOffset` by the
// change of the map's bounding rectangle); the tile selection moves by the offset and is not cut
// to the new bounds, and undo puts back the selection it moved (Tiled's `ChangeSelectedArea`).
// Other layer offsets stay.
//
// The offset is limited as Tiled's `ResizeHelper` limits it: on each axis, from 0 to the growth
// when the map grows and from the shrink to 0 when it shrinks, so the old map either holds the
// new bounds or lies inside them. The new cells of each tile layer are laid out when the command
// is made, so `do` and `undo` swap whole cell stores; a redo puts back the same stores.

/** The label of the history entry (Tiled's "Resize Map"). */
export const RESIZE_MAP_LABEL = "Resize Map";

/** What Resize / Offset Map sets: the new size and the offset of the old map in it, in cells. */
export interface ResizeMapValues {
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
}

/** The range of one axis of the offset: `min..max` cells. */
export interface OffsetRange {
    min: number;
    max: number;
}

/**
 * The offsets Tiled's `ResizeHelper` allows on an axis whose size goes from `from` to `to`
 * cells: `0..to − from` when it grows (or stays), `to − from..0` when it shrinks.
 */
export function offsetRange(from: number, to: number): OffsetRange {
    const change = to - from;
    return change >= 0 ? { min: 0, max: change } : { min: change, max: 0 };
}

/** `value` moved into `range`. */
export function clampOffset(value: number, range: OffsetRange): number {
    return Math.min(range.max, Math.max(range.min, value));
}

/** One of the nine anchors of the dialog's anchor grid (DESIGN §9). */
export interface ResizeAnchor {
    /** "top-left" … "bottom-right". */
    id: string;
    /** "Top left" … "Bottom right". */
    name: string;
    /** Where the old map sits in the new one on each axis: 0 left or top, ½ centre, 1 right or bottom. */
    x: number;
    y: number;
}

const ANCHOR_STOPS = [0, 0.5, 1] as const;
const ANCHOR_ROWS = ["top", "centre", "bottom"] as const;
const ANCHOR_COLUMNS = ["left", "centre", "right"] as const;

/** Anchors in a row of the grid. */
export const RESIZE_ANCHOR_COLUMNS = ANCHOR_COLUMNS.length;

/** The anchor grid, row by row from the top-left corner (the sprite editor's pivot presets). */
export const RESIZE_ANCHORS: readonly ResizeAnchor[] = ANCHOR_ROWS.flatMap((row, rowIndex) =>
    ANCHOR_COLUMNS.map((column, columnIndex): ResizeAnchor => {
        const id = row === column ? "centre" : `${row}-${column}`;
        const words = id.replace("-", " ");
        return {
            id,
            name: words.charAt(0).toUpperCase() + words.slice(1),
            x: ANCHOR_STOPS[columnIndex]!,
            y: ANCHOR_STOPS[rowIndex]!,
        };
    }),
);

/**
 * The offset on one axis that puts the old map at `anchor` (0, ½ or 1) of the new size:
 * truncated towards zero, as the sprite editor's canvas size, so that growing by one cell and
 * shrinking back gives the original.
 */
export function anchorOffset(anchor: number, from: number, to: number): number {
    return Math.trunc(anchor * (to - from)) || 0;
}

/** A rectangle of map pixels: where the markers, or the image layer offsets, of a map lie. */
export interface PixelExtent {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

/** What `resizeMapProblems` needs of the map being resized. */
export interface ResizeSource {
    /** The size in cells. */
    width: number;
    height: number;
    /** The tile size in pixels: an offset in cells moves markers and image layers by it. */
    tileWidth: number;
    tileHeight: number;
    /** The positions of the map's markers; null without one. */
    markers: PixelExtent | null;
    /** The offsets of the map's image layers; null without one. */
    images: PixelExtent | null;
}

function extend(extent: PixelExtent | null, x: number, y: number): PixelExtent {
    if (!extent) return { minX: x, maxX: x, minY: y, maxY: y };
    return {
        minX: Math.min(extent.minX, x),
        maxX: Math.max(extent.maxX, x),
        minY: Math.min(extent.minY, y),
        maxY: Math.max(extent.maxY, y),
    };
}

/** The `ResizeSource` of `map`: one pass over its layers, made once for a dialog. */
export function resizeSource(map: ProjectMap): ResizeSource {
    let markers: PixelExtent | null = null;
    let images: PixelExtent | null = null;
    for (const { layer } of walkLayers(map.layers)) {
        if (layer.type === "marker") {
            for (const marker of layer.markers) markers = extend(markers, marker.x, marker.y);
        } else if (layer.type === "image") {
            images = extend(images, layer.offsetX, layer.offsetY);
        }
    }
    const { width, height, tileWidth, tileHeight } = map;
    return { width, height, tileWidth, tileHeight, markers, images };
}

const pixels = (value: number) => `${value.toLocaleString("en")} pixels`;

/** Whether `extent` moved by `shift` on `axis` passes `±limit`. */
function reaches(
    extent: PixelExtent | null | undefined,
    axis: "X" | "Y",
    shift: number,
    limit: number,
): boolean {
    if (!extent) return false;
    const [min, max] = axis === "X" ? [extent.minX, extent.maxX] : [extent.minY, extent.maxY];
    return min + shift < -limit || max + shift > limit;
}

/**
 * Why `values` cannot resize the map of `source`, by field; empty when they can: a size out of
 * FORMAT §2.8, an offset out of Tiled's range, or an offset that would move a marker or an image
 * layer past its coordinate range (FORMAT §1.5, §2.5). Without `markers`, `images` and the tile
 * size, the size and the offset range only are checked.
 */
export function resizeMapProblems(
    source: Pick<ResizeSource, "width" | "height"> & Partial<ResizeSource>,
    values: ResizeMapValues,
): Partial<Record<keyof ResizeMapValues, string>> {
    const from = source;
    const sizeProblems = newMapProblems({
        name: "-",
        width: values.width,
        height: values.height,
        tileWidth: 1,
        tileHeight: 1,
    });
    const problems: Partial<Record<keyof ResizeMapValues, string>> = {};
    if (sizeProblems.width) problems.width = sizeProblems.width;
    if (sizeProblems.height) problems.height = sizeProblems.height;
    const axes = [
        ["offsetX", from.width, values.width, "width"],
        ["offsetY", from.height, values.height, "height"],
    ] as const;
    for (const [key, old, size, side] of axes) {
        if (problems[side]) continue;
        const range = offsetRange(old, size);
        const value = values[key];
        const axis = key === "offsetX" ? "X" : "Y";
        if (!Number.isInteger(value) || value < range.min || value > range.max) {
            problems[key] =
                range.min === range.max
                    ? `The offset ${axis} is 0 while the ${side} stays ${old}.`
                    : `The offset ${axis} is a whole number of cells from ${range.min} to ${range.max}.`;
            continue;
        }
        const shift = value * ((key === "offsetX" ? source.tileWidth : source.tileHeight) ?? 0);
        if (reaches(source.markers, axis, shift, MAX_MARKER_COORD)) {
            problems[key] =
                `The offset ${axis} would move a marker past ${pixels(MAX_MARKER_COORD)}.`;
        } else if (reaches(source.images, axis, shift, MAX_LAYER_OFFSET)) {
            problems[key] =
                `The offset ${axis} would move an image layer past ${pixels(MAX_LAYER_OFFSET)}.`;
        }
    }
    return problems;
}

/** The cells of `store` moved by `dx, dy`, those outside `width × height` left out. */
function movedCells(
    store: CellStore,
    from: { width: number; height: number },
    values: ResizeMapValues,
): CellStore {
    const { width, height, offsetX: dx, offsetY: dy } = values;
    const moved = new CellStore();
    for (const chunk of store.chunksIn({ x: 0, y: 0, width: from.width, height: from.height })) {
        const left = chunk.cx * CHUNK_SIZE + dx;
        const top = chunk.cy * CHUNK_SIZE + dy;
        chunk.cells.forEach((value, index) => {
            if (value === 0) return;
            const x = left + (index & CELL_INDEX_MASK);
            const y = top + (index >> CHUNK_BITS);
            if (x >= 0 && y >= 0 && x < width && y < height) moved.set(x, y, value);
        });
    }
    return moved;
}

/** `marker` moved by `dx, dy` pixels; polygon and polyline points are relative and stay. */
function movedMarker(marker: Marker, dx: number, dy: number): Marker {
    return { ...marker, x: marker.x + dx, y: marker.y + dy };
}

/** Makes `list` hold `items`, in place: the marker layer keeps its list. */
function replaceAll(list: Marker[], items: readonly Marker[]): void {
    list.length = items.length;
    items.forEach((item, index) => (list[index] = item));
}

/** Bytes the entry claims for each marker it keeps: an estimate of a marker object. */
const MARKER_BYTES = 128;

/**
 * The command that resizes map `id` of `project` to `values` (SPEC §7.1), one entry labelled
 * "Resize Map"; null when the size and the offset change nothing. Throws `MapEditError`
 * ("values") when a value is refused (`resizeMapProblems`) or a moved marker or image layer
 * would leave its coordinate range (FORMAT §1.5, §2.5), and ("missing") for an unknown map.
 */
export function resizeMapCommand(
    project: Project,
    id: string,
    values: ResizeMapValues,
): Command | null {
    const map = mapOf(project, id);
    const from = { width: map.width, height: map.height };
    const problems = Object.values(resizeMapProblems(from, values));
    if (problems.length > 0) throw new MapEditError("values", problems[0]!);
    const { width, height, offsetX, offsetY } = values;
    if (width === from.width && height === from.height && offsetX === 0 && offsetY === 0) {
        return null;
    }

    const tileLayers: { layer: TileLayer; before: CellStore; after: CellStore }[] = [];
    const markerLayers: { markers: Marker[]; before: Marker[]; after: Marker[] }[] = [];
    const imageLayers: { layer: ImageLayer; before: [number, number]; after: [number, number] }[] =
        [];
    const dx = offsetX * map.tileWidth;
    const dy = offsetY * map.tileHeight;
    for (const { layer } of walkLayers(map.layers)) {
        if (layer.type === "tile") {
            const after = movedCells(layer.cells, from, values);
            tileLayers.push({ layer, before: layer.cells, after });
        } else if (layer.type === "marker" && (dx !== 0 || dy !== 0)) {
            const after = layer.markers.map((marker) => movedMarker(marker, dx, dy));
            const outside = after.find(
                (marker) =>
                    Math.abs(marker.x) > MAX_MARKER_COORD || Math.abs(marker.y) > MAX_MARKER_COORD,
            );
            if (outside) {
                throw new MapEditError(
                    "values",
                    `The offset would move marker ${outside.id} of “${layer.name}” past ` +
                        `${pixels(MAX_MARKER_COORD)}.`,
                );
            }
            markerLayers.push({ markers: layer.markers, before: [...layer.markers], after });
        } else if (layer.type === "image" && (dx !== 0 || dy !== 0)) {
            const after: [number, number] = [layer.offsetX + dx, layer.offsetY + dy];
            if (after.some((offset) => Math.abs(offset) > MAX_LAYER_OFFSET)) {
                throw new MapEditError(
                    "values",
                    `The offset would move image layer “${layer.name}” past ` +
                        `${pixels(MAX_LAYER_OFFSET)}.`,
                );
            }
            imageLayers.push({ layer, before: [layer.offsetX, layer.offsetY], after });
        }
    }

    const chunkBytes = (stores: CellStore[]) =>
        stores.reduce((sum, store) => sum + store.chunkCount * BYTES_PER_CHUNK, 0);
    const beforeBytes = chunkBytes(tileLayers.map((entry) => entry.before));
    const afterBytes = chunkBytes(tileLayers.map((entry) => entry.after));
    const markerCount = markerLayers.reduce((sum, entry) => sum + entry.before.length, 0);
    // The command keeps the cells the project does not hold, the old ones after `do` and the new
    // ones after `undo`, and both lists of markers.
    const bytes = 256 + Math.max(beforeBytes, afterBytes) + 2 * markerCount * MARKER_BYTES;
    const touched: Touched = {
        mapId: id,
        layerIds: [
            ...tileLayers.map((entry) => entry.layer.id),
            ...imageLayers.map((entry) => entry.layer.id),
        ],
        cellRects: [],
        tilesetIds: [],
        structure: true,
    };

    const setSize = (session: ProjectSession, w: number, h: number) => {
        const target = mapOf(session.project, id);
        target.width = w;
        target.height = h;
    };
    /** The selection `do` moved, which `undo` puts back; undefined while `do` has not run. */
    let selectionBefore: Region | null | undefined;

    return {
        label: RESIZE_MAP_LABEL,
        bytes,
        touched,
        ...(afterBytes > beforeBytes ? { projectBytes: afterBytes - beforeBytes } : {}),
        do(session) {
            mapOf(session.project, id);
            for (const entry of tileLayers) entry.layer.cells = entry.after;
            for (const entry of markerLayers) replaceAll(entry.markers, entry.after);
            for (const { layer, after } of imageLayers) [layer.offsetX, layer.offsetY] = after;
            setSize(session, width, height);
            const mapSession = session.perMap.get(id);
            selectionBefore = mapSession?.tileSelection ?? null;
            if (mapSession && selectionBefore) {
                const { x, y } = selectionBefore;
                mapSession.tileSelection = { ...selectionBefore, x: x + offsetX, y: y + offsetY };
            }
        },
        undo(session) {
            mapOf(session.project, id);
            for (const entry of tileLayers) entry.layer.cells = entry.before;
            for (const entry of markerLayers) replaceAll(entry.markers, entry.before);
            for (const { layer, before } of imageLayers) [layer.offsetX, layer.offsetY] = before;
            setSize(session, from.width, from.height);
            const mapSession = session.perMap.get(id);
            if (mapSession && selectionBefore !== undefined) {
                mapSession.tileSelection = selectionBefore;
            }
        },
    };
}
