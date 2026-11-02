import type { CellRect } from "../../../core/cells";
import { floodRegion } from "../../../core/fill";
import { findLayer } from "../../../core/model";
import type { ProjectMap, Region, TileLayer } from "../../../core/model";
import type { PixelPoint } from "../../../core/raster/line";
import { createMask, rectMask, spansMask } from "../../../core/selection";
import type { SelectionMode } from "../../../core/selection";
import { clipToMap } from "../../tools/cellOutline";
import { spanRect } from "../../tools/eraser/eraser.tools";
import type { ToolContext, ToolPointer, ToolSpec } from "../../tools/types";
import { setPendingSelection } from "../pendingSelection";
import {
    SELECTION_HINT,
    SELECTION_MODE,
    applySelection,
    clearSelection,
    selectionModeOf,
} from "./selectionMode";

// The tile selection tools (SPEC §4.3, Tiled's `TileSelectionTool`, `MagicWandTool` and
// `SelectSameTileTool`, checked at v1.12.2). Their rail slots, keys (M, W, S) and icons are
// planned in `planned.tools.ts`. They read the active tile layer, hidden or locked too (Tiled's
// selection tools ignore whether the layer is a visible one), and change only the selection of
// the map, through the history (`selectionMode.ts`).
//
//   Rectangle select: press and drag a rectangle of cells, from the pressed cell to the
//     pointer's, both included; the ants show the selection it would leave; the release
//     records it. A click that never drags (Tiled: under half the drag distance) clears the
//     selection, as Tiled's does.
//   Magic wand: the press finds the 4-connected region of cells equal to the pressed one
//     (tile and flags), in the map (`core/fill`'s flood), and the ants show at once the
//     selection it makes (SPEC §14 times press → frame); the release records it, as Tiled's
//     does, so a right click or Escape before it cancels the press.
//   Select same tile: the press selects every cell of the layer equal to the pressed one,
//     the empty cells when it is empty; dragging adds each further cell value hovered; the
//     release records it.
//
// Modes come from the modifiers at the press (`selectionModeOf`). A right click clears the
// selection; a right click during a drag cancels the drag (`pipeline.ts`), as Escape does.

/** CSS pixels a press must move before the rectangle select drags: half of Qt's 10. */
export const SELECT_DRAG_DISTANCE = 5;

/** The tile layer a selection tool reads: the active layer of the stroke, or null. */
function tileLayerOf(context: ToolContext): TileLayer | null {
    const entry = context.layerId === null ? null : findLayer(context.map, context.layerId);
    return entry?.layer.type === "tile" ? entry.layer : null;
}

function inMap(map: ProjectMap, cell: PixelPoint): boolean {
    return cell.x >= 0 && cell.y >= 0 && cell.x < map.width && cell.y < map.height;
}

/** Shows what `shape` combined by `mode` would leave on the stroke's map. */
function preview(context: ToolContext, shape: Region, mode: SelectionMode): void {
    setPendingSelection({ mapId: context.map.id, shape, mode });
}

/** The mask of `rect`'s part inside `map`; an empty mask when none of it is. */
function rectShape(map: ProjectMap, rect: CellRect): Region {
    const inside = clipToMap(rect, map);
    return inside ? rectMask(inside) : createMask({ x: 0, y: 0, width: 0, height: 0 });
}

/**
 * The cells of `layer` whose value is one of `values`, over `map`: Tiled's
 * `SelectSameTileTool`, empty cells included when 0 is one of them.
 */
export function sameValueShape(
    map: ProjectMap,
    layer: TileLayer,
    values: ReadonlySet<number>,
): Region {
    const mask = createMask({ x: 0, y: 0, width: map.width, height: map.height });
    for (let y = 0; y < map.height; y++) {
        const row = y * map.width;
        for (let x = 0; x < map.width; x++) {
            if (values.has(layer.cells.get(x, y))) mask.mask[row + x] = 1;
        }
    }
    return mask;
}

/**
 * The 4-connected region of cells of `layer` equal to the cell at `cell`, in `map`: the magic
 * wand's shape. Empty off the map.
 */
export function wandShape(map: ProjectMap, layer: TileLayer, cell: PixelPoint): Region {
    const bounds = { x: 0, y: 0, width: map.width, height: map.height };
    return spansMask(floodRegion((x, y) => layer.cells.get(x, y), cell, bounds));
}

/** The rectangle select's gesture in progress. */
let rectangle: {
    start: PixelPoint;
    client: { x: number; y: number };
    mode: SelectionMode;
    dragging: boolean;
} | null = null;

function rectangleShape(context: ToolContext, pointer: ToolPointer): Region | null {
    if (!rectangle) return null;
    return rectShape(context.map, spanRect(rectangle.start, pointer.cell));
}

export const rectSelectTool: ToolSpec = {
    id: "rectSelect",
    label: "Rectangle Select",
    hint: SELECTION_HINT,
    options: [SELECTION_MODE],
    cursor: "crosshair",
    onDown(context, pointer) {
        rectangle = null;
        if (pointer.button === "secondary") {
            if (!pointer.modifiers.ctrl && !pointer.modifiers.shift) clearSelection(context);
            return;
        }
        rectangle = {
            start: pointer.cell,
            client: pointer.client,
            mode: selectionModeOf(context.options, pointer.modifiers),
            dragging: false,
        };
    },
    onMove(context, pointer) {
        if (!rectangle) return;
        if (!rectangle.dragging) {
            const distance =
                Math.abs(pointer.client.x - rectangle.client.x) +
                Math.abs(pointer.client.y - rectangle.client.y);
            if (distance < SELECT_DRAG_DISTANCE) return;
            rectangle.dragging = true;
        }
        preview(context, rectangleShape(context, pointer)!, rectangle.mode);
    },
    onUp(context, pointer) {
        const gesture = rectangle;
        rectangle = null;
        setPendingSelection(null);
        if (!gesture) return;
        if (!gesture.dragging) {
            clearSelection(context);
            return;
        }
        const shape = rectShape(context.map, spanRect(gesture.start, pointer.cell));
        applySelection(context, shape, gesture.mode, rectSelectTool.label);
    },
    onCancel() {
        rectangle = null;
        setPendingSelection(null);
    },
};

/** The magic wand's press in progress: the region found at the press and the mode. */
let wand: { shape: Region; mode: SelectionMode } | null = null;

export const wandTool: ToolSpec = {
    id: "wand",
    label: "Magic Wand",
    hint: SELECTION_HINT,
    options: [SELECTION_MODE],
    cursor: "crosshair",
    onDown(context, pointer) {
        wand = null;
        if (pointer.button === "secondary") {
            if (!pointer.modifiers.ctrl && !pointer.modifiers.shift) clearSelection(context);
            return;
        }
        const layer = tileLayerOf(context);
        if (!layer) return;
        const mode = selectionModeOf(context.options, pointer.modifiers);
        wand = { shape: wandShape(context.map, layer, pointer.cell), mode };
        preview(context, wand.shape, wand.mode);
    },
    onUp(context) {
        const gesture = wand;
        wand = null;
        setPendingSelection(null);
        if (gesture) applySelection(context, gesture.shape, gesture.mode, wandTool.label);
    },
    onCancel() {
        wand = null;
        setPendingSelection(null);
    },
};

/** The select same tile's gesture in progress: the values collected and the mode. */
let same: { values: Set<number>; mode: SelectionMode } | null = null;

function collect(context: ToolContext, cells: readonly PixelPoint[]): void {
    const layer = tileLayerOf(context);
    if (!same || !layer) return;
    let added = false;
    for (const cell of cells) {
        if (!inMap(context.map, cell)) continue;
        const value = layer.cells.get(cell.x, cell.y);
        if (same.values.has(value)) continue;
        same.values.add(value);
        added = true;
    }
    if (added) preview(context, sameValueShape(context.map, layer, same.values), same.mode);
}

export const sameTileTool: ToolSpec = {
    id: "sameTile",
    label: "Select Same Tile",
    hint: SELECTION_HINT,
    options: [SELECTION_MODE],
    cursor: "crosshair",
    onDown(context, pointer) {
        same = null;
        if (pointer.button === "secondary") {
            if (!pointer.modifiers.ctrl && !pointer.modifiers.shift) clearSelection(context);
            return;
        }
        if (!tileLayerOf(context)) return;
        same = { values: new Set(), mode: selectionModeOf(context.options, pointer.modifiers) };
        collect(context, [pointer.cell]);
    },
    onMove(context, pointer) {
        collect(context, pointer.cells);
    },
    onUp(context) {
        const gesture = same;
        same = null;
        setPendingSelection(null);
        const layer = tileLayerOf(context);
        // A press off the map collected nothing: Tiled's preview is empty there.
        if (!gesture || !layer) return;
        const shape =
            gesture.values.size > 0
                ? sameValueShape(context.map, layer, gesture.values)
                : createMask({ x: 0, y: 0, width: 0, height: 0 });
        applySelection(context, shape, gesture.mode, sameTileTool.label);
    },
    onCancel() {
        same = null;
        setPendingSelection(null);
    },
};

export const tools: ToolSpec[] = [rectSelectTool, wandTool, sameTileTool];
