import { RotateCcwSquare, RotateCwSquare } from "lucide-react";
import type { Stamp } from "../../../core/cells";
import { pointsOnEllipse } from "../../../core/raster/ellipse";
import { pointsOnLine } from "../../../core/raster/line";
import type { PixelPoint } from "../../../core/raster/line";
import { sessionStore } from "../../state/session";
import type { PaintStroke, ToolAction, ToolModifiers, ToolSpec } from "../types";
import { withCapture } from "./capture";
import { currentStamp, currentStampStore } from "./currentStamp";
import { placedCells, separatePlacements, stampIsEmpty } from "./placement";

// The stamp brush (SPEC §4.3), Tiled's `StampBrush` (`src/tiled/stampbrush.cpp`, checked at
// v1.12.2) with the current stamp (`currentStamp.ts`). Its rail slot, key (B) and icon are
// planned in `planned.tools.ts`; the overlay preview is `stampPreview.overlay.ts`.
//
//   press, drag: the stamp at the pressed cell and at every cell crossed (later placements
//     over earlier ones; empty stamp cells leave the map)
//   Shift+press: a line of stamps from the last painted point to the pressed cell
//   Ctrl+Shift+press: an ellipse of stamps around the last painted point through the
//     pressed cell (`pointsOnEllipse` with the distances as radii)
//
// A line or an ellipse places its stamps as Tiled's `drawPreviewLayer` does
// (`separatePlacements`). With no last painted point on the map the press only sets it, as
// Tiled's Shift+click sets the line's start. Held on and released on another cell with Shift
// still down, the press also draws the shape from the pressed cell to the released one, a line
// or, with Ctrl too, an ellipse (Tiled's StartSet release; Shift let go returns Tiled's brush to
// free, and the release draws nothing). Each stroke is one history entry; the last cell it
// painted (or set) is the next one's start, in this project.
//
// A right drag captures a stamp from the map (`capture.ts`). The context bar's buttons rotate
// and flip the stamp (`stamp.commands.ts`).

/**
 * The stamp transform buttons of the context bar (DESIGN §7), for every tool that paints the
 * stamp: the stamp brush, the bucket and shape fill (TE-019).
 */
export const STAMP_TRANSFORM_ACTIONS: readonly ToolAction[] = [
    { command: "stamp.rotateLeft", label: "Rotate Stamp Left", icon: RotateCcwSquare },
    { command: "stamp.rotateRight", label: "Rotate Stamp Right", icon: RotateCwSquare },
    { command: "stamp.flipHorizontal", label: "Flip H" },
    { command: "stamp.flipVertical", label: "Flip V" },
];

/** How a press of the brush paints, by its modifiers. */
export type BrushMode = "free" | "line" | "ellipse";

/** The mode of a press with `modifiers` (Tiled's `updateBrushBehavior`). */
export function brushMode(modifiers: Readonly<ToolModifiers>): BrushMode {
    if (!modifiers.shift) return "free";
    return modifiers.ctrl ? "ellipse" : "line";
}

/** The points of the shape of `mode` from `from` through `to`. */
export function shapePoints(
    mode: "line" | "ellipse",
    from: PixelPoint,
    to: PixelPoint,
): PixelPoint[] {
    return mode === "line"
        ? pointsOnLine(from, to)
        : pointsOnEllipse(from, Math.abs(from.x - to.x), Math.abs(from.y - to.y));
}

/** The stroke in progress: the stamp at its press and, for a line or an ellipse, its start. */
interface BrushStroke {
    readonly stamp: Stamp;
    /**
     * The pressed cell of a press with Shift: a release on another cell with Shift still held
     * draws the shape of the modifiers then from it. Null for a free press.
     */
    readonly anchor: PixelPoint | null;
    /** The last cell the stroke painted, or set as a start. */
    last: PixelPoint;
}

/** The last painted point, by map: where a line starts and an ellipse is centred. */
let lastPainted: { mapId: string; cell: PixelPoint } | null = null;
let stroke: BrushStroke | null = null;
const listeners = new Set<() => void>();
const changed = () => {
    for (const listener of [...listeners]) listener();
};

/** The last painted point of map `mapId`, or null. */
export function lastPaintedPoint(mapId: string): PixelPoint | null {
    return lastPainted?.mapId === mapId ? lastPainted.cell : null;
}

/** Forgets the last painted point (a test starts a new map). */
export function resetStampBrush(): void {
    lastPainted = null;
    changed();
}

/**
 * Where the stamp is placed if the pointer is pressed, or released, on `cell` now, with
 * `modifiers` held: the points of the stamp's anchor. `pressed` says a stroke of the brush is
 * in progress. Empty when nothing would be painted (no stamp, or the first press of a line or
 * an ellipse, which only sets its start).
 */
export function brushPlacements(
    mapId: string,
    cell: PixelPoint,
    modifiers: Readonly<ToolModifiers>,
    pressed: boolean,
): PixelPoint[] {
    const current = pressed ? stroke : null;
    const stamp = current ? current.stamp : currentStamp();
    if (!stamp || stampIsEmpty(stamp)) return [];
    if (current) {
        const { anchor } = current;
        const mode = brushMode(modifiers);
        if (!anchor || mode === "free") return [cell];
        if (anchor.x === cell.x && anchor.y === cell.y) return [];
        return separatePlacements(stamp, shapePoints(mode, anchor, cell));
    }
    const mode = brushMode(modifiers);
    if (mode === "free") return [cell];
    const start = lastPaintedPoint(mapId);
    return start ? separatePlacements(stamp, shapePoints(mode, start, cell)) : [];
}

/** Calls `listener` when the brush's own state changed (a stroke began or ended). */
export function subscribeStampBrush(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Paints `stamp` with its anchor on each of `points`, in order. */
function place(paint: PaintStroke, stamp: Stamp, points: readonly PixelPoint[]): void {
    for (const point of points) {
        for (const cell of placedCells(stamp, point)) paint.set(cell.x, cell.y, cell.value);
    }
}

export const stampTool: ToolSpec = withCapture({
    id: "stamp",
    label: "Stamp Brush",
    paints: true,
    hint: "Shift: line · Ctrl+Shift: ellipse",
    actions: STAMP_TRANSFORM_ACTIONS,
    readouts: [
        {
            key: "size",
            label: "Stamp size",
            read() {
                const stamp = currentStamp();
                return stamp ? `${stamp.width} × ${stamp.height}` : "—";
            },
            subscribe: (listener) => currentStampStore.subscribe(listener),
        },
    ],
    onDown(context, pointer) {
        // A press that aborted its commit left its stroke behind; this one replaces it.
        stroke = null;
        const { paint } = context;
        if (!paint || pointer.button !== "primary") return;
        const stamp = currentStamp();
        if (!stamp || stampIsEmpty(stamp)) {
            context.feedback("No stamp");
            return;
        }
        const mode = brushMode(pointer.modifiers);
        if (mode === "free") {
            stroke = { stamp, anchor: null, last: pointer.cell };
            place(paint, stamp, [pointer.cell]);
        } else {
            stroke = { stamp, anchor: pointer.cell, last: pointer.cell };
            const start = lastPaintedPoint(paint.mapId);
            if (start) {
                place(
                    paint,
                    stamp,
                    separatePlacements(stamp, shapePoints(mode, start, pointer.cell)),
                );
            }
        }
        changed();
    },
    onMove(context, pointer) {
        const { paint } = context;
        if (!paint || !stroke || stroke.anchor) return;
        place(paint, stroke.stamp, pointer.cells);
        stroke.last = pointer.cell;
    },
    onUp(context, pointer) {
        const { paint } = context;
        const anchor = stroke?.anchor;
        const mode = brushMode(pointer.modifiers);
        if (!paint || !stroke || !anchor || mode === "free") return;
        if (anchor.x === pointer.cell.x && anchor.y === pointer.cell.y) return;
        const points = shapePoints(mode, anchor, pointer.cell);
        place(paint, stroke.stamp, separatePlacements(stroke.stamp, points));
        stroke.last = pointer.cell;
    },
    onCommit(context) {
        const last = stroke?.last;
        stroke = null;
        if (last) lastPainted = { mapId: context.map.id, cell: last };
        changed();
    },
    onCancel() {
        stroke = null;
        changed();
    },
});

// Another project in the window: its maps may carry the same ids (the same file reopened).
let project = sessionStore.getState().session.project;
sessionStore.subscribe((state) => {
    if (state.session.project === project) return;
    project = state.session.project;
    if (lastPainted) resetStampBrush();
});

export const tools: ToolSpec[] = [stampTool];
