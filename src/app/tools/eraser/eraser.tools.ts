import type { CellRect } from "../../../core/cells";
import type { PixelPoint } from "../../../core/raster/line";
import type { PaintStroke, ToolContext, ToolPointer, ToolSpec } from "../types";

// The eraser (SPEC §4.3), Tiled's `Eraser` (`src/tiled/eraser.cpp`, checked at v1.12.2). Its
// rail slot, key (E) and icon are planned in `planned.tools.ts`; the overlay preview is
// `eraserPreview.overlay.ts`.
//
//   press, drag: empties the cell under the pointer and every cell crossed
//   right drag: empties the rectangle from the pressed cell to the released one, both
//     included (Tiled's `QRect::span`), at the release
//   Shift, or the context bar's All layers: on every visible, unlocked tile layer of the map
//     (under no hidden or locked group) instead of the active one; Shift counts at each sample
//
// Each stroke is one history entry, all layers included.

/** The rectangle of a right drag in progress: from the pressed cell to the pointer's. */
let rectangle: { start: PixelPoint; end: PixelPoint } | null = null;
const listeners = new Set<() => void>();
const changed = () => {
    for (const listener of [...listeners]) listener();
};

/** The cells of the span of two cells, both included. */
export function spanRect(a: PixelPoint, b: PixelPoint): CellRect {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, width: Math.abs(a.x - b.x) + 1, height: Math.abs(a.y - b.y) + 1 };
}

/**
 * The cells the eraser shows it would empty with the pointer on `cell`: the cell, or the
 * rectangle of a right drag in progress (`pressed`).
 */
export function eraserArea(cell: PixelPoint, pressed: boolean): CellRect {
    if (pressed && rectangle) return spanRect(rectangle.start, cell);
    return { x: cell.x, y: cell.y, width: 1, height: 1 };
}

/** Calls `listener` when a right drag began or ended. */
export function subscribeEraser(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** The layers a sample erases: every paintable tile layer with Shift or All layers. */
function layersOf(
    context: ToolContext,
    paint: PaintStroke,
    pointer: ToolPointer,
): readonly number[] {
    const all = pointer.modifiers.shift || context.options.allLayers === true;
    return all ? paint.paintableLayers : [paint.layerId];
}

function erase(paint: PaintStroke, layers: readonly number[], cells: readonly PixelPoint[]): void {
    for (const layer of layers) {
        for (const cell of cells) paint.set(cell.x, cell.y, 0, layer);
    }
}

export const eraserTool: ToolSpec = {
    id: "eraser",
    label: "Eraser",
    paints: true,
    hint: "Shift: all layers · Right drag: rectangle",
    options: [{ kind: "toggle", key: "allLayers", label: "All layers", default: false }],
    onDown(context, pointer) {
        const { paint } = context;
        // A drag whose commit was refused ended without `onUp` or `onCancel`.
        rectangle = null;
        if (!paint) return;
        if (pointer.button === "secondary") {
            rectangle = { start: pointer.cell, end: pointer.cell };
            changed();
            return;
        }
        erase(paint, layersOf(context, paint, pointer), pointer.cells);
    },
    onMove(context, pointer) {
        const { paint } = context;
        if (!paint) return;
        if (rectangle) {
            rectangle.end = pointer.cell;
            return;
        }
        erase(paint, layersOf(context, paint, pointer), pointer.cells);
    },
    onUp(context, pointer) {
        const { paint } = context;
        const drawn = rectangle;
        rectangle = null;
        changed();
        if (!paint || !drawn) return;
        const rect = spanRect(drawn.start, pointer.cell);
        const cells: PixelPoint[] = [];
        // Only the part inside the map: the rest is clipped anyway.
        const left = Math.max(rect.x, 0);
        const top = Math.max(rect.y, 0);
        const right = Math.min(rect.x + rect.width, paint.map.width);
        const bottom = Math.min(rect.y + rect.height, paint.map.height);
        for (let y = top; y < bottom; y++) {
            for (let x = left; x < right; x++) cells.push({ x, y });
        }
        erase(paint, layersOf(context, paint, pointer), cells);
    },
    onCancel() {
        rectangle = null;
        changed();
    },
};

export const tools: ToolSpec[] = [eraserTool];
