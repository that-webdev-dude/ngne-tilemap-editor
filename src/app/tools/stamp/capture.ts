import type { CellRect, CellStore, Stamp } from "../../../core/cells";
import { effectiveValues, findLayer } from "../../../core/model";
import type { ProjectMap } from "../../../core/model";
import type { PixelPoint } from "../../../core/raster/line";
import { clipToMap } from "../cellOutline";
import { spanRect } from "../eraser/eraser.tools";
import { REFUSALS, resolvePaintTarget } from "../paintTarget";
import type { ToolButton, ToolContext, ToolPointer, ToolSpec } from "../types";
import { setCurrentStamp } from "./currentStamp";

// Capture of a stamp from the map (SPEC §4.2), Tiled's `CaptureStampHelper`
// (`src/tiled/capturestamphelper.cpp`, checked at v1.12.2). A tool enables it by wrapping its
// spec in `withCapture`: the stamp brush here, the bucket and shape fill (TE-019).
//
//   right press (without Ctrl, which Tiled keeps for picking a layer), drag: a rectangle of cells from the pressed cell to the pointer's, both
//     included (`QRect::span`), outlined on the overlay (`capturePreview.overlay.ts`)
//   release: the cells of the active tile layer in that rectangle, inside the map, become the
//     current stamp, cut to the bounding box of its non-empty cells (Tiled's
//     `normalizeTileLayerPositionsAndMapSize`); empty cells inside it stay empty; a rectangle
//     with none leaves no stamp. The active tool stays: it uses the stamp (Tiled's
//     `MapEditor::setStamp` keeps a tool that uses the selected tiles).
//   Shift held at the release: the rectangle is also erased, one history entry ("Cut"), on a
//     visible, unlocked layer (SPEC §4.1); on another the stamp is captured and nothing erased.
//
// The capture reads the layer and paints nothing, so it works on a locked layer, as Tiled's
// does; on a hidden one (or one under a hidden group) Tiled hides its brush and takes no press,
// so the press is refused with the status-bar message of SPEC §4.1. A right click without a
// drag captures one cell.

/** The label of the history entry of a capture with Shift. */
export const CUT_LABEL = "Cut";

/** The capture in progress: its pressed cell. */
let capture: { start: PixelPoint } | null = null;
const listeners = new Set<() => void>();
const changed = () => {
    for (const listener of [...listeners]) listener();
};

/** The rectangle of the capture in progress, the pointer on `cell`; null while none is. */
export function captureArea(cell: PixelPoint): CellRect | null {
    return capture ? spanRect(capture.start, cell) : null;
}

/** Calls `listener` when a capture began or ended. */
export function subscribeCapture(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * The stamp of the cells of `store` in `rect`: cut to the bounding box of the non-empty cells,
 * empty cells inside it kept; null when every cell is empty. Pure.
 */
export function captureStamp(store: Pick<CellStore, "get">, rect: CellRect): Stamp | null {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x; x < rect.x + rect.width; x++) {
            if (store.get(x, y) === 0) continue;
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x);
            bottom = Math.max(bottom, y);
        }
    }
    if (right < left) return null;
    const width = right - left + 1;
    const height = bottom - top + 1;
    const cells = new Uint32Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) cells[y * width + x] = store.get(left + x, top + y);
    }
    return { width, height, cells };
}

/** Empties `rect` of the active layer as one history entry; false when the layer refuses. */
function cut(context: ToolContext, rect: CellRect): boolean {
    const target = resolvePaintTarget(context.session);
    if (!target) return false;
    if ("refused" in target) {
        context.feedback(target.refused);
        return false;
    }
    const transaction = context.history.begin(target);
    try {
        for (let y = rect.y; y < rect.y + rect.height; y++) {
            for (let x = rect.x; x < rect.x + rect.width; x++) transaction.set(x, y, 0);
        }
    } catch (error) {
        transaction.abort();
        throw error;
    }
    // The history tells the viewport about the entry it records.
    transaction.commit(CUT_LABEL);
    return true;
}

/** The tile layer of `context`'s stroke, or null. */
function tileLayerOf(map: ProjectMap, layerId: number | null) {
    const entry = layerId === null ? null : findLayer(map, layerId);
    return entry?.layer.type === "tile" ? { layer: entry.layer, ancestors: entry.ancestors } : null;
}

/** Begins a capture at `pointer`, unless Tiled would not (Ctrl, a hidden layer). */
function beginCapture(context: ToolContext, pointer: ToolPointer): void {
    // A capture whose release never came (a refused commit) is replaced.
    capture = null;
    if (pointer.modifiers.ctrl) return;
    const entry = tileLayerOf(context.map, context.layerId);
    if (!entry) {
        context.feedback(REFUSALS.notTile);
        return;
    }
    if (!effectiveValues(entry.layer, entry.ancestors).visible) {
        context.feedback(REFUSALS.hidden);
        return;
    }
    capture = { start: pointer.cell };
    changed();
}

/** Ends the capture in progress at `pointer`: the stamp and the cut. */
function endCapture(context: ToolContext, pointer: ToolPointer): void {
    const started = capture;
    capture = null;
    changed();
    const entry = tileLayerOf(context.map, context.layerId);
    if (!started || !entry) return;
    const rect = clipToMap(spanRect(started.start, pointer.cell), context.map);
    const stamp = rect ? captureStamp(entry.layer.cells, rect) : null;
    // A cut whose entry cannot be recorded throws before the stamp changes: no capture.
    if (rect && pointer.modifiers.shift) cut(context, rect);
    setCurrentStamp(stamp);
}

/** Whether the stroke of `context` is a capture: one begun by the right button. */
const capturing = (context: ToolContext) => context.button === "secondary";

/**
 * `spec` with capture on the right button: a right press, drag and release capture a stamp
 * as above and reach none of the spec's handlers; a left one reaches them as before. The
 * spec paints on the left button only.
 */
export function withCapture(spec: ToolSpec): ToolSpec {
    const paints = spec.paints;
    return {
        ...spec,
        paints: (button: ToolButton) =>
            button !== "secondary" &&
            (typeof paints === "function" ? paints(button) : paints === true),
        onDown(context, pointer) {
            if (!capturing(context)) return spec.onDown?.(context, pointer);
            beginCapture(context, pointer);
        },
        onMove(context, pointer) {
            if (!capturing(context)) spec.onMove?.(context, pointer);
        },
        onUp(context, pointer) {
            if (!capturing(context)) return spec.onUp?.(context, pointer);
            endCapture(context, pointer);
        },
        onCancel(context) {
            if (!capturing(context)) return spec.onCancel?.(context);
            capture = null;
            changed();
        },
        onCommit(context, recorded) {
            if (!capturing(context)) spec.onCommit?.(context, recorded);
        },
        onKey(context, key) {
            return capturing(context) ? false : (spec.onKey?.(context, key) ?? false);
        },
    };
}
