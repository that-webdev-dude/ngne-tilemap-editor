import { CHUNK_SIZE } from "../../core/cells";
import type { CellRect } from "../../core/cells";
import { effectiveValues, walkLayers } from "../../core/model";
import type { Project, ProjectMap, TileLayer } from "../../core/model";
import type { Camera2D, DeviceSize } from "./geometry";
import { layerShift, visibleRect } from "./geometry";

// The plan of the chunk tier (ENGINE §4): which layers share a chunk set, the resolution T, the
// chunks each set needs and when the viewport changes tier. Pure arithmetic over the document:
// no DOM and no NGNE.

/** The live tier draws up to this many visible cells (ENGINE §4, S1). */
export const LIVE_LIMIT = 65_536;
/** Back in the live tier at this count or below: 90% of the limit, so a pan does not flip tiers. */
export const LIVE_RETURN = 58_982;
/** Chunk GPU memory the resolution is reduced to fit (ENGINE §4, §6). */
export const CHUNK_MEMORY_LIMIT = 64 * 1024 * 1024;
/** WebGPU's default `maxTextureDimension2D`: a chunk texture is `CHUNK_SIZE × T` on a side. */
const MAX_TEXTURE_SIDE = 8192;
const BYTES_PER_TEXEL = 4;

export type Tier = "live" | "chunk";

/** Where a chunk set's layers are drawn: the parallax and offset they share. */
export interface SetPlacement {
    parallaxX: number;
    parallaxY: number;
    offsetX: number;
    offsetY: number;
}

/**
 * Visible tile layers drawn as one flattened image (ENGINE §4): a run of consecutive layers,
 * bottom to top, that share parallax and offset. A layer with its own parallax or offset, or a
 * visible image layer in between, starts another run, so the sets keep the layers' order.
 */
export interface ChunkSetPlan {
    /** The bottom layer's ID: chunk textures are `ed:chunk:<key>:<cx>:<cy>` (ENGINE §3). */
    key: number;
    layerIds: number[];
    placement: SetPlacement;
    /**
     * What the set's pixels depend on besides cells and tilesets: its layers and their
     * opacities. Placement is not part of it: chunks are composited in the layers' own space.
     */
    content: string;
}

/** The chunk sets of the map's visible tile layers, bottom to top. */
export function planSets(map: ProjectMap): ChunkSetPlan[] {
    const sets: ChunkSetPlan[] = [];
    let open: ChunkSetPlan | null = null;
    const opacities: string[] = [];
    const close = () => {
        if (open) open.content = `${open.layerIds.join(",")}|${opacities.join(",")}`;
        open = null;
        opacities.length = 0;
    };
    for (const { layer, ancestors } of walkLayers(map.layers)) {
        if (layer.type !== "tile" && layer.type !== "image") continue;
        const values = effectiveValues(layer, ancestors);
        const opacity = Math.max(0, Math.min(255, Math.round(values.opacity)));
        if (!values.visible || opacity === 0) continue;
        if (layer.type === "image") {
            close();
            continue;
        }
        const placement: SetPlacement = {
            parallaxX: values.parallaxX,
            parallaxY: values.parallaxY,
            offsetX: values.offsetX,
            offsetY: values.offsetY,
        };
        const current: ChunkSetPlan | null = open;
        if (current === null || !samePlacement(current.placement, placement)) {
            close();
            const created: ChunkSetPlan = { key: layer.id, layerIds: [], placement, content: "" };
            sets.push(created);
            open = created;
        }
        open!.layerIds.push(layer.id);
        opacities.push(String(opacity));
    }
    close();
    return sets;
}

function samePlacement(a: SetPlacement, b: SetPlacement): boolean {
    return (
        a.parallaxX === b.parallaxX &&
        a.parallaxY === b.parallaxY &&
        a.offsetX === b.offsetX &&
        a.offsetY === b.offsetY
    );
}

/** The tile layers of the map with these IDs, in tree order. */
export function tileLayersOf(map: ProjectMap, ids: readonly number[]): TileLayer[] {
    const wanted = new Set(ids);
    const layers: TileLayer[] = [];
    for (const { layer } of walkLayers(map.layers)) {
        if (layer.type === "tile" && wanted.has(layer.id)) layers.push(layer);
    }
    return layers;
}

/** Non-empty cells of the visible tile layers, the chunk sets' layers. */
export function visibleCells(map: ProjectMap, sets: readonly ChunkSetPlan[]): number {
    let total = 0;
    for (const set of sets) {
        for (const layer of tileLayersOf(map, set.layerIds)) total += layer.cells.count;
    }
    return total;
}

/**
 * How far, in cells, the tiles of the project's tilesets reach past their own cell on each
 * side (FORMAT §1.3: a tile grows up and to the right from its cell's bottom-left corner and
 * moves by its tileset's offset). A change of a cell can change the pixels of cells this far
 * away, and a chunk shows tiles of cells this far outside it.
 */
export interface Reach {
    left: number;
    right: number;
    up: number;
    down: number;
}

export function tileReach(project: Project, map: ProjectMap): Reach {
    const reach: Reach = { left: 0, right: 0, up: 0, down: 0 };
    const { tileWidth: gw, tileHeight: gh } = map;
    for (const tileset of project.tilesets) {
        const side = Math.max(tileset.tileWidth, tileset.tileHeight);
        reach.left = Math.max(reach.left, Math.ceil(-tileset.offsetX / gw));
        reach.right = Math.max(reach.right, Math.ceil((side - gw + tileset.offsetX) / gw));
        reach.up = Math.max(reach.up, Math.ceil((side - gh - tileset.offsetY) / gh));
        reach.down = Math.max(reach.down, Math.ceil(tileset.offsetY / gh));
    }
    return reach;
}

/** The cells whose pixels a change of `rect` can alter: `rect` grown by the tiles' reach. */
export function grow(rect: CellRect, reach: Reach): CellRect {
    return {
        x: rect.x - reach.left,
        y: rect.y - reach.up,
        width: rect.width + reach.left + reach.right,
        height: rect.height + reach.up + reach.down,
    };
}

/** A chunk of a set: chunk coordinates in the layers' own space. */
export interface ChunkCoord {
    cx: number;
    cy: number;
}

/**
 * The chunks of a set that show something: the map's chunks, and those around it that tiles
 * reach into, holding a non-empty cell of the set's layers within the tiles' reach.
 */
export function neededChunks(map: ProjectMap, set: ChunkSetPlan, reach: Reach): ChunkCoord[] {
    const layers = tileLayersOf(map, set.layerIds);
    // `0 -` keeps the first chunk at 0 and not −0 with no reach.
    const cx0 = 0 - Math.ceil(reach.left / CHUNK_SIZE);
    const cy0 = 0 - Math.ceil(reach.up / CHUNK_SIZE);
    const cx1 = Math.floor((map.width - 1 + reach.right) / CHUNK_SIZE);
    const cy1 = Math.floor((map.height - 1 + reach.down) / CHUNK_SIZE);
    const chunks: ChunkCoord[] = [];
    for (let cy = cy0; cy <= cy1; cy += 1) {
        for (let cx = cx0; cx <= cx1; cx += 1) {
            if (chunkShows(map, layers, reach, cx, cy)) chunks.push({ cx, cy });
        }
    }
    return chunks;
}

/**
 * The chunk `cx, cy` of a set of `layers` shows something: a cell-store chunk holding a cell
 * whose tile can land in it, inside the map, is not empty. O(chunks), no cell scan.
 */
export function chunkShows(
    map: ProjectMap,
    layers: readonly TileLayer[],
    reach: Reach,
    cx: number,
    cy: number,
): boolean {
    // The cells whose tiles can land in this chunk, inside the map.
    const around = clipToMap(map, {
        x: cx * CHUNK_SIZE - reach.right,
        y: cy * CHUNK_SIZE - reach.down,
        width: CHUNK_SIZE + reach.left + reach.right,
        height: CHUNK_SIZE + reach.up + reach.down,
    });
    return around !== null && layers.some((layer) => layer.cells.countUpperBound(around) > 0);
}

/** The part of `rect` inside the map; null when none. */
export function clipToMap(map: ProjectMap, rect: CellRect): CellRect | null {
    const x0 = Math.max(0, rect.x);
    const y0 = Math.max(0, rect.y);
    const x1 = Math.min(map.width, rect.x + rect.width);
    const y1 = Math.min(map.height, rect.y + rect.height);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/** GPU bytes of `chunks` chunk textures at `texelsPerCell`. */
export function chunkBytes(chunks: number, texelsPerCell: number): number {
    const side = CHUNK_SIZE * texelsPerCell;
    return chunks * side * side * BYTES_PER_TEXEL;
}

/**
 * The resolution T of the chunk tier (ENGINE §4): the largest power of two at most the device
 * pixels per cell at the switch zoom, reduced until `chunks` chunk textures fit
 * `CHUNK_MEMORY_LIMIT`; null when not even one texel per cell fits.
 *
 * The switch zoom is where the view of `size` device pixels holds `LIVE_LIMIT` of the map's
 * `cells` visible non-empty cells, taken as spread evenly over the map's area.
 */
export function chooseResolution(
    map: ProjectMap,
    cells: number,
    chunks: number,
    size: DeviceSize,
): number | null {
    const density = cells / (map.width * map.height);
    // cells in view = (W / (s·gw)) · (H / (s·gh)) · density = LIVE_LIMIT, solved for s.
    const scale = Math.sqrt(
        (size.width * size.height * density) / (LIVE_LIMIT * map.tileWidth * map.tileHeight),
    );
    const perCell = scale * Math.min(map.tileWidth, map.tileHeight);
    let texels = 1;
    while (texels * 2 <= perCell && CHUNK_SIZE * texels * 2 <= MAX_TEXTURE_SIDE) texels *= 2;
    while (texels > 1 && chunkBytes(chunks, texels) > CHUNK_MEMORY_LIMIT) texels /= 2;
    return chunkBytes(chunks, texels) <= CHUNK_MEMORY_LIMIT ? texels : null;
}

/**
 * The visible count of the tier choice (ENGINE §4): over the visible tile layers, each cell-store
 * chunk the view touches adds its non-empty count times the share of the chunk the view
 * covers, in the layer's own space. O(chunks), no cell scan; exact for evenly filled chunks.
 *
 * The share keeps the count continuous as the view moves: the whole counts of touched chunks
 * jump by a column or row of chunks when an edge of the view crosses one, which at the
 * threshold is more than the 10% between `LIVE_LIMIT` and `LIVE_RETURN`, so a pan would flip
 * tiers at each chunk boundary.
 */
export function visibleCount(
    map: ProjectMap,
    sets: readonly ChunkSetPlan[],
    camera: Camera2D,
    size: DeviceSize,
): number {
    const view = visibleRect(camera, size);
    const { tileWidth: gw, tileHeight: gh } = map;
    let count = 0;
    for (const set of sets) {
        const shift = layerShift(map, camera, set.placement);
        // The view in the layer's cells, fractional.
        const x0 = (view.x - shift.x) / gw;
        const y0 = (view.y - shift.y) / gh;
        const x1 = x0 + view.width / gw;
        const y1 = y0 + view.height / gh;
        const rect = clipToMap(map, {
            x: Math.floor(x0),
            y: Math.floor(y0),
            width: Math.ceil(x1) - Math.floor(x0),
            height: Math.ceil(y1) - Math.floor(y0),
        });
        if (!rect) continue;
        for (const layer of tileLayersOf(map, set.layerIds)) {
            for (const chunk of layer.cells.chunksIn(rect)) {
                const left = chunk.cx * CHUNK_SIZE;
                const top = chunk.cy * CHUNK_SIZE;
                const w = Math.min(x1, left + CHUNK_SIZE) - Math.max(x0, left);
                const h = Math.min(y1, top + CHUNK_SIZE) - Math.max(y0, top);
                if (w > 0 && h > 0) count += (chunk.count * w * h) / (CHUNK_SIZE * CHUNK_SIZE);
            }
        }
    }
    return count;
}

/**
 * The tier for the next frame (ENGINE §4): the chunk tier above `LIVE_LIMIT` once it is built,
 * the live tier at `LIVE_RETURN` or below; in between the current one stays.
 */
export function nextTier(current: Tier, count: number, built: boolean): Tier {
    if (!built) return "live";
    if (count > LIVE_LIMIT) return "chunk";
    if (count <= LIVE_RETURN) return "live";
    return current;
}
