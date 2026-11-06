import {
    CELL_INDEX_MASK,
    CHUNK_BITS,
    cellOrientation,
    cellSlot,
    cellTileId,
} from "../../../core/cells";
import type { CellStore } from "../../../core/cells";
import { effectiveValues, orientShape, shapeBox, walkLayers } from "../../../core/model";
import type { Project, ProjectMap, Shape, Tileset } from "../../../core/model";
import { layerShift } from "../../../engine/viewport/geometry";
import { cssColour } from "../../overlay/draw";
import type { OverlayFrame, OverlayLayer } from "../../overlay/types";
import { historySteps } from "../../state/historySteps";
import { sessionStore } from "../../state/session";
import { viewPreferences } from "../../view/viewPreferences";

// View → Show Collision (DESIGN §4; TE-029): 1 px `--accent` outlines of the collision shapes
// of every tile drawn on the visible tile layers of the active map, transformed with the tile's
// orientation (FORMAT §1.2) and placed as the tile is (FORMAT §1.3: bottom-left on the cell's
// bottom-left corner, moved by the tile offset, then by the layer's offset and parallax). Over
// the cell grid, under the tool previews. Off by default; a view preference (SPEC §3).

/** Above the cell grid (300), below the selection's ants and the tool previews. */
export const COLLISION_ORDER = 400;

export interface Collidable {
    tileset: Tileset;
    /** Collision lists by tile ID; only tiles that have shapes. */
    shapes: Map<number, readonly Shape[]>;
    /** How far a tile's shapes reach past its cell, in map pixels, on any side. */
    reach: number;
}

/**
 * The index of the last project and history step drawn: pans and zooms (`touch`) reuse it.
 * Collision commands change tiles in place, so only a step of the history, or a new project,
 * can change the index.
 */
let cached: {
    project: Project;
    step: number;
    sets: Map<number, Collidable>;
} | null = null;

/**
 * The tilesets of the session's project with collision, by slot; rebuilt after a step of the
 * history or when the project was replaced, not on a view change.
 */
export function currentCollidables(): Map<number, Collidable> {
    const { project } = sessionStore.getState().session;
    const { step } = historySteps.getState();
    if (cached?.project !== project || cached.step !== step) {
        cached = { project, step, sets: collidables(project) };
    }
    return cached.sets;
}

/** The tilesets of `project` with collision, by slot. */
function collidables(project: Project): Map<number, Collidable> {
    const found = new Map<number, Collidable>();
    for (const tileset of project.tilesets) {
        const shapes = new Map<number, readonly Shape[]>();
        let overhang = 0;
        for (const tile of tileset.tiles) {
            if (tile.collision.length === 0) continue;
            shapes.set(tile.id, tile.collision);
            for (const shape of tile.collision) {
                const box = shapeBox(shape);
                overhang = Math.max(
                    overhang,
                    -box.x,
                    -box.y,
                    box.x + box.width - tileset.tileWidth,
                    box.y + box.height - tileset.tileHeight,
                );
            }
        }
        if (shapes.size === 0) continue;
        const reach =
            Math.max(tileset.tileWidth, tileset.tileHeight) +
            Math.max(Math.abs(tileset.offsetX), Math.abs(tileset.offsetY)) +
            overhang;
        found.set(tileset.slot, { tileset, shapes, reach: Math.ceil(reach) });
    }
    return found;
}

/** A device position: whole pixels plus a half, so a 1 px line covers one pixel. */
const crisp = (value: number) => Math.round(value) + 0.5;

/** Adds the outline of `shape`, placed with its drawn box's top-left at map `(left, top)`. */
function traceShape(
    context: CanvasRenderingContext2D,
    frame: OverlayFrame,
    shape: Shape,
    left: number,
    top: number,
): void {
    const { mapping } = frame;
    const at = (x: number, y: number) => mapping.mapToDevice(left + x, top + y);
    switch (shape.shape) {
        case "rectangle": {
            const a = at(shape.x, shape.y);
            const b = at(shape.x + shape.width, shape.y + shape.height);
            context.moveTo(crisp(a.x), crisp(a.y));
            context.lineTo(crisp(b.x), crisp(a.y));
            context.lineTo(crisp(b.x), crisp(b.y));
            context.lineTo(crisp(a.x), crisp(b.y));
            context.closePath();
            return;
        }
        case "ellipse": {
            const a = at(shape.x, shape.y);
            const b = at(shape.x + shape.width, shape.y + shape.height);
            const rx = (b.x - a.x) / 2;
            const ry = (b.y - a.y) / 2;
            context.moveTo(a.x + 2 * rx, a.y + ry);
            context.ellipse(a.x + rx, a.y + ry, rx, ry, 0, 0, 2 * Math.PI);
            return;
        }
        case "polygon":
        case "polyline": {
            shape.points.forEach(([px, py], index) => {
                const point = at(shape.x + px, shape.y + py);
                if (index === 0) context.moveTo(crisp(point.x), crisp(point.y));
                else context.lineTo(crisp(point.x), crisp(point.y));
            });
            if (shape.shape === "polygon") context.closePath();
            return;
        }
        case "point":
            return;
    }
}

function drawCollision(frame: OverlayFrame): void {
    if (!viewPreferences.getState().collision) return;
    const sets = currentCollidables();
    if (sets.size === 0) return;
    const { context, map, mapping, size } = frame;
    const reach = Math.max(...[...sets.values()].map((each) => each.reach));
    const view = mapping.frame.view;
    context.beginPath();
    for (const { layer, ancestors } of walkLayers(map.layers)) {
        if (layer.type !== "tile") continue;
        const values = effectiveValues(layer, ancestors);
        if (!values.visible) continue;
        const shift = layerShift(map, view, values);
        traceLayer(frame, map, layer.cells, sets, shift, reach, size);
    }
    context.lineWidth = 1;
    context.strokeStyle = cssColour(frame.theme.accent);
    context.stroke();
}

function traceLayer(
    frame: OverlayFrame,
    map: ProjectMap,
    cells: CellStore,
    sets: ReadonlyMap<number, Collidable>,
    shift: { x: number; y: number },
    reach: number,
    size: { width: number; height: number },
): void {
    const { context, mapping } = frame;
    const gw = map.tileWidth;
    const gh = map.tileHeight;
    // The visible part of the map in the layer's own pixels, widened by the farthest reach.
    const start = mapping.deviceToMap(0, 0);
    const end = mapping.deviceToMap(size.width, size.height);
    const x0 = Math.max(0, Math.floor((start.x - shift.x - reach) / gw));
    const y0 = Math.max(0, Math.floor((start.y - shift.y - reach) / gh));
    const x1 = Math.min(map.width, Math.ceil((end.x - shift.x + reach) / gw));
    const y1 = Math.min(map.height, Math.ceil((end.y - shift.y + reach) / gh));
    if (x1 <= x0 || y1 <= y0) return;
    const bounds = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    for (const chunk of cells.chunksIn(bounds)) {
        const { cells: values } = chunk;
        for (let index = 0; index < values.length; index++) {
            const value = values[index]!;
            if (value === 0) continue;
            const entry = sets.get(cellSlot(value));
            const shapes = entry?.shapes.get(cellTileId(value));
            if (!entry || !shapes) continue;
            const cx = (chunk.cx << CHUNK_BITS) + (index & CELL_INDEX_MASK);
            const cy = (chunk.cy << CHUNK_BITS) + (index >> CHUNK_BITS);
            if (cx < x0 || cy < y0 || cx >= x1 || cy >= y1) continue;
            const { tileset } = entry;
            const orientation = cellOrientation(value);
            const turned = (orientation & 1) !== 0;
            const boxHeight = turned ? tileset.tileWidth : tileset.tileHeight;
            // FORMAT §1.3: the drawn box's bottom-left on the cell's, moved by the tile offset.
            const left = cx * gw + tileset.offsetX + shift.x;
            const top = (cy + 1) * gh + tileset.offsetY - boxHeight + shift.y;
            for (const shape of shapes) {
                const drawn = orientShape(
                    shape,
                    orientation,
                    tileset.tileWidth,
                    tileset.tileHeight,
                );
                traceShape(context, frame, drawn, left, top);
            }
        }
    }
}

export const overlayLayers: OverlayLayer[] = [
    {
        id: "collision-outlines",
        order: COLLISION_ORDER,
        draw: drawCollision,
        // Show Collision, and every change of the project (shapes edited, cells painted,
        // layers shown or hidden).
        watch(redraw) {
            const stops = [
                viewPreferences.subscribe((state, previous) => {
                    if (state.collision !== previous.collision) redraw();
                }),
                sessionStore.subscribe(() => {
                    if (viewPreferences.getState().collision) redraw();
                }),
            ];
            return () => stops.forEach((stop) => stop());
        },
    },
];
