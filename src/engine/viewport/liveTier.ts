import type { Camera, Frame } from "@ngne/core";
import type { MapView, Project, ProjectMap } from "../../core/model";
import { effectiveValues, walkLayers } from "../../core/model";
import { QuadEmitter } from "../../core/runtime/emit";
import type { EmitTileset } from "../../core/runtime/emit";
import { checkerBlockSize, checkerMean, checkerSpec, type ViewportChecker } from "./checker";
import { deviceScale, intersect, layerShift, toDevice, visibleRect } from "./geometry";
import type { DeviceSize } from "./geometry";
import { CHECKER_TEXTURE_ID } from "./textures";
import type { ReadyTileset } from "./textures";

// The live tier (ENGINE §4): one quad per visible cell, layer by layer, grouped by tileset, one
// depth per layer, so the frame arrives already ordered. This file builds a `Frame`; the
// viewport submits it.

/** What the viewport shows (read at each draw, so it is never stale). */
export interface ViewportScene {
    project: Project;
    map: ProjectMap;
    view: MapView;
    /** Device pixels per CSS pixel; the view's zoom is in CSS pixels per map pixel. */
    dpr: number;
    checker: ViewportChecker;
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
    /** The NGNE camera of the frame; it stays at the origin with `pixelSnap` off. */
    camera: Camera;
    emitter: QuadEmitter;
    /** The checker spec `ed:checker` holds now; null while it is not uploaded. */
    checkerReady: string | null;
}

/** Sprites a build emitted, by kind (test hook and budget bookkeeping). */
export interface LiveCounts {
    tileQuads: number;
    checkerQuads: number;
}

/**
 * Fills `frame` with the scene: the checkerboard and background colour of the map, then every
 * visible tile layer. The frame is reset first. Returns what it drew.
 */
export function buildLiveFrame(frame: Frame, inputs: LiveInputs): LiveCounts {
    const { scene, size, emitter } = inputs;
    const { map, view } = scene;
    const scale = deviceScale(view.zoom, scene.dpr);
    const camera = { centreX: view.centreX, centreY: view.centreY, scale };
    const visible = visibleRect(camera, size);
    const counts: LiveCounts = { tileQuads: 0, checkerQuads: 0 };

    frame.reset();
    frame.scene(inputs.camera, 1);

    // The map rectangle, clipped to what the canvas shows.
    const mapRect = intersect(
        { x: 0, y: 0, width: map.width * map.tileWidth, height: map.height * map.tileHeight },
        visible,
    );
    if (mapRect) {
        drawChecker(frame, inputs, camera, mapRect, counts);
        const background = map.backgroundColor;
        if (background !== null && (background & 255) !== 0) {
            const from = toDevice(camera, size, mapRect.x, mapRect.y);
            const w = mapRect.width * scale;
            const h = mapRect.height * scale;
            frame.rect(
                from.x + w / 2,
                from.y + h / 2,
                w,
                h,
                background >>> 8,
                (background & 255) / 255,
                LAYER.map,
            );
        }
    }

    const sink = {
        sprite(s: Parameters<Frame["sprite"]>[0]): void {
            frame.sprite(s);
            counts.tileQuads += 1;
        },
    };
    let depth = 0;
    for (const { layer, ancestors } of walkLayers(map.layers)) {
        if (layer.type !== "tile") continue;
        const values = effectiveValues(layer, ancestors);
        const opacity = Math.max(0, Math.min(255, Math.round(values.opacity)));
        if (!values.visible || opacity === 0) continue;
        depth += 1;
        const shift = layerShift(map, camera, values);
        emitter.emitLayer(sink, layer.cells, {
            width: map.width,
            height: map.height,
            gridWidth: map.tileWidth,
            gridHeight: map.tileHeight,
            viewX: visible.x - shift.x,
            viewY: visible.y - shift.y,
            viewWidth: visible.width,
            viewHeight: visible.height,
            translateX: shift.x - visible.x,
            translateY: shift.y - visible.y,
            scale,
            alpha: opacity / 255,
            color: WHITE,
            layer: LAYER.tiles,
            depth,
        });
    }
    return counts;
}

/**
 * The checkerboard under the visible part of the map: quads of the checker image, one per
 * block of squares, edge blocks cut with their UV. Squares too small to tell apart draw as one
 * rectangle of their mean colour.
 */
function drawChecker(
    frame: Frame,
    inputs: LiveInputs,
    camera: { centreX: number; centreY: number; scale: number },
    rect: { x: number; y: number; width: number; height: number },
    counts: LiveCounts,
): void {
    const { size, checkerReady } = inputs;
    const { checker } = inputs.scene;
    const { scale } = camera;
    const from = toDevice(camera, size, rect.x, rect.y);
    if (checker.size * scale < MIN_CHECKER_SQUARE || checkerReady !== checkerSpec(checker)) {
        const w = rect.width * scale;
        const h = rect.height * scale;
        frame.rect(from.x + w / 2, from.y + h / 2, w, h, checkerMean(checker), 1, LAYER.map);
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
            const at = toDevice(camera, size, cut.x, cut.y);
            const w = cut.width * scale;
            const h = cut.height * scale;
            frame.sprite({
                x: at.x + w / 2,
                y: at.y + h / 2,
                width: w,
                height: h,
                texture: CHECKER_TEXTURE_ID,
                u: (cut.x - bx * block) / block,
                v: (cut.y - by * block) / block,
                uw: cut.width / block,
                vh: cut.height / block,
                layer: LAYER.map,
            });
            counts.checkerQuads += 1;
        }
    }
}
