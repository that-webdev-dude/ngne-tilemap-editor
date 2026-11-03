import type { CellRect, Stamp } from "../../../core/cells";
import { MapCompositor } from "../../../core/compositor";
import { createTileLayer } from "../../../core/model";
import type { PixelBuffer, Project, ProjectMap, Tileset, TileLayer } from "../../../core/model";
import type { PixelPoint } from "../../../core/raster/line";
import type { OverlayFrame } from "../../overlay/types";
import { cellDeviceRect, clipToMap } from "../cellOutline";

// The picture of the current stamp (SPEC §4.2): its tiles on a grid of the map's cell size, as
// `core/compositor` draws a map. A tile larger than the cell is cut at the stamp's edge. What it
// costs follows what is shown, never the stamp's pixels (as Tiled's `BrushItem` draws only the
// exposed part of its preview layer): the rail's preview is composited at its own size
// (`stampThumbnail`); the overlay's previews at the view's scale, in chunks of the stamp made
// when first in view (`drawStamp`). One compositor reads the tilesets, again only when one of
// them or the cell size changed; a new stamp only puts its layer in, so it costs its cells.

/** The longer side of a chunk of the overlay's picture, at most, in texels. */
export const STAMP_CHUNK_TEXELS = 256;
/** How long one redraw composites chunks after its first one; the rest wait for the next. */
export const STAMP_SLICE_MS = 8;

/** A compositor of a map the stamp's size: the tilesets read once, any stamp's layer put in. */
interface Reader {
    readonly tileWidth: number;
    readonly tileHeight: number;
    /** What it read of each tileset, in list order (`readOf`). */
    readonly read: readonly (readonly unknown[])[];
    /** Its map: a stamp's layer and size are put in before each use (`show`). */
    readonly grid: ProjectMap;
    readonly compositor: MapCompositor;
}

/** The stamp as the one layer of a map of its size, and the compositor that draws it. */
interface Source {
    readonly stamp: Stamp;
    readonly layer: TileLayer;
    readonly reader: Reader;
}

/** The stamp at one scale: chunks of whole cells, made when first shown. */
interface Picture {
    readonly source: Source;
    /** Texels per cell. */
    readonly texelsX: number;
    readonly texelsY: number;
    /** Cells per chunk; the last row and column may hold fewer. */
    readonly cellsX: number;
    readonly cellsY: number;
    readonly columns: number;
    readonly rows: number;
    /** Chunks made, by `row × columns + column`, the least recently shown first. */
    readonly chunks: Map<number, HTMLCanvasElement>;
}

/** One tiling of the stamp: from the cell its top-left cell lies on, over the cells of `area`. */
export interface StampTiling {
    readonly origin: PixelPoint;
    readonly area: CellRect;
}

let reader: Reader | null = null;
let source: Source | null = null;
let picture: Picture | null = null;
const listeners = new Set<() => void>();

/** What a `MapCompositor` reads of `tileset` when it is made. */
function readOf(tileset: Tileset): readonly unknown[] {
    const { pixels, tiles, slot, tileWidth, tileHeight, offsetX, offsetY, columns } = tileset;
    return [
        tileset,
        pixels,
        tiles,
        tiles.length,
        slot,
        tileWidth,
        tileHeight,
        offsetX,
        offsetY,
        columns,
    ];
}

function sameRead(a: readonly (readonly unknown[])[], b: readonly (readonly unknown[])[]): boolean {
    return (
        a.length === b.length && a.every((read, n) => read.every((value, k) => value === b[n]![k]))
    );
}

function readerOf(project: Project, map: ProjectMap): Reader {
    const read = project.tilesets.map(readOf);
    const known = reader;
    if (
        known &&
        known.tileWidth === map.tileWidth &&
        known.tileHeight === map.tileHeight &&
        sameRead(known.read, read)
    ) {
        return known;
    }
    const grid: ProjectMap = {
        ...map,
        width: 0,
        height: 0,
        backgroundColor: null,
        parallaxOriginX: 0,
        parallaxOriginY: 0,
        layers: [],
    };
    reader = {
        tileWidth: map.tileWidth,
        tileHeight: map.tileHeight,
        read,
        grid,
        compositor: new MapCompositor(project, grid),
    };
    return reader;
}

function stampLayer(stamp: Stamp): TileLayer {
    const layer = createTileLayer(1, "Stamp");
    for (let y = 0; y < stamp.height; y++) {
        for (let x = 0; x < stamp.width; x++) {
            const value = stamp.cells[y * stamp.width + x]!;
            if (value !== 0) layer.cells.set(x, y, value);
        }
    }
    return layer;
}

/** Puts the stamp of `shown` in its compositor's map; the compositor's reader. */
function show(shown: Source): Reader {
    const { grid } = shown.reader;
    grid.width = shown.stamp.width;
    grid.height = shown.stamp.height;
    if (grid.layers[0] !== shown.layer) grid.layers = [shown.layer];
    return shown.reader;
}

function sourceOf(project: Project, map: ProjectMap, stamp: Stamp): Source {
    const shared = readerOf(project, map);
    const known = source;
    if (known && known.stamp === stamp && known.reader === shared) return known;
    const layer = known?.stamp === stamp ? known.layer : stampLayer(stamp);
    source = { stamp, layer, reader: shared };
    return source;
}

/**
 * The stamp's picture fitted into `side × side` (the rail's preview, DESIGN §2), composited at
 * that size, nearest neighbour: the longer side `side`, the other in proportion, rounded and at
 * least 1. Pure: no DOM.
 */
export function stampThumbnail(
    project: Project,
    map: ProjectMap,
    stamp: Stamp,
    side: number,
): PixelBuffer {
    const pixelsX = stamp.width * map.tileWidth;
    const pixelsY = stamp.height * map.tileHeight;
    const scale = Math.min(side / pixelsX, side / pixelsY);
    const width = Math.min(side, Math.max(1, Math.round(pixelsX * scale)));
    const height = Math.min(side, Math.max(1, Math.round(pixelsY * scale)));
    return show(sourceOf(project, map, stamp)).compositor.composite({
        x: 0,
        y: 0,
        width,
        height,
        scaleX: { texels: width, pixels: pixelsX },
        scaleY: { texels: height, pixels: pixelsY },
        background: false,
    });
}

/**
 * Texels per cell of `cell` map pixels at `scale` device pixels per map pixel: one per map
 * pixel from a scale of 1 (drawn enlarged), else as many as the cell's whole device pixels.
 */
function texelsPerCell(scale: number, cell: number): number {
    return scale >= 1 ? cell : Math.max(1, Math.floor(scale * cell));
}

function pictureOf(project: Project, frame: OverlayFrame, stamp: Stamp): Picture {
    const { map, mapping } = frame;
    const known = sourceOf(project, map, stamp);
    const texelsX = texelsPerCell(mapping.scale, map.tileWidth);
    const texelsY = texelsPerCell(mapping.scale, map.tileHeight);
    if (picture?.source === known && picture.texelsX === texelsX && picture.texelsY === texelsY) {
        return picture;
    }
    const cellsX = Math.max(1, Math.floor(STAMP_CHUNK_TEXELS / texelsX));
    const cellsY = Math.max(1, Math.floor(STAMP_CHUNK_TEXELS / texelsY));
    picture = {
        source: known,
        texelsX,
        texelsY,
        cellsX,
        cellsY,
        columns: Math.ceil(stamp.width / cellsX),
        rows: Math.ceil(stamp.height / cellsY),
        chunks: new Map(),
    };
    return picture;
}

/** The cells of chunk `(column, row)` in the stamp. */
function chunkCells(shown: Picture, column: number, row: number): CellRect {
    const { stamp } = shown.source;
    const x = column * shown.cellsX;
    const y = row * shown.cellsY;
    return {
        x,
        y,
        width: Math.min(shown.cellsX, stamp.width - x),
        height: Math.min(shown.cellsY, stamp.height - y),
    };
}

function makeChunk(shown: Picture, column: number, row: number): HTMLCanvasElement {
    const { source: made, texelsX, texelsY } = shown;
    const { compositor, tileWidth, tileHeight } = show(made);
    const cells = chunkCells(shown, column, row);
    const image = compositor.composite({
        x: cells.x * texelsX,
        y: cells.y * texelsY,
        width: cells.width * texelsX,
        height: cells.height * texelsY,
        scaleX: { texels: texelsX, pixels: tileWidth },
        scaleY: { texels: texelsY, pixels: tileHeight },
        background: false,
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    canvas
        .getContext("2d")
        ?.putImageData(
            new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height),
            0,
            0,
        );
    return canvas;
}

function floorDiv(a: number, b: number): number {
    return Math.floor(a / b);
}

/** The part of `a` inside `b`; null when none of it is. */
function intersect(a: CellRect, b: CellRect): CellRect | null {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/** Calls `listener` when a preview was drawn without all of its chunks: it asks for a redraw. */
export function subscribeStampImage(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/**
 * Draws `stamp` on the overlay at the view's scale, tiled from each tiling's origin over the
 * part of its area in view and in the map, with the context's alpha and clip. Only the chunks
 * shown are composited; after the first, only for `STAMP_SLICE_MS`: a chunk not made by then is
 * left out, and the listeners (`subscribeStampImage`) are asked for the next redraw. The chunks
 * shown are kept with as many shown before; the others are dropped.
 */
export function drawStamp(
    frame: OverlayFrame,
    project: Project,
    stamp: Stamp,
    tilings: readonly StampTiling[],
): void {
    const { context, mapping, map, size } = frame;
    const shown = pictureOf(project, frame, stamp);
    const { chunks, columns, cellsX, cellsY, texelsX, texelsY } = shown;
    const deadline = performance.now() + STAMP_SLICE_MS;
    const used = new Set<number>();
    let made = 0;
    let missing = false;
    const chunk = (column: number, row: number): HTMLCanvasElement | null => {
        const key = row * columns + column;
        used.add(key);
        let canvas = chunks.get(key);
        if (canvas) {
            chunks.delete(key);
        } else {
            if (made > 0 && performance.now() > deadline) {
                missing = true;
                return null;
            }
            canvas = makeChunk(shown, column, row);
            made++;
        }
        chunks.set(key, canvas);
        return canvas;
    };

    const first = mapping.deviceToCell(0, 0);
    const last = mapping.deviceToCell(size.width, size.height);
    const view = {
        x: first.x,
        y: first.y,
        width: last.x - first.x + 1,
        height: last.y - first.y + 1,
    };
    const { width: w, height: h } = stamp;
    context.imageSmoothingEnabled = false;
    for (const { origin, area: wanted } of tilings) {
        const inMap = clipToMap(wanted, map);
        const area = inMap && intersect(inMap, view);
        if (!area) continue;
        // The stamps of the tiling that reach the area.
        const i0 = floorDiv(area.x - origin.x, w);
        const i1 = floorDiv(area.x + area.width - 1 - origin.x, w);
        const j0 = floorDiv(area.y - origin.y, h);
        const j1 = floorDiv(area.y + area.height - 1 - origin.y, h);
        if (shown.columns === 1 && shown.rows === 1 && (i1 > i0 || j1 > j0)) {
            // Several of a stamp in one chunk: that chunk as a pattern laid from the origin.
            const image = chunk(0, 0);
            const pattern = image && context.createPattern(image, "repeat");
            if (!pattern) continue;
            const start = mapping.cellToDevice(origin.x, origin.y);
            const step = mapping.cellToDevice(origin.x + 1, origin.y + 1);
            pattern.setTransform(
                new DOMMatrix([
                    (step.x - start.x) / texelsX,
                    0,
                    0,
                    (step.y - start.y) / texelsY,
                    start.x,
                    start.y,
                ]),
            );
            context.fillStyle = pattern;
            const device = cellDeviceRect(mapping, area);
            context.fillRect(device.x, device.y, device.width, device.height);
            continue;
        }
        for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
                const left = origin.x + i * w;
                const top = origin.y + j * h;
                const part = intersect(area, { x: left, y: top, width: w, height: h })!;
                const column0 = floorDiv(part.x - left, cellsX);
                const column1 = floorDiv(part.x + part.width - 1 - left, cellsX);
                const row0 = floorDiv(part.y - top, cellsY);
                const row1 = floorDiv(part.y + part.height - 1 - top, cellsY);
                for (let row = row0; row <= row1; row++) {
                    for (let column = column0; column <= column1; column++) {
                        const image = chunk(column, row);
                        if (!image) continue;
                        const cells = chunkCells(shown, column, row);
                        const device = cellDeviceRect(mapping, {
                            ...cells,
                            x: left + cells.x,
                            y: top + cells.y,
                        });
                        context.drawImage(image, device.x, device.y, device.width, device.height);
                    }
                }
            }
        }
    }

    for (const key of chunks.keys()) {
        if (chunks.size <= 2 * used.size) break;
        if (!used.has(key)) chunks.delete(key);
    }
    if (missing) listeners.forEach((listener) => listener());
}
