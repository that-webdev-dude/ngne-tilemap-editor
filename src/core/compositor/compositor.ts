import type { CellStore } from "../cells";
import { effectiveValues, walkLayers } from "../model";
import type { ImageLayer, PixelBuffer, Project, ProjectMap, Tileset, TileLayer } from "../model";
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
}

/** Per-tileset data the sampling loop needs, read once. */
interface PreparedTileset {
    tileset: Tileset;
    /** Index in the project's list: the draw order within a layer (ENGINE §4). */
    order: number;
    /** Index in `tileset.tiles` by tile ID, −1 for none. */
    indexOf: Int32Array;
}

const OPAQUE_MAX = 255;
/** Source-over of straight RGBA8, as NGNE draws a sprite (ENGINE §7). */
const BLEND = BLEND_FUNCTIONS.normal;

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
            const indexOf = new Int32Array(span).fill(-1);
            tileset.tiles.forEach((tile, index) => {
                indexOf[tile.id] = index;
            });
            if (tileset.slot >= 1 && tileset.slot <= 255) this.bySlot[tileset.slot] = order;
            return { tileset, order, indexOf };
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
        fillBackground(out.data, this.map.backgroundColor);

        const { map } = this;
        for (const { layer, ancestors } of walkLayers(map.layers)) {
            if (layer.type !== "tile" && layer.type !== "image") continue;
            const values = effectiveValues(layer, ancestors);
            const opacity = Math.max(0, Math.min(OPAQUE_MAX, Math.round(values.opacity)));
            if (!values.visible || opacity === 0) continue;

            const view = request.viewCentre;
            const shiftX =
                values.offsetX +
                (view ? (view.x - map.parallaxOriginX) * (1 - values.parallaxX) : 0);
            const shiftY =
                values.offsetY +
                (view ? (view.y - map.parallaxOriginY) * (1 - values.parallaxY) : 0);
            const sx = snappedShift(shiftX, scaleX);
            const sy = snappedShift(shiftY, scaleY);
            const columns = layerPixels(x, width, scaleX, sx.k, sx.g);
            const rows = layerPixels(y, height, scaleY, sy.k, sy.g);
            if (layer.type === "tile") this.drawTileLayer(out, layer, columns, rows, opacity);
            else this.drawImageLayer(out, layer, columns, rows, opacity);
        }
        return out;
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

        for (let j = 0; j < rows.length; j += 1) {
            const ly = rows[j]!;
            const cy0 = Math.max(0, floorDiv(ly - maxOffsetY, gh));
            const cy1 = Math.min(lines - 1, floorDiv(ly - minOffsetY + reach, gh) - 1);
            if (cy0 > cy1) continue;
            for (let i = 0; i < columns.length; i += 1) {
                const lx = columns[i]!;
                const cx0 = Math.max(0, floorDiv(lx - maxOffsetX - reach, gw) + 1);
                const cx1 = Math.min(cols - 1, floorDiv(lx - minOffsetX, gw));
                let hits = 0;
                for (let cy = cy0; cy <= cy1; cy += 1) {
                    for (let cx = cx0; cx <= cx1; cx += 1) {
                        const value = cells.get(cx, cy);
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
        const index = tileId < set.indexOf.length ? set.indexOf[tileId]! : -1;
        if (index < 0) return;

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
        const { pixels, columns } = tileset;
        const px = (index % columns) * tw + column;
        const py = Math.floor(index / columns) * th + line;
        BLEND(data, target, pixels.data, (py * pixels.width + px) * 4, 1, opacity);
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
