// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { CellStore, cellValue } from "../../../src/core/cells";
import type { CellRect, Orientation } from "../../../src/core/cells";
import { cellPatchCommand } from "../../../src/core/history";
import { MapCompositor, cellScale, compositeMap } from "../../../src/core/compositor";
import type { Ratio } from "../../../src/core/compositor";
import { createProjectSession } from "../../../src/core/model";
import type { PixelBuffer, Project, ProjectMap, TileLayer } from "../../../src/core/model";
import { CHUNK_SIZE } from "../../../src/core/cells";
import { checkerColourAt, checkerMean } from "../../../src/engine/viewport/checker";
import { planSets } from "../../../src/engine/viewport/chunkPlan";
import { layerShift } from "../../../src/engine/viewport/geometry";
import { MIN_CHECKER_SQUARE } from "../../../src/engine/viewport/liveTier";
import { readCanvas } from "../../../src/engine/testing/readCanvas";
import { createViewportSceneProject } from "../../support/viewportScene";
import { referenceHighlight } from "./te-034-highlight";

// TE-015 page module: the specs import it into the running editor (`import("/tests/e2e/harness/
// te-015-page.ts")`), so it shares the app's stores. It loads a map above the live tier's limit,
// places the view, and compares the canvas in the chunk tier with the chunk reference: each chunk
// set composited by `core/compositor` in its layers' own space at the tier's resolution, sampled
// where the set's chunk quads put it on the canvas, blended set over set.

/** The chunk scene: 256 × 128 cells of 16 px, three layers, about 75,000 non-empty cells. */
export const CHUNK_SCENE = { width: 256, height: 128, grid: 16 } as const;
/** Rows of the base layer that use the tileset with a tile offset (slot 3); the rest do not. */
const OFFSET_ROWS = 12;

function probe() {
    const viewport = window.__ngneTest?.viewport;
    if (!viewport) throw new Error("te-015: no viewport probe");
    return viewport;
}

/**
 * The project: the three tilesets of the TE-013 scene (even 16 px tiles, odd 15 px tiles, 16 px
 * tiles with a tile offset), every orientation; a base layer, a layer at half opacity and a layer
 * with parallax 0.5 and an offset, which gets a chunk set of its own.
 */
function createChunkSceneProject(background: number | null): Project {
    const project = createViewportSceneProject({ background });
    const map = project.maps[0]!;
    map.width = CHUNK_SCENE.width;
    map.height = CHUNK_SCENE.height;
    const [base, faint, far] = map.layers as [TileLayer, TileLayer, TileLayer];
    base.cells = new CellStore();
    faint.cells = new CellStore();
    far.cells = new CellStore();
    for (let y = 0; y < map.height; y += 1) {
        for (let x = 0; x < map.width; x += 1) {
            const orientation = ((x * 3 + y) % 8) as Orientation;
            if ((x * 7 + y) % 9 !== 0) {
                const slot = y < OFFSET_ROWS ? 3 : 1 + ((x + y) % 2);
                base.cells.set(x, y, cellValue(slot, (x + 2 * y) % 4, orientation));
            }
            if ((x + 2 * y) % 3 !== 0) {
                faint.cells.set(x, y, cellValue(1, (x * y) % 4, ((x + y) % 8) as Orientation));
            }
            if ((x + y) % 4 !== 0) far.cells.set(x, y, cellValue(2, (x + y) % 4));
        }
    }
    return project;
}

export interface SceneRequest {
    /** Device pixels per map pixel. */
    scale: number;
    /** Device pixels the map's top-left corner lies from the canvas's top-left corner. */
    originX: number;
    originY: number;
    /** 0xRRGGBBAA, or null for the checkerboard. */
    background: number | null;
}

export interface Geometry {
    width: number;
    height: number;
    scale: number;
    centreX: number;
    centreY: number;
}

/** Replaces the project with the chunk scene and puts the view where `request` says. */
export function loadScene(request: SceneRequest): Geometry {
    const { width, height } = probe().canvas;
    const { scale } = request;
    const centreX = (width / 2 - request.originX) / scale;
    const centreY = (height / 2 - request.originY) / scale;
    const project = createChunkSceneProject(request.background);
    const map = project.maps[0]!;
    // The far layer's shift is whole map pixels: parallax 0.5 of a distance of 8 and 6.
    map.parallaxOriginX = centreX - 8;
    map.parallaxOriginY = centreY - 6;
    const session = createProjectSession(project);
    session.perMap.get(session.activeMapId)!.view = {
        centreX,
        centreY,
        zoom: scale / window.devicePixelRatio,
    };
    window.__ngneTest!.session.getState().replace(session);
    return { width, height, scale, centreX, centreY };
}

/** Moves the view without telling the store, so only `renderNow` submits frames. */
function setView(centreX: number, centreY: number, scale: number): void {
    const { session } = window.__ngneTest!.session.getState();
    const view = session.perMap.get(session.activeMapId)!.view;
    view.centreX = centreX;
    view.centreY = centreY;
    view.zoom = scale / window.devicePixelRatio;
}

function themeColour(name: string): number {
    const text = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return parseInt(text.replace("#", ""), 16);
}

export interface Comparison {
    tier: string;
    texelsPerCell: number;
    /** Device pixels compared, and those left out: centred on an edge between two texels. */
    compared: number;
    ties: number;
    maxDiff: number;
    mismatches: number;
    first: { x: number; y: number; expected: number[]; actual: number[] }[];
    /** Pixel counts by channel difference, 0 up to 4. */
    histogram: number[];
    /** Chunk quads and live quads of the frame. */
    chunkQuads: number;
    tileQuads: number;
    /** Chunks drawn with live quads over them. */
    live: number;
    /** Pixels compared inside patches (live quads over a chunk). */
    patched: number;
}

/** Composites of the map's chunk sets over the chunk grid, with their placement. */
function chunkReference(project: Project, map: ProjectMap, texels: number) {
    const compositor = new MapCompositor(project, map);
    const side = CHUNK_SIZE * texels;
    // One chunk of margin on each side holds the tiles that reach out of the map.
    const x0 = -side;
    const y0 = -side;
    const width = (Math.ceil(map.width / CHUNK_SIZE) + 2) * side;
    const height = (Math.ceil(map.height / CHUNK_SIZE) + 2) * side;
    const highlight = referenceHighlight();
    return planSets(map, highlight).map((set) => ({
        set,
        x0,
        y0,
        image: compositor.composite({
            x: x0,
            y: y0,
            width,
            height,
            scaleX: cellScale(texels, map.tileWidth),
            scaleY: cellScale(texels, map.tileHeight),
            layerIds: new Set(set.layerIds),
            layerSpace: true,
            background: false,
            highlight,
        }),
    }));
}

/** How close to a texel edge a device pixel's centre may lie and still be compared. */
const EDGE = 1e-3;

function onEdge(value: number): boolean {
    return Math.abs(value - Math.round(value)) < EDGE;
}

/** A ratio of integers for `scale`, with the smallest denominator of 1, 2, 4 or 8. */
function ratioOf(scale: number): Ratio {
    for (const pixels of [1, 2, 4, 8]) {
        const texels = scale * pixels;
        if (Math.abs(texels - Math.round(texels)) < 1e-9) {
            return { texels: Math.round(texels), pixels };
        }
    }
    throw new Error(`te-015: scale ${scale} is not a ratio of small integers`);
}

/**
 * Submits a frame and reads the canvas in the same task, then compares every device pixel with
 * the chunk reference over the checkerboard or background (in the map) or the workspace colour.
 * Where the frame draws live quads over a set's chunks (a patch not settled yet, as the viewport
 * reports it), the sets up to that one are expected as the live tier draws them: the TE-013
 * reference, `core/compositor` at the device scale, without the device pixels whose centre lies on
 * an edge between two map pixels.
 */
export function compare(geometry: Geometry, tolerance: number): Comparison {
    const viewport = probe();
    if (!viewport.renderNow()) throw new Error("te-015: the renderer did not submit a frame");
    const image = readCanvas(viewport.canvas);
    const { stats } = viewport;
    const chunks = viewport.chunkStats();
    const patches = stats.tier === "chunk" ? viewport.chunkLiveCells() : [];
    const texels = chunks.texelsPerCell;
    const project = window.__ngneTest!.session.getState().session.project;
    const map = project.maps[0]!;
    const { width, height, scale, centreX, centreY } = geometry;
    const camera = { centreX, centreY, scale };
    const sets = chunkReference(project, map, texels).map((entry) => ({
        ...entry,
        shift: layerShift(map, camera, entry.set.placement),
    }));
    const preferences = window.__ngneTest!.preferences.get("checkerboard");
    const checker = {
        a: themeColour("--check-a"),
        b: themeColour("--check-b"),
        size: preferences.size,
    };
    const workspace = themeColour("--bg-workspace");
    const mapWidth = map.width * map.tileWidth;
    const mapHeight = map.height * map.tileHeight;

    // The live tier's image of the sets up to each patched one, one texel per device pixel.
    const ratio = patches.length > 0 ? ratioOf(scale) : null;
    const liveX0 = Math.round(centreX * scale - width / 2);
    const liveY0 = Math.round(centreY * scale - height / 2);
    const live = new Map<number, PixelBuffer>();
    for (const { set } of patches) {
        if (live.has(set) || ratio === null) continue;
        const layerIds = new Set(sets.slice(0, set + 1).flatMap((entry) => entry.set.layerIds));
        live.set(
            set,
            compositeMap(project, map, {
                x: liveX0,
                y: liveY0,
                width,
                height,
                scaleX: ratio,
                scaleY: ratio,
                viewCentre: { x: centreX, y: centreY },
                layerIds,
                highlight: referenceHighlight(),
            }),
        );
    }
    const liveTie = (n: number): boolean =>
        ratio !== null && ((2 * n + 1) * ratio.pixels) % (2 * ratio.texels) === 0;

    const result: Comparison = {
        tier: stats.tier,
        texelsPerCell: texels,
        compared: 0,
        ties: 0,
        maxDiff: 0,
        mismatches: 0,
        first: [],
        histogram: [0, 0, 0, 0, 0],
        chunkQuads: stats.chunkQuads,
        tileQuads: stats.tileQuads,
        live: chunks.live,
        patched: 0,
    };
    const rgb = (colour: number) => [(colour >>> 16) & 255, (colour >>> 8) & 255, colour & 255];

    for (let y = 0; y < height; y += 1) {
        const my = (y + 0.5 - height / 2) / scale + centreY;
        for (let x = 0; x < width; x += 1) {
            const mx = (x + 0.5 - width / 2) / scale + centreX;
            // The map's edges and the checker squares' edges are ties too.
            const near = (value: number) => Math.abs(value) < EDGE;
            let tie = near(mx) || near(my) || near(mx - mapWidth) || near(my - mapHeight);
            const inside = mx >= 0 && my >= 0 && mx < mapWidth && my < mapHeight;
            let colour: number[];
            if (!inside) colour = rgb(workspace);
            else if (map.backgroundColor !== null && (map.backgroundColor & 255) === 255) {
                colour = rgb(map.backgroundColor >>> 8);
            } else if (checker.size * scale < MIN_CHECKER_SQUARE) {
                colour = rgb(checkerMean(checker));
            } else {
                tie ||= onEdge(mx / checker.size) || onEdge(my / checker.size);
                colour = rgb(checkerColourAt(checker, Math.floor(mx), Math.floor(my)));
            }
            // Inside a patch: the live tier's pixels of the sets up to the highest patched set
            // there, then the sets above it from their chunks.
            let top = -1;
            for (const { set, cells } of patches) {
                const { shift } = sets[set]!;
                const cx = (mx - shift.x) / map.tileWidth - cells.x;
                const cy = (my - shift.y) / map.tileHeight - cells.y;
                if (cx < 0 || cy < 0 || cx >= cells.width || cy >= cells.height) continue;
                if (near(cx) || near(cy) || near(cx - cells.width) || near(cy - cells.height)) {
                    tie = true;
                }
                top = Math.max(top, set);
            }
            if (top >= 0) {
                if (liveTie(x + liveX0) || liveTie(y + liveY0)) tie = true;
                const drawn = live.get(top)!;
                const at = (y * width + x) * 4;
                const alpha = drawn.data[at + 3]! / 255;
                colour = colour.map((base, c) => drawn.data[at + c]! * alpha + base * (1 - alpha));
            }
            const first = top + 1;
            for (const { shift, image: layer, x0, y0 } of sets.slice(first)) {
                const tx = ((mx - shift.x) * texels) / map.tileWidth;
                const ty = ((my - shift.y) * texels) / map.tileHeight;
                if (onEdge(tx) || onEdge(ty)) tie = true;
                const ix = Math.floor(tx) - x0;
                const iy = Math.floor(ty) - y0;
                if (ix < 0 || iy < 0 || ix >= layer.width || iy >= layer.height) continue;
                const at = (iy * layer.width + ix) * 4;
                const alpha = layer.data[at + 3]! / 255;
                colour = colour.map((base, c) => layer.data[at + c]! * alpha + base * (1 - alpha));
            }
            if (tie) {
                result.ties += 1;
                continue;
            }
            if (top >= 0) result.patched += 1;
            const expected = colour.map(Math.round);
            const actual = [0, 1, 2].map((c) => image.data[(y * width + x) * 4 + c]!);
            const diff = Math.max(...expected.map((value, c) => Math.abs(value - actual[c]!)));
            result.compared += 1;
            result.maxDiff = Math.max(result.maxDiff, diff);
            result.histogram[Math.min(diff, 4)]! += 1;
            if (diff > tolerance) {
                result.mismatches += 1;
                if (result.first.length < 5) result.first.push({ x, y, expected, actual });
            }
        }
    }
    return result;
}

export interface Sample {
    count: number;
    tier: string;
}

/**
 * Pans the view along `centres` (map pixels) at `scale`, submitting a frame at each; returns the
 * visible count and the tier of each frame.
 */
export function sweep(centres: { x: number; y: number }[], scale: number): Sample[] {
    const viewport = probe();
    return centres.map(({ x, y }) => {
        setView(x, y, scale);
        if (!viewport.renderNow()) throw new Error("te-015: the renderer did not submit a frame");
        return { count: viewport.stats.visibleCount, tier: viewport.stats.tier };
    });
}

/** The cell `(x, y)` of the base layer set to `value` by a command, as a tool stroke does. */
export function paintCell(x: number, y: number, value: number): void {
    const hooks = window.__ngneTest!;
    const { session, history } = hooks.session.getState();
    const map = session.project.maps[0]!;
    const layer = map.layers[0] as TileLayer;
    const before = layer.cells.get(x, y);
    const rect: CellRect = { x, y, width: 1, height: 1 };
    history.execute(
        cellPatchCommand({
            label: "Paint",
            mapId: map.id,
            layerId: layer.id,
            width: map.width,
            words: Uint32Array.of(y * map.width + x, before, value),
            cellRect: rect,
        }),
    );
}

/** A value for `paintCell`: tile `tile` of tileset `slot`. */
export function tileValue(slot: number, tile: number, orientation: number): number {
    return cellValue(slot, tile, orientation as Orientation);
}

/** The value of cell `(x, y)` of the base layer. */
export function cellAt(x: number, y: number): number {
    const map = window.__ngneTest!.session.getState().session.project.maps[0]!;
    return (map.layers[0] as TileLayer).cells.get(x, y);
}

/**
 * Changes cell `(x, y)` of the base layer to `value` without a command, so the viewport is not
 * told: the chunks keep the old pixels (the specs' control that the comparison sees them).
 */
export function changeSilently(x: number, y: number, value: number): void {
    const map = window.__ngneTest!.session.getState().session.project.maps[0]!;
    (map.layers[0] as TileLayer).cells.set(x, y, value);
}

/** The visible count of the view centred at `(x, y)` at `scale`, from a submitted frame. */
export function countAt(x: number, y: number, scale: number): number {
    return sweep([{ x, y }], scale)[0]!.count;
}

export interface PaintResult {
    comparison: Comparison;
    /** Device pixels of the cell that changed from the frame before. */
    changed: number;
    /** Chunk tier state right after the frame: patches still pending. */
    live: number;
    pending: number;
}

/**
 * Submits a frame, paints cell `(x, y)` of the base layer with a command and, in the same task,
 * compares the next submitted frame with the reference of the changed document: the patch has
 * not settled, so the change shows through live quads.
 */
export function paintAndCompare(
    x: number,
    y: number,
    value: number,
    geometry: Geometry,
    tolerance: number,
): PaintResult {
    const viewport = probe();
    const map = window.__ngneTest!.session.getState().session.project.maps[0]!;
    const { width, scale, centreX, centreY } = geometry;
    // The cell's device pixels, inside its edges.
    const left = Math.ceil((x * map.tileWidth - centreX) * scale + width / 2);
    const top = Math.ceil((y * map.tileHeight - centreY) * scale + geometry.height / 2);
    const side = Math.floor(map.tileWidth * scale);
    const block = (image: ImageData) => {
        const pixels: number[] = [];
        for (let row = 0; row < side; row += 1) {
            const at = ((top + row) * image.width + left) * 4;
            pixels.push(...image.data.subarray(at, at + side * 4));
        }
        return pixels;
    };
    if (!viewport.renderNow()) throw new Error("te-015: the renderer did not submit a frame");
    const before = block(readCanvas(viewport.canvas));
    paintCell(x, y, value);
    const comparison = compare(geometry, tolerance);
    const after = block(readCanvas(viewport.canvas));
    let changed = 0;
    for (let at = 0; at < before.length; at += 4) {
        if ([0, 1, 2].some((c) => before[at + c] !== after[at + c])) changed += 1;
    }
    const chunks = viewport.chunkStats();
    return { comparison, changed, live: chunks.live, pending: chunks.pending };
}

/** Undoes the last step and compares the next submitted frame, in the same task. */
export function undoAndCompare(geometry: Geometry, tolerance: number): Comparison {
    window.__ngneTest!.session.getState().history.undo();
    return compare(geometry, tolerance);
}
