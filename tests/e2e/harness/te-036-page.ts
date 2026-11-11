// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { CHUNK_SIZE, CellStore, cellValue } from "../../../src/core/cells";
import type { Orientation } from "../../../src/core/cells";
import { MapCompositor, UNIT_SCALE, cellScale } from "../../../src/core/compositor";
import {
    createProjectSession,
    drawnOpacity,
    effectiveValues,
    walkLayers,
} from "../../../src/core/model";
import type {
    ImageLayer,
    Layer,
    PixelBuffer,
    Project,
    ProjectMap,
    TileLayer,
} from "../../../src/core/model";
import { readCanvas } from "../../../src/engine/testing/readCanvas";
import { checkerColourAt, checkerMean } from "../../../src/engine/viewport/checker";
import { planSets } from "../../../src/engine/viewport/chunkPlan";
import type { ChunkSetPlan } from "../../../src/engine/viewport/chunkPlan";
import { layerShift } from "../../../src/engine/viewport/geometry";
import { MIN_CHECKER_SQUARE } from "../../../src/engine/viewport/liveTier";
import { createViewportSceneProject } from "../../support/viewportScene";
import { referenceHighlight } from "./te-034-highlight";

// TE-036 page module: the specs import it into the running editor, so it shares the app's
// stores. It loads the TE-013 scene (live tier) or a map above the live tier's limit (chunk
// tier), with the bottom layer active so that a new image layer goes between tile layers, and
// compares the canvas with the reference of `core/compositor`: each device pixel is the colour
// under it (checkerboard, or the workspace outside the map), then bottom to top what the tier
// draws, each sampled at the map point under the pixel's centre. In the live tier that is every
// visible tile and image layer composited alone at one texel per map pixel; in the chunk tier the
// chunk sets composited in their layers' own space at the tier's resolution (as TE-015) and the
// image layers between them as in the live tier.
//
// The view is placed so that no pixel centre lies on the edge of a map pixel, a chunk texel or a
// checker square, and every layer's shift is whole map pixels: the GPU's choice on an edge is
// undefined, and the compositor rounds a shift to whole map pixels.

const hooks = () => window.__ngneTest!;

function probe() {
    const viewport = hooks().viewport;
    if (!viewport) throw new Error("te-036: no viewport probe");
    return viewport;
}

/** The chunk scene: 256 × 128 cells of 16 px, about 75,000 non-empty cells (as TE-015's). */
function chunkSceneProject(): Project {
    const project = createViewportSceneProject({ background: null });
    const map = project.maps[0]!;
    map.width = 256;
    map.height = 128;
    const [base, faint, far] = map.layers as [TileLayer, TileLayer, TileLayer];
    base.cells = new CellStore();
    faint.cells = new CellStore();
    far.cells = new CellStore();
    for (let y = 0; y < map.height; y += 1) {
        for (let x = 0; x < map.width; x += 1) {
            const orientation = ((x * 3 + y) % 8) as Orientation;
            if ((x * 7 + y) % 9 !== 0) {
                base.cells.set(x, y, cellValue(1 + ((x + y) % 2), (x + 2 * y) % 4, orientation));
            }
            if ((x + 2 * y) % 3 !== 0) {
                faint.cells.set(x, y, cellValue(1, (x * y) % 4, ((x + y) % 8) as Orientation));
            }
            if ((x + y) % 4 !== 0) far.cells.set(x, y, cellValue(2, (x + y) % 4));
        }
    }
    return project;
}

export type Tier = "live" | "chunk";

export interface Geometry {
    tier: Tier;
    width: number;
    height: number;
    scale: number;
    centreX: number;
    centreY: number;
}

/**
 * Replaces the project with the scene of `tier` and places the view: scale 2 (live) or 0.25
 * (chunk) device pixels per map pixel, the view centre chosen so that pixel centres fall a
 * quarter or half map pixel off every edge, and the parallax origin 8 px from the centre so that
 * parallax factors of 0.5 and 0.25 shift by whole pixels. The bottom layer is active.
 */
export function loadScene(tier: Tier): Geometry {
    const { width, height } = probe().canvas;
    const scale = tier === "live" ? 2 : 0.25;
    const project =
        tier === "live" ? createViewportSceneProject({ background: null }) : chunkSceneProject();
    const map = project.maps[0]!;
    // Pixel centres at (n + ½ − size / 2) / scale from the centre: off the edges with these.
    const fraction = (size: number) => (tier === "live" ? (size % 2 === 0 ? 0 : 0.25) : 0.5);
    const mapWidth = map.width * map.tileWidth;
    const mapHeight = map.height * map.tileHeight;
    const centreX = Math.round(tier === "live" ? mapWidth / 2 : 2400) + fraction(width);
    const centreY = Math.round(tier === "live" ? mapHeight / 2 : 1100) + fraction(height);
    map.parallaxOriginX = centreX - 8;
    map.parallaxOriginY = centreY - 8;
    const session = createProjectSession(project);
    const mapSession = session.perMap.get(session.activeMapId)!;
    mapSession.view = { centreX, centreY, zoom: scale / window.devicePixelRatio };
    mapSession.activeLayerId = map.layers[0]!.id;
    hooks().session.getState().replace(session);
    return { tier, width, height, scale, centreX, centreY };
}

/** The image layers of the map and the project's images, as the specs check them. */
export function imageState() {
    const { session, history } = hooks().session.getState();
    const map = session.project.maps[0]!;
    const layers = [...walkLayers(map.layers)].map((entry) => entry.layer);
    return {
        images: session.project.images.map((image) => ({
            name: image.name,
            exportName: image.exportName,
            width: image.pixels.width,
            height: image.pixels.height,
        })),
        order: layers.map((layer) => `${layer.type}:${layer.name}`),
        imageLayers: layers
            .filter((layer): layer is ImageLayer => layer.type === "image")
            .map(({ id, name, imageId, repeatX, repeatY, parallaxX, parallaxY }) => ({
                id,
                name,
                imageId,
                repeatX,
                repeatY,
                parallaxX,
                parallaxY,
            })),
        activeLayerId: session.perMap.get(session.activeMapId)!.activeLayerId,
        undoLabel: history.undoLabel,
    };
}

/**
 * Submits a frame and tells whether it drew image quads: the texture of each image layer holds
 * its current image and repeat (a texture with an older content is not drawn).
 */
export function imageShown(): boolean {
    const viewport = probe();
    if (!viewport.renderNow()) return false;
    return viewport.stats.imageQuads > 0;
}

/** Whether the chunk tier is built with no patch pending. */
export function chunksReady(): boolean {
    const stats = probe().chunkStats();
    return stats.ready && stats.pending === 0;
}

export interface Comparison {
    tier: string;
    texelsPerCell: number;
    compared: number;
    ties: number;
    maxDiff: number;
    mismatches: number;
    first: { x: number; y: number; expected: number[]; actual: number[] }[];
    histogram: number[];
    chunkQuads: number;
    tileQuads: number;
    imageQuads: number;
}

/** A device-pixel rectangle of the canvas to compare. */
export interface Region {
    x: number;
    y: number;
    width: number;
    height: number;
}

const EDGE = 1e-3;

function onEdge(value: number): boolean {
    return Math.abs(value - Math.round(value)) < EDGE;
}

function themeColour(name: string): number {
    const text = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return Number.parseInt(text.replace("#", ""), 16);
}

/** What the reference blends, bottom to top: a layer at one texel per map pixel, or a chunk set. */
type Item =
    | { kind: "layer"; image: PixelBuffer; x0: number; y0: number }
    | {
          kind: "set";
          image: PixelBuffer;
          x0: number;
          y0: number;
          set: ChunkSetPlan;
          shift: { x: number; y: number };
      };

function visible(layer: Layer, map: ProjectMap): boolean {
    for (const entry of walkLayers(map.layers)) {
        if (entry.layer !== layer) continue;
        const values = effectiveValues(layer, entry.ancestors);
        return (
            values.visible && drawnOpacity(layer, entry.ancestors, values, referenceHighlight()) > 0
        );
    }
    return false;
}

/**
 * Submits a frame, reads the canvas in the same task and compares `region` (the whole canvas by
 * default) with the reference, `tolerance` per channel.
 */
export function compare(geometry: Geometry, tolerance: number, region?: Region): Comparison {
    const viewport = probe();
    if (!viewport.renderNow()) throw new Error("te-036: the renderer did not submit a frame");
    const canvas = readCanvas(viewport.canvas);
    const { stats } = viewport;
    const chunks = viewport.chunkStats();
    const texels = chunks.texelsPerCell;
    const project = hooks().session.getState().session.project;
    const map = project.maps[0]!;
    const { width, height, scale, centreX, centreY } = geometry;
    const area = region ?? { x: 0, y: 0, width, height };
    const toMap = (n: number, size: number, centre: number) =>
        (n + 0.5 - size / 2) / scale + centre;
    const highlight = referenceHighlight();
    const compositor = new MapCompositor(project, map);

    // The map pixels under the region, one more on each side.
    const bx = Math.floor(toMap(area.x, width, centreX)) - 1;
    const by = Math.floor(toMap(area.y, height, centreY)) - 1;
    const bw = Math.ceil(toMap(area.x + area.width, width, centreX)) - bx + 2;
    const bh = Math.ceil(toMap(area.y + area.height, height, centreY)) - by + 2;
    const layerItem = (layer: Layer): Item => ({
        kind: "layer",
        x0: bx,
        y0: by,
        image: compositor.composite({
            x: bx,
            y: by,
            width: bw,
            height: bh,
            scaleX: UNIT_SCALE,
            scaleY: UNIT_SCALE,
            viewCentre: { x: centreX, y: centreY },
            layerIds: new Set([layer.id]),
            background: false,
            highlight,
        }),
    });

    const items: Item[] = [];
    if (stats.tier === "chunk") {
        // The sets as TE-015 composites them: in the layers' own space at T texels per cell.
        const side = CHUNK_SIZE * texels;
        const x0 = -side;
        const y0 = -side;
        const setWidth = (Math.ceil(map.width / CHUNK_SIZE) + 2) * side;
        const setHeight = (Math.ceil(map.height / CHUNK_SIZE) + 2) * side;
        const sets = planSets(map, highlight);
        const setOf = new Map<number, ChunkSetPlan>();
        for (const set of sets) for (const id of set.layerIds) setOf.set(id, set);
        let last: ChunkSetPlan | null = null;
        for (const { layer } of walkLayers(map.layers)) {
            if (layer.type === "image") {
                if (!visible(layer, map)) continue;
                items.push(layerItem(layer));
                last = null;
                continue;
            }
            const set = setOf.get(layer.id);
            if (!set || set === last) continue;
            last = set;
            items.push({
                kind: "set",
                set,
                x0,
                y0,
                shift: layerShift(map, { centreX, centreY }, set.placement),
                image: compositor.composite({
                    x: x0,
                    y: y0,
                    width: setWidth,
                    height: setHeight,
                    scaleX: cellScale(texels, map.tileWidth),
                    scaleY: cellScale(texels, map.tileHeight),
                    layerIds: new Set(set.layerIds),
                    layerSpace: true,
                    background: false,
                    highlight,
                }),
            });
        }
    } else {
        for (const { layer } of walkLayers(map.layers)) {
            if ((layer.type === "tile" || layer.type === "image") && visible(layer, map)) {
                items.push(layerItem(layer));
            }
        }
    }

    const preferences = hooks().preferences.get("checkerboard");
    const checker = {
        a: themeColour("--check-a"),
        b: themeColour("--check-b"),
        size: preferences.size,
    };
    const workspace = themeColour("--bg-workspace");
    const mapWidth = map.width * map.tileWidth;
    const mapHeight = map.height * map.tileHeight;
    const rgb = (colour: number) => [(colour >>> 16) & 255, (colour >>> 8) & 255, colour & 255];

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
        imageQuads: stats.imageQuads,
    };
    for (let y = area.y; y < area.y + area.height; y += 1) {
        const my = toMap(y, height, centreY);
        for (let x = area.x; x < area.x + area.width; x += 1) {
            const mx = toMap(x, width, centreX);
            let tie = onEdge(mx) || onEdge(my);
            const inside = mx >= 0 && my >= 0 && mx < mapWidth && my < mapHeight;
            let colour: number[];
            if (!inside) colour = rgb(workspace);
            else if (checker.size * scale < MIN_CHECKER_SQUARE) colour = rgb(checkerMean(checker));
            else {
                tie ||= onEdge(mx / checker.size) || onEdge(my / checker.size);
                colour = rgb(checkerColourAt(checker, Math.floor(mx), Math.floor(my)));
            }
            for (const item of items) {
                let ix: number;
                let iy: number;
                if (item.kind === "set") {
                    const tx = ((mx - item.shift.x) * texels) / map.tileWidth;
                    const ty = ((my - item.shift.y) * texels) / map.tileHeight;
                    if (onEdge(tx) || onEdge(ty)) tie = true;
                    ix = Math.floor(tx) - item.x0;
                    iy = Math.floor(ty) - item.y0;
                } else {
                    ix = Math.floor(mx) - item.x0;
                    iy = Math.floor(my) - item.y0;
                }
                const { image } = item;
                if (ix < 0 || iy < 0 || ix >= image.width || iy >= image.height) continue;
                const at = (iy * image.width + ix) * 4;
                const alpha = image.data[at + 3]! / 255;
                colour = colour.map((base, c) => image.data[at + c]! * alpha + base * (1 - alpha));
            }
            if (tie) {
                result.ties += 1;
                continue;
            }
            const expected = colour.map(Math.round);
            const actual = [0, 1, 2].map((c) => canvas.data[(y * width + x) * 4 + c]!);
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

/** Image pixels drawn by the reference over the region: how much of it the image layer covers. */
export function imageCoverage(geometry: Geometry, region?: Region): number {
    const project = hooks().session.getState().session.project;
    const map = project.maps[0]!;
    const layer = [...walkLayers(map.layers)]
        .map((entry) => entry.layer)
        .find((each): each is ImageLayer => each.type === "image");
    if (!layer) return 0;
    const { width, height, scale, centreX, centreY } = geometry;
    const area = region ?? { x: 0, y: 0, width, height };
    const image = project.images.find((each) => each.id === layer.imageId)!.pixels;
    const values = effectiveValues(layer, []);
    const shift = layerShift(map, { centreX, centreY }, values);
    let covered = 0;
    for (let y = area.y; y < area.y + area.height; y += 1) {
        const ly = Math.floor((y + 0.5 - height / 2) / scale + centreY - shift.y);
        if (!layer.repeatY && (ly < 0 || ly >= image.height)) continue;
        for (let x = area.x; x < area.x + area.width; x += 1) {
            const lx = Math.floor((x + 0.5 - width / 2) / scale + centreX - shift.x);
            if (!layer.repeatX && (lx < 0 || lx >= image.width)) continue;
            covered += 1;
        }
    }
    return covered;
}
