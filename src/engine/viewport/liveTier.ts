import type { Camera, Frame, Sprite } from "@ngne/core";
import type {
    GroupLayer,
    ImageLayer,
    LayerHighlight,
    MapView,
    PixelBuffer,
    Project,
    ProjectMap,
    TileLayer,
} from "../../core/model";
import { drawnOpacity, effectiveValues, findLayer, walkLayers } from "../../core/model";
import { QuadEmitter } from "../../core/runtime/emit";
import type { EmitTileset, SpriteLike } from "../../core/runtime/emit";
import { checkerBlockSize, checkerMean, checkerSpec, type ViewportChecker } from "./checker";
import {
    deviceClip,
    deviceScale,
    intersect,
    layerShift,
    viewOrigin,
    visibleRect,
} from "./geometry";
import type { Camera2D, DeviceSize, MapRect } from "./geometry";
import { CHECKER_TEXTURE_ID } from "./textures";
import type { ReadyTileset } from "./textures";
import { emitImageLayer } from "./imageLayers";
import type { ReadyImage } from "./imageLayers";

// The live tier (ENGINE §4): one quad per visible cell, layer by layer, grouped by tileset, one
// depth per layer, so the frame arrives already ordered; an image layer draws its texture at its
// depth (imageLayers.ts). Quads are in map pixels; the NGNE camera carries the view
// (`placeCamera`). This file builds a `Frame`; the viewport submits it.

/** What the viewport shows (read at each draw, so it is never stale). */
export interface ViewportScene {
    project: Project;
    map: ProjectMap;
    view: MapView;
    /** Device pixels per CSS pixel; the view's zoom is in CSS pixels per map pixel. */
    dpr: number;
    checker: ViewportChecker;
    /**
     * Highlight Current Layer (SPEC §7.2): the layers outside the current one drawn at its
     * factor of their opacity; null or absent draws every layer at its own.
     */
    highlight?: LayerHighlight | null;
}

/** NGNE sorts by scene, then `layer`, then `depth`, then insertion order. */
export const LAYER = {
    /** The checkerboard and the map's background colour. */
    map: 0,
    tiles: 1,
} as const;

/** Squares narrower than this many device pixels draw as their mean colour. */
export const MIN_CHECKER_SQUARE = 4;

const WHITE = 0xffffffff;

/** The prepared emitter of a set of drawable tilesets; rebuilt when one of them changes. */
export class EmitterCache {
    #key = "";
    #emitter: QuadEmitter | null = null;

    emitter(tilesets: readonly ReadyTileset[]): QuadEmitter {
        const key = tilesets
            .map(({ tileset, version }) =>
                [
                    tileset.id,
                    version,
                    tileset.slot,
                    tileset.tileWidth,
                    tileset.tileHeight,
                    tileset.offsetX,
                    tileset.offsetY,
                    tileset.nextTileId,
                ].join(":"),
            )
            .join("|");
        if (this.#emitter === null || key !== this.#key) {
            this.#key = key;
            this.#emitter = new QuadEmitter("slot", tilesets.map(emitTileset));
        }
        return this.#emitter;
    }
}

function emitTileset({ tileset, texture, uvTable }: ReadyTileset): EmitTileset {
    return {
        texture,
        tileWidth: tileset.tileWidth,
        tileHeight: tileset.tileHeight,
        offsetX: tileset.offsetX,
        offsetY: tileset.offsetY,
        key: tileset.slot,
        ids: uvTable.ids,
        uv: uvTable.uv,
        span: tileset.nextTileId,
    };
}

/** What `buildLiveFrame` reads besides the scene. */
export interface LiveInputs {
    scene: ViewportScene;
    size: DeviceSize;
    /**
     * The NGNE camera of the frame, `pixelSnap` off; `drawMapBase` places it on the view
     * (`placeCamera`).
     */
    camera: Camera;
    emitter: QuadEmitter;
    /** The checker spec `ed:checker` holds now; null while it is not uploaded. */
    checkerReady: string | null;
    /** The image layers' textures; without them image layers are not drawn. */
    images?: ImageTextureSource | null;
}

/** Where an image layer's texture is found (`ImageLayerTextures`). */
export interface ImageTextureSource {
    /** The texture of `layer` when it holds the layer's current image of `pixels`. */
    ready(layer: ImageLayer, pixels: PixelBuffer): ReadyImage | null;
}

/** Sprites a build emitted, by kind (test hook and budget bookkeeping). */
export interface LiveCounts {
    tileQuads: number;
    checkerQuads: number;
    /** Quads of image layers; absent counts none. */
    imageQuads?: number;
}

/**
 * Fills `frame` with the scene: the checkerboard and background colour of the map, then every
 * visible tile and image layer. The frame is reset first. Returns what it drew.
 */
export function buildLiveFrame(frame: Frame, inputs: LiveInputs): LiveCounts {
    const { scene } = inputs;
    const { map } = scene;
    const counts: LiveCounts = { tileQuads: 0, checkerQuads: 0 };
    const camera = drawMapBase(frame, inputs, counts);
    const visible = visibleRect(camera, inputs.size);
    let depth = 0;
    for (const { layer, ancestors } of walkLayers(map.layers)) {
        if (layer.type !== "tile" && layer.type !== "image") continue;
        const values = effectiveValues(layer, ancestors);
        const opacity = drawnOpacity(layer, ancestors, values, scene.highlight);
        if (!values.visible || opacity === 0) continue;
        depth += 1;
        if (layer.type === "image") {
            emitLiveImageLayer(frame, inputs, camera, layer, visible, { depth, counts, ancestors });
        } else {
            emitLiveLayer(frame, inputs, camera, layer, visible, { depth, counts, ancestors });
        }
    }
    return counts;
}

/**
 * Emits the quads of an image layer that meet `area` (map pixels) at the layer's effective
 * opacity, parallax and offset, once its texture holds its image. With `clip`, each quad has
 * `area` as its sprite clip (over a chunk tier patch).
 */
export function emitLiveImageLayer(
    frame: Frame,
    inputs: LiveInputs,
    camera: Camera2D,
    layer: ImageLayer,
    area: MapRect,
    at: {
        depth: number;
        counts: LiveCounts;
        ancestors?: readonly GroupLayer[];
        layer?: number;
        clip?: boolean;
    },
): void {
    const { scene, size } = inputs;
    const { map } = scene;
    const entry = at.ancestors ? { layer, ancestors: at.ancestors } : findLayer(map, layer.id);
    if (!entry || !inputs.images) return;
    const values = effectiveValues(layer, entry.ancestors);
    const opacity = drawnOpacity(layer, entry.ancestors, values, scene.highlight);
    if (!values.visible || opacity === 0) return;
    const image = scene.project.images.find((each) => each.id === layer.imageId);
    const ready = image ? inputs.images.ready(layer, image.pixels) : null;
    if (!ready) return;
    const shift = layerShift(map, camera, values);
    const quads = emitImageLayer(frame, { layer, ready, opacity, shift }, area, {
        layer: at.layer ?? LAYER.tiles,
        depth: at.depth,
        clip: at.clip ? deviceClip(camera, size, area) : null,
    });
    if (quads > 0) at.counts.imageQuads = (at.counts.imageQuads ?? 0) + quads;
}

/** The camera of a scene: its view centre and device pixels per map pixel. */
export function sceneCamera(scene: ViewportScene): Camera2D {
    const { view } = scene;
    return {
        centreX: view.centreX,
        centreY: view.centreY,
        scale: deviceScale(view.zoom, scene.dpr),
    };
}

/**
 * Puts NGNE's camera on the view: at the map pixel of the canvas's top-left corner, with the
 * device pixels per map pixel as its zoom. Previous and current values are set together, so a
 * frame drawn at any alpha shows exactly them.
 */
export function placeCamera(target: Camera, camera: Camera2D, size: DeviceSize): void {
    const origin = viewOrigin(camera, size);
    target.cut(origin.x, origin.y, camera.scale);
}

/**
 * Resets `frame`, places its camera on the view and draws what lies under every tile layer: the
 * checkerboard and the background colour of the visible part of the map. Returns the scene's
 * camera.
 */
export function drawMapBase(frame: Frame, inputs: LiveInputs, counts: LiveCounts): Camera2D {
    const camera = sceneCamera(inputs.scene);
    placeCamera(inputs.camera, camera, inputs.size);
    frame.reset();
    frame.scene(inputs.camera, 1);
    drawUnderTiles(frame, inputs, camera, visibleRect(camera, inputs.size), counts);
    return camera;
}

/** Where quads go in NGNE's order: a layer and a depth in it. */
export interface Placement {
    layer: number;
    depth: number;
}

/**
 * The checkerboard and the background colour of the map inside `area` (map pixels). By default
 * under every tile; with `at`, at that place, and over `workspace` (0xRRGGBB) outside the map, so
 * that it covers whatever was drawn there before (the chunk tier's patches).
 */
export function drawUnderTiles(
    frame: Frame,
    inputs: LiveInputs,
    camera: Camera2D,
    area: MapRect,
    counts: LiveCounts,
    at?: Placement & { workspace: number },
): void {
    const { map } = inputs.scene;
    if (at) fillRect(frame, area, at.workspace, 1, at);
    const mapRect = intersect(
        { x: 0, y: 0, width: map.width * map.tileWidth, height: map.height * map.tileHeight },
        area,
    );
    if (!mapRect) return;
    drawChecker(frame, inputs, camera, mapRect, counts, at);
    const background = map.backgroundColor;
    if (background !== null && (background & 255) !== 0) {
        fillRect(frame, mapRect, background >>> 8, (background & 255) / 255, at);
    }
}

/** One rectangle of a colour, under the tiles or at `at`. */
function fillRect(
    frame: Frame,
    rect: MapRect,
    color: number,
    alpha: number,
    at: Placement | undefined,
): void {
    const { width, height } = rect;
    const x = rect.x + width / 2;
    const y = rect.y + height / 2;
    if (at) {
        frame.sprite({ x, y, width, height, color, alpha, ...at });
    } else {
        frame.rect(x, y, width, height, color, alpha, LAYER.map);
    }
}

/**
 * Emits the quads of one tile layer whose tiles overlap `area`, a rectangle in map pixels
 * (the visible part of the map, or cells to draw over a chunk), at the layer's effective
 * opacity, parallax and offset. With `clip`, each quad has `area` as its sprite clip: over a
 * chunk, a tile that reaches past the area would draw again what the chunk holds around it.
 */
export function emitLiveLayer(
    frame: Frame,
    inputs: LiveInputs,
    camera: Camera2D,
    layer: TileLayer,
    area: MapRect,
    at: {
        depth: number;
        counts: LiveCounts;
        ancestors?: readonly GroupLayer[];
        layer?: number;
        clip?: boolean;
    },
): void {
    const { map } = inputs.scene;
    const entry = at.ancestors ? { layer, ancestors: at.ancestors } : findLayer(map, layer.id);
    if (!entry) return;
    const values = effectiveValues(layer, entry.ancestors);
    const opacity = drawnOpacity(layer, entry.ancestors, values, inputs.scene.highlight);
    if (!values.visible || opacity === 0) return;
    const shift = layerShift(map, camera, values);
    const { counts } = at;
    // The emitter's own sprite object is reused for every quad and never has a clip: NGNE keeps
    // unclipped sprites on its fast path. A clipped quad is a copy that carries the clip.
    const clipped: Sprite | null = at.clip
        ? { ...inputs.emitter.sprite, clip: deviceClip(camera, inputs.size, area) }
        : null;
    const sink = {
        sprite(s: SpriteLike): void {
            frame.sprite(clipped === null ? s : Object.assign(clipped, s));
            counts.tileQuads += 1;
        },
    };
    inputs.emitter.emitLayer(sink, layer.cells, {
        width: map.width,
        height: map.height,
        gridWidth: map.tileWidth,
        gridHeight: map.tileHeight,
        viewX: area.x - shift.x,
        viewY: area.y - shift.y,
        viewWidth: area.width,
        viewHeight: area.height,
        translateX: shift.x,
        translateY: shift.y,
        // Map pixels: the camera's zoom scales them.
        scale: 1,
        alpha: opacity / 255,
        color: WHITE,
        layer: at.layer ?? LAYER.tiles,
        depth: at.depth,
    });
}

/**
 * The checkerboard under the visible part of the map: quads of the checker image, one per
 * block of squares, edge blocks cut with their UV. Squares too small to tell apart draw as one
 * rectangle of their mean colour.
 */
function drawChecker(
    frame: Frame,
    inputs: LiveInputs,
    camera: Camera2D,
    rect: MapRect,
    counts: LiveCounts,
    place?: Placement,
): void {
    const { checkerReady } = inputs;
    const { checker } = inputs.scene;
    if (checker.size * camera.scale < MIN_CHECKER_SQUARE || checkerReady !== checkerSpec(checker)) {
        fillRect(frame, rect, checkerMean(checker), 1, place);
        counts.checkerQuads += 1;
        return;
    }
    const block = checkerBlockSize(checker);
    const x0 = Math.floor(rect.x / block);
    const x1 = Math.ceil((rect.x + rect.width) / block);
    const y0 = Math.floor(rect.y / block);
    const y1 = Math.ceil((rect.y + rect.height) / block);
    for (let by = y0; by < y1; by += 1) {
        for (let bx = x0; bx < x1; bx += 1) {
            const cut = intersect(
                { x: bx * block, y: by * block, width: block, height: block },
                rect,
            );
            if (!cut) continue;
            frame.sprite({
                x: cut.x + cut.width / 2,
                y: cut.y + cut.height / 2,
                width: cut.width,
                height: cut.height,
                texture: CHECKER_TEXTURE_ID,
                u: (cut.x - bx * block) / block,
                v: (cut.y - by * block) / block,
                uw: cut.width / block,
                vh: cut.height / block,
                ...(place ?? { layer: LAYER.map }),
            });
            counts.checkerQuads += 1;
        }
    }
}
