import type { CellStore } from "../cells";
import { drawnOpacity, effectiveValues, walkLayers } from "../model";
import type {
    ImageLayer,
    LayerHighlight,
    PixelBuffer,
    Project,
    ProjectMap,
    Tileset,
    TileLayer,
} from "../model";
import { BLEND_FUNCTIONS } from "../sprite/composite/blend";

// `core/compositor` (SPEC §1): a map's tile and image layers and its background colour as
// straight RGBA8. It is the pixel reference of the viewport and export tests (SPEC §10.3), so it
// places tiles from FORMAT §1.2 and §1.3 on its own: each output pixel asks which tile covers it
// and which texel of that tile lands there. It shares no code with `core/runtime/emit.ts`, which
// goes the other way (tile to quad).
//
// Sampling is nearest on a texel grid laid over the map: `scaleX` texels per `pixels` map pixels,
// likewise in y. Texel `i` samples the map pixel under its centre, `floor((i + ½) · pixels /
// texels)`, so any rectangle of the grid equals the same rectangle of a larger composite.

/** A scale as a ratio of integers, so texel to pixel mapping is exact. */
export interface Ratio {
    /** Texels of the output grid. */
    texels: number;
    /** Map pixels they span. */
    pixels: number;
}

/** One output texel per map pixel. */
export const UNIT_SCALE: Ratio = { texels: 1, pixels: 1 };

/** `texelsPerCell` texels over a cell of `cellSize` map pixels (the chunk tier's resolution). */
export function cellScale(texelsPerCell: number, cellSize: number): Ratio {
    return { texels: texelsPerCell, pixels: cellSize };
}

export interface CompositeRequest {
    /** The rectangle of the texel grid to produce; may reach outside the map (those texels show nothing but layers that extend there). */
    x: number;
    y: number;
    width: number;
    height: number;
    /** Default `UNIT_SCALE`. */
    scaleX?: Ratio;
    scaleY?: Ratio;
    /**
     * The centre of the view in map pixels (FORMAT §3.4). Layers shift by it according to their
     * parallax; without it parallax has no effect.
     */
    viewCentre?: { x: number; y: number };
    /** Only the layers with these IDs, if they are visible (a chunk set, ENGINE §4). */
    layerIds?: ReadonlySet<number>;
    /**
     * Composites in the layers' own space: neither offset nor parallax moves them, the caller
     * places the result (a chunk set, whose layers share both). `viewCentre` is then ignored.
     */
    layerSpace?: boolean;
    /** Starts from the map's background colour (the default) or from transparent black. */
    background?: boolean;
    /** Highlight Current Layer (SPEC §7.2): the other layers at its factor of their opacity. */
    highlight?: LayerHighlight | null;
}

/** Per-tileset data the sampling loop needs, read once. */
interface PreparedTileset {
    tileset: Tileset;
    /** Index in the project's list: the draw order within a layer (ENGINE §4). */
    order: number;
    /** Byte offset of each tile's top-left pixel in `tileset.pixels`, by tile ID; −1 for none. */
    origin: Int32Array;
    /** 1 for a tile whose every pixel is opaque, by tile ID. */
    opaque: Uint8Array;
}

/** Cells of a request hidden under an opaque tile of a higher layer (`hiddenCells`). */
interface Cover {
    /** For each cell of the range, row by row, the index of the highest covering layer; −1 none. */
    top: Int16Array;
    x0: number;
    y0: number;
    width: number;
}

/** Larger requests are composited without looking for covered cells first. */
const MAX_COVER_CELLS = 1 << 18;

const OPAQUE_MAX = 255;
/** No cell value has the reserved bit 28 set (FORMAT §1.2): marks a cell not read yet. */
const UNREAD = 0xffffffff;
/** Source-over of straight RGBA8, as NGNE draws a sprite (ENGINE §7). */
const BLEND = BLEND_FUNCTIONS.normal;

/**
 * For each orientation (FORMAT §1.2), the texel `(ta, tb)` of the tile that lands on the drawn
 * box's point `(a, b)`, both from the centre and doubled: `ta = m0·a + m1·b`, `tb = m2·a + m3·b`.
 * The cases of `blendTile` as a table.
 */
const ORIENTATION_MATRICES = Int8Array.of(
    ...[1, 0, 0, 1], // as drawn
    ...[0, 1, 1, 0], // D
    ...[1, 0, 0, -1], // V
    ...[0, -1, 1, 0], // V D
    ...[-1, 0, 0, 1], // H
    ...[0, 1, -1, 0], // H D
    ...[-1, 0, 0, -1], // H V
    ...[0, -1, -1, 0], // H V D
);

/** A layer to draw in a request, with the layer pixels its texels sample. */
interface Drawn {
    layer: TileLayer | ImageLayer;
    opacity: number;
    columns: Int32Array;
    rows: Int32Array;
    /** The layer's snapped shift, as text: layers with the same one sample the same pixels. */
    shift: string;
}

function floorDiv(a: number, b: number): number {
    return Math.floor(a / b);
}

function positive(ratio: Ratio, what: string): void {
    if (!Number.isInteger(ratio.texels) || !Number.isInteger(ratio.pixels)) {
        throw new RangeError(`${what} must be a ratio of integers.`);
    }
    if (ratio.texels < 1 || ratio.pixels < 1) {
        throw new RangeError(`${what} must be positive.`);
    }
}

/**
 * The shift of a layer in map pixels as `k / g` with integers `k` and `g` (FORMAT §3.4): the
 * layer's offset plus its parallax shift, rounded to whole texels when the output is a whole-number
 * enlargement of the map (a game at integer scale snaps sprite positions to its pixels), else to
 * whole map pixels.
 */
function snappedShift(shift: number, scale: Ratio): { k: number; g: number } {
    const g = scale.texels % scale.pixels === 0 ? scale.texels / scale.pixels : 1;
    return { k: Math.round(shift * g), g };
}

/**
 * For each output texel `start .. start + count − 1` of one axis, the layer's own pixel it
 * samples: the map pixel under the texel's centre, moved back by the shift `k / g`.
 */
function layerPixels(start: number, count: number, scale: Ratio, k: number, g: number): Int32Array {
    const out = new Int32Array(count);
    const { texels, pixels } = scale;
    for (let n = 0; n < count; n += 1) {
        out[n] = floorDiv((2 * (start + n) + 1) * pixels * g - 2 * k * texels, 2 * texels * g);
    }
    return out;
}

export class MapCompositor {
    private readonly sets: PreparedTileset[];
    /** `sets` index by slot, −1 for none. */
    private readonly bySlot = new Int16Array(256).fill(-1);
    private readonly images = new Map<string, PixelBuffer>();
    private readonly minOffsetX: number;
    private readonly maxOffsetX: number;
    private readonly minOffsetY: number;
    private readonly maxOffsetY: number;
    private readonly reach: number;
    /** No tile reaches past its cell: each layer pixel has one candidate cell at most. */
    private readonly disjoint: boolean;

    /**
     * The tilesets and images are read here once and not again: build a new compositor when one
     * changes. Layers, cells and map values are read at each call.
     */
    constructor(
        project: Project,
        private readonly map: ProjectMap,
    ) {
        this.sets = project.tilesets.map((tileset, order) => {
            let span = 0;
            for (const tile of tileset.tiles) span = Math.max(span, tile.id + 1);
            const origin = new Int32Array(span).fill(-1);
            const opaque = new Uint8Array(span);
            const { columns, tileWidth, tileHeight, pixels } = tileset;
            tileset.tiles.forEach((tile, index) => {
                const x = (index % columns) * tileWidth;
                const y = Math.floor(index / columns) * tileHeight;
                const at = (y * pixels.width + x) * 4;
                origin[tile.id] = at;
                let solid = 1;
                for (let row = 0; row < tileHeight && solid; row += 1) {
                    const start = at + row * pixels.width * 4;
                    for (let a = start + 3; a < start + tileWidth * 4; a += 4) {
                        if (pixels.data[a] !== OPAQUE_MAX) {
                            solid = 0;
                            break;
                        }
                    }
                }
                opaque[tile.id] = solid;
            });
            if (tileset.slot >= 1 && tileset.slot <= 255) this.bySlot[tileset.slot] = order;
            return { tileset, order, origin, opaque };
        });
        for (const image of project.images) this.images.set(image.id, image.pixels);

        let minX = 0;
        let maxX = 0;
        let minY = 0;
        let maxY = 0;
        let reach = 1;
        for (const { tileset } of this.sets) {
            minX = Math.min(minX, tileset.offsetX);
            maxX = Math.max(maxX, tileset.offsetX);
            minY = Math.min(minY, tileset.offsetY);
            maxY = Math.max(maxY, tileset.offsetY);
            reach = Math.max(reach, tileset.tileWidth, tileset.tileHeight);
        }
        this.minOffsetX = minX;
        this.maxOffsetX = maxX;
        this.minOffsetY = minY;
        this.maxOffsetY = maxY;
        this.reach = reach;
        const cell = Math.min(map.tileWidth, map.tileHeight);
        this.disjoint = this.sets.every(
            ({ tileset }) =>
                tileset.offsetX === 0 &&
                tileset.offsetY === 0 &&
                Math.max(tileset.tileWidth, tileset.tileHeight) <= cell,
        );
    }

    /**
     * Composites the requested rectangle: the background colour, then the visible tile and image
     * layers bottom to top, each source-over with its effective opacity. Into `target` when
     * given (it must be `width × height` and is overwritten), else into a new buffer.
     */
    composite(request: CompositeRequest, target?: PixelBuffer): PixelBuffer {
        const { x, y, width, height } = request;
        for (const value of [x, y, width, height]) {
            if (!Number.isInteger(value)) throw new RangeError("The rectangle must be integers.");
        }
        if (width < 0 || height < 0) throw new RangeError("The rectangle must not be negative.");
        const scaleX = request.scaleX ?? UNIT_SCALE;
        const scaleY = request.scaleY ?? UNIT_SCALE;
        positive(scaleX, "scaleX");
        positive(scaleY, "scaleY");

        const out = target ?? { width, height, data: new Uint8ClampedArray(width * height * 4) };
        if (out.width !== width || out.height !== height) {
            throw new RangeError(
                `Target is ${out.width}x${out.height}, the rectangle ${width}x${height}.`,
            );
        }
        fillBackground(out.data, request.background === false ? null : this.map.backgroundColor);

        const { map } = this;
        const { layerIds, layerSpace = false } = request;
        const drawn: Drawn[] = [];
        for (const { layer, ancestors } of walkLayers(map.layers)) {
            if (layer.type !== "tile" && layer.type !== "image") continue;
            if (layerIds !== undefined && !layerIds.has(layer.id)) continue;
            const values = effectiveValues(layer, ancestors);
            const opacity = drawnOpacity(layer, ancestors, values, request.highlight);
            if (!values.visible || opacity === 0) continue;

            const view = layerSpace ? undefined : request.viewCentre;
            const shiftX = layerSpace
                ? 0
                : values.offsetX +
                  (view ? (view.x - map.parallaxOriginX) * (1 - values.parallaxX) : 0);
            const shiftY = layerSpace
                ? 0
                : values.offsetY +
                  (view ? (view.y - map.parallaxOriginY) * (1 - values.parallaxY) : 0);
            const sx = snappedShift(shiftX, scaleX);
            const sy = snappedShift(shiftY, scaleY);
            drawn.push({
                layer,
                opacity,
                columns: layerPixels(x, width, scaleX, sx.k, sx.g),
                rows: layerPixels(y, height, scaleY, sy.k, sy.g),
                shift: `${sx.k}/${sx.g},${sy.k}/${sy.g}`,
            });
        }
        const cover = this.hiddenCells(drawn);
        drawn.forEach(({ layer, opacity, columns, rows }, index) => {
            if (layer.type === "image") this.drawImageLayer(out, layer, columns, rows, opacity);
            else if (this.disjoint) {
                this.drawDisjointTileLayer(out, layer, columns, rows, opacity, cover, index);
            } else this.drawTileLayer(out, layer, columns, rows, opacity);
        });
        return out;
    }

    /**
     * The cells whose pixels a higher layer hides: each covered by a tile of exactly the cell's
     * size whose every pixel is opaque, in a layer at full opacity. Blending onto an opaque pixel
     * at full opacity replaces it (blend.ts), so the layers under such a cell cannot change it and
     * are skipped there: the result is the same. Only for tile layers that cannot reach past their
     * cells (`disjoint`) and share one shift, so a texel's cell is the same in every layer; null
     * otherwise.
     */
    private hiddenCells(drawn: readonly Drawn[]): Cover | null {
        const first = drawn[0];
        if (!this.disjoint || first === undefined || drawn.length < 2) return null;
        if (drawn.some((entry) => entry.layer.type !== "tile" || entry.shift !== first.shift)) {
            return null;
        }
        const { width: cols, height: lines, tileWidth: gw, tileHeight: gh } = this.map;
        const range = (pixels: Int32Array, grid: number, cells: number) => {
            if (pixels.length === 0) return null;
            const from = Math.max(0, floorDiv(pixels[0]!, grid));
            const to = Math.min(cells - 1, floorDiv(pixels[pixels.length - 1]!, grid));
            return from <= to ? [from, to] : null;
        };
        const xs = range(first.columns, gw, cols);
        const ys = range(first.rows, gh, lines);
        if (!xs || !ys) return null;
        const width = xs[1]! - xs[0]! + 1;
        const height = ys[1]! - ys[0]! + 1;
        if (width * height > MAX_COVER_CELLS) return null;
        const top = new Int16Array(width * height).fill(-1);
        let open = top.length;
        for (let index = drawn.length - 1; index >= 1 && open > 0; index -= 1) {
            const { layer, opacity } = drawn[index]!;
            if (opacity !== OPAQUE_MAX || layer.type !== "tile") continue;
            for (let cy = 0; cy < height; cy += 1) {
                for (let cx = 0; cx < width; cx += 1) {
                    const at = cy * width + cx;
                    if (top[at] !== -1) continue;
                    const value = layer.cells.get(cx + xs[0]!, cy + ys[0]!);
                    if (value !== 0 && this.covers(value)) {
                        top[at] = index;
                        open -= 1;
                    }
                }
            }
        }
        return { top, x0: xs[0]!, y0: ys[0]!, width };
    }

    /** A cell value whose tile fills its cell with opaque pixels. */
    private covers(value: number): boolean {
        const order = this.bySlot[(value >>> 20) & 255]!;
        if (order < 0) return false;
        const set = this.sets[order]!;
        const tileId = value & 0xfffff;
        if (tileId >= set.opaque.length || set.opaque[tileId] !== 1) return false;
        const { tileWidth, tileHeight } = set.tileset;
        const swapped = ((value >>> 29) & 1) !== 0;
        const boxW = swapped ? tileHeight : tileWidth;
        const boxH = swapped ? tileWidth : tileHeight;
        return boxW === this.map.tileWidth && boxH === this.map.tileHeight;
    }

    private drawImageLayer(
        out: PixelBuffer,
        layer: ImageLayer,
        columns: Int32Array,
        rows: Int32Array,
        opacity: number,
    ): void {
        const image = this.images.get(layer.imageId);
        if (image === undefined) return;
        const { width: iw, height: ih, data: source } = image;
        for (let j = 0; j < rows.length; j += 1) {
            let iy = rows[j]!;
            if (layer.repeatY) iy = ((iy % ih) + ih) % ih;
            else if (iy < 0 || iy >= ih) continue;
            for (let i = 0; i < columns.length; i += 1) {
                let ix = columns[i]!;
                if (layer.repeatX) ix = ((ix % iw) + iw) % iw;
                else if (ix < 0 || ix >= iw) continue;
                BLEND(out.data, (j * out.width + i) * 4, source, (iy * iw + ix) * 4, 1, opacity);
            }
        }
    }

    /**
     * `drawTileLayer` when no tile reaches past its cell (`disjoint`): the one candidate of a layer
     * pixel is the cell under it, so there is no draw order to keep and no search. The same
     * pixels as `drawTileLayer`, faster: the chunk tier composites whole maps with it (ENGINE §4).
     */
    private drawDisjointTileLayer(
        out: PixelBuffer,
        layer: TileLayer,
        columns: Int32Array,
        rows: Int32Array,
        opacity: number,
        cover: Cover | null,
        index: number,
    ): void {
        const { width: cols, height: lines, tileWidth: gw, tileHeight: gh } = this.map;
        const cells: CellStore = layer.cells;
        if (this.sets.length === 0 || cells.count === 0) return;

        // The cell of each output column (−1 outside the map) and the pixel's x in it.
        const cellX = new Int32Array(columns.length);
        const inX = new Int32Array(columns.length);
        let minX = Infinity;
        let maxX = -Infinity;
        for (let i = 0; i < columns.length; i += 1) {
            const lx = columns[i]!;
            const cx = floorDiv(lx, gw);
            inX[i] = lx - cx * gw;
            cellX[i] = cx >= 0 && cx < cols ? cx : -1;
            if (cellX[i]! >= 0) {
                minX = Math.min(minX, cx);
                maxX = Math.max(maxX, cx);
            }
        }
        if (minX > maxX) return;
        // The cells of the current cell row, read on first use.
        const row = new Uint32Array(maxX - minX + 1);
        let rowY = -1;
        const data = out.data;

        for (let j = 0; j < rows.length; j += 1) {
            const ly = rows[j]!;
            const cy = floorDiv(ly, gh);
            if (cy < 0 || cy >= lines) continue;
            if (cy !== rowY) {
                row.fill(UNREAD);
                rowY = cy;
            }
            const dy = ly - (cy + 1) * gh;
            // Where a higher layer hides this row's cells (`hiddenCells`).
            const hidden = cover ? (cy - cover.y0) * cover.width - cover.x0 : 0;
            // The tile of the last cell, as `blendTile` reads it; neighbouring texels share it.
            let last = 0;
            let source: Uint8ClampedArray | null = null;
            let origin = -1;
            let stride = 0;
            let tw = 0;
            let th = 0;
            let boxW = 0;
            let boxH = 0;
            let m0 = 1;
            let m1 = 0;
            let m2 = 0;
            let m3 = 1;
            for (let i = 0; i < columns.length; i += 1) {
                const cx = cellX[i]!;
                if (cx < 0) continue;
                if (cover && cover.top[hidden + cx]! > index) continue;
                let value = row[cx - minX]!;
                if (value === UNREAD) {
                    value = cells.get(cx, cy);
                    row[cx - minX] = value;
                }
                if (value === 0) continue;
                if (value !== last) {
                    last = value;
                    source = null;
                    const order = this.bySlot[(value >>> 20) & 255]!;
                    if (order < 0) continue;
                    const set = this.sets[order]!;
                    const tileId = value & 0xfffff;
                    origin = tileId < set.origin.length ? set.origin[tileId]! : -1;
                    if (origin < 0) continue;
                    const { tileset } = set;
                    source = tileset.pixels.data;
                    stride = tileset.pixels.width * 4;
                    tw = tileset.tileWidth;
                    th = tileset.tileHeight;
                    const orientation = value >>> 29;
                    const swapped = (orientation & 1) !== 0;
                    boxW = swapped ? th : tw;
                    boxH = swapped ? tw : th;
                    m0 = ORIENTATION_MATRICES[orientation * 4]!;
                    m1 = ORIENTATION_MATRICES[orientation * 4 + 1]!;
                    m2 = ORIENTATION_MATRICES[orientation * 4 + 2]!;
                    m3 = ORIENTATION_MATRICES[orientation * 4 + 3]!;
                }
                if (source === null) continue;
                // As in `blendTile`, with no tile offset.
                const u = inX[i]!;
                const v = dy + boxH;
                if (u >= boxW || v < 0) continue;
                const a = 2 * u + 1 - boxW;
                const b = 2 * v + 1 - boxH;
                const column = (m0 * a + m1 * b + tw) >> 1;
                const line = (m2 * a + m3 * b + th) >> 1;
                const at = origin + line * stride + column * 4;
                const target = (j * out.width + i) * 4;
                if (opacity === OPAQUE_MAX && source[at + 3] === OPAQUE_MAX) {
                    data[target] = source[at]!;
                    data[target + 1] = source[at + 1]!;
                    data[target + 2] = source[at + 2]!;
                    data[target + 3] = OPAQUE_MAX;
                } else {
                    BLEND(data, target, source, at, 1, opacity);
                }
            }
        }
    }

    private drawTileLayer(
        out: PixelBuffer,
        layer: TileLayer,
        columns: Int32Array,
        rows: Int32Array,
        opacity: number,
    ): void {
        const { width: cols, height: lines, tileWidth: gw, tileHeight: gh } = this.map;
        const cells: CellStore = layer.cells;
        if (this.sets.length === 0 || cells.count === 0) return;
        const { reach, minOffsetX, maxOffsetX, minOffsetY, maxOffsetY } = this;

        // Candidate cells of one texel: a tile reaches `reach` pixels from its cell's corner in
        // x (to the right) and y (upward), moved by its tileset's offset.
        const spanX = Math.floor((reach + maxOffsetX - minOffsetX) / gw) + 2;
        const spanY = Math.floor((reach + maxOffsetY - minOffsetY) / gh) + 2;
        const capacity = spanX * spanY;
        const hitOrder = new Int32Array(capacity);
        const hitValue = new Uint32Array(capacity);
        const hitX = new Int32Array(capacity);
        const hitY = new Int32Array(capacity);

        // The candidate columns of each output column, and the cells read so far: rows of cell
        // values over all candidate columns, read on first use and dropped once the output rows
        // (which only move down) are past them.
        const firstX = new Int32Array(columns.length);
        const lastX = new Int32Array(columns.length);
        let minX = Infinity;
        let maxX = -Infinity;
        for (let i = 0; i < columns.length; i += 1) {
            const lx = columns[i]!;
            firstX[i] = Math.max(0, floorDiv(lx - maxOffsetX - reach, gw) + 1);
            lastX[i] = Math.min(cols - 1, floorDiv(lx - minOffsetX, gw));
            if (firstX[i]! <= lastX[i]!) {
                minX = Math.min(minX, firstX[i]!);
                maxX = Math.max(maxX, lastX[i]!);
            }
        }
        if (minX > maxX) return;
        const rowCache = new Map<number, Uint32Array>();
        const cellRow = (cy: number): Uint32Array => {
            let row = rowCache.get(cy);
            if (row === undefined) {
                row = new Uint32Array(maxX - minX + 1).fill(UNREAD);
                rowCache.set(cy, row);
            }
            return row;
        };

        for (let j = 0; j < rows.length; j += 1) {
            const ly = rows[j]!;
            const cy0 = Math.max(0, floorDiv(ly - maxOffsetY, gh));
            const cy1 = Math.min(lines - 1, floorDiv(ly - minOffsetY + reach, gh) - 1);
            if (cy0 > cy1) continue;
            for (const cy of rowCache.keys()) if (cy < cy0) rowCache.delete(cy);
            for (let i = 0; i < columns.length; i += 1) {
                const lx = columns[i]!;
                const cx0 = firstX[i]!;
                const cx1 = lastX[i]!;
                let hits = 0;
                for (let cy = cy0; cy <= cy1; cy += 1) {
                    const row = cellRow(cy);
                    for (let cx = cx0; cx <= cx1; cx += 1) {
                        let value = row[cx - minX]!;
                        if (value === UNREAD) {
                            value = cells.get(cx, cy);
                            row[cx - minX] = value;
                        }
                        if (value === 0) continue;
                        const order = this.bySlot[(value >>> 20) & 255]!;
                        if (order < 0) continue;
                        // Insertion by tileset order, after equals: row-major inside a tileset.
                        let at = hits;
                        while (at > 0 && hitOrder[at - 1]! > order) {
                            hitOrder[at] = hitOrder[at - 1]!;
                            hitValue[at] = hitValue[at - 1]!;
                            hitX[at] = hitX[at - 1]!;
                            hitY[at] = hitY[at - 1]!;
                            at -= 1;
                        }
                        hitOrder[at] = order;
                        hitValue[at] = value;
                        hitX[at] = cx;
                        hitY[at] = cy;
                        hits += 1;
                    }
                }
                const target = (j * out.width + i) * 4;
                for (let h = 0; h < hits; h += 1) {
                    const left = hitX[h]! * gw;
                    const bottom = (hitY[h]! + 1) * gh;
                    this.blendTile(
                        out.data,
                        target,
                        opacity,
                        hitOrder[h]!,
                        hitValue[h]!,
                        lx - left,
                        ly - bottom,
                    );
                }
            }
        }
    }

    /**
     * Blends the texel of a tile that lands on a layer pixel, if any. The pixel is given from
     * the bottom-left corner `B` of the tile's cell (FORMAT §1.3), `dx` right and `dy` down.
     */
    private blendTile(
        data: Uint8ClampedArray,
        target: number,
        opacity: number,
        order: number,
        value: number,
        dx: number,
        dy: number,
    ): void {
        const set = this.sets[order]!;
        const { tileset } = set;
        const tileId = value & 0xfffff;
        const origin = tileId < set.origin.length ? set.origin[tileId]! : -1;
        if (origin < 0) return;

        // FORMAT §1.3: the tile as drawn, `boxW × boxH`, has its bottom-left corner on the cell's
        // bottom-left corner moved by the tile offset.
        const tw = tileset.tileWidth;
        const th = tileset.tileHeight;
        const orientation = value >>> 29;
        const swapped = (orientation & 1) !== 0;
        const boxW = swapped ? th : tw;
        const boxH = swapped ? tw : th;
        const u = dx - tileset.offsetX;
        const v = dy - tileset.offsetY + boxH;
        if (u < 0 || v < 0 || u >= boxW || v >= boxH) return;

        // The pixel's centre from the box's centre, doubled to stay whole, then the texel that
        // FORMAT §1.2's last column sends there (inverted).
        const a = 2 * u + 1 - boxW;
        const b = 2 * v + 1 - boxH;
        let ta: number;
        let tb: number;
        switch (orientation) {
            case 0: // as drawn
                ta = a;
                tb = b;
                break;
            case 4: // H
                ta = -a;
                tb = b;
                break;
            case 2: // V
                ta = a;
                tb = -b;
                break;
            case 6: // H V
                ta = -a;
                tb = -b;
                break;
            case 5: // H D: rotated 90° clockwise
                ta = b;
                tb = -a;
                break;
            case 3: // V D: rotated 90° counter-clockwise
                ta = -b;
                tb = a;
                break;
            case 1: // D: flipped over the main diagonal
                ta = b;
                tb = a;
                break;
            default: // H V D: flipped over the anti-diagonal
                ta = -b;
                tb = -a;
                break;
        }
        const column = (ta + tw) >> 1;
        const line = (tb + th) >> 1;
        const { pixels } = tileset;
        const source = pixels.data;
        const at = origin + (line * pixels.width + column) * 4;
        // The opaque source over an opaque layer: `BLEND` would copy it (blend.ts, rule 3 with
        // a = 255); copied here without the call, the common case of a chunk.
        if (opacity === OPAQUE_MAX && source[at + 3] === OPAQUE_MAX) {
            data[target] = source[at]!;
            data[target + 1] = source[at + 1]!;
            data[target + 2] = source[at + 2]!;
            data[target + 3] = OPAQUE_MAX;
            return;
        }
        BLEND(data, target, source, at, 1, opacity);
    }
}

/** Fills with the background colour `0xRRGGBBAA`, or with nothing. Colour under alpha 0 is 0. */
function fillBackground(data: Uint8ClampedArray, color: number | null): void {
    data.fill(0);
    if (color === null) return;
    const alpha = color & 255;
    if (alpha === 0) return;
    const r = (color >>> 24) & 255;
    const g = (color >>> 16) & 255;
    const b = (color >>> 8) & 255;
    for (let i = 0; i < data.length; i += 4) {
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = alpha;
    }
}

/** One composite of `request` without keeping a compositor. */
export function compositeMap(
    project: Project,
    map: ProjectMap,
    request: CompositeRequest,
): PixelBuffer {
    return new MapCompositor(project, map).composite(request);
}
