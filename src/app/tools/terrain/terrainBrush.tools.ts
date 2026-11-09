import type { Region } from "../../../core/fill";
import { findLayer } from "../../../core/model";
import type { ProjectMap, TerrainSetType } from "../../../core/model";
import type { PixelPoint } from "../../../core/raster/line";
import {
    brushStep,
    brushTargetAt,
    clockSeed,
    effectiveTypeForColor,
    wangIdOfCell,
    xorshift32,
} from "../../../core/terrain";
import type { BrushStep, BrushTarget, WangIndex } from "../../../core/terrain";
import { sessionStore } from "../../state/session";
import type { PaintStroke, ToolContext, ToolModifiers, ToolPointer, ToolSpec } from "../types";
import { brushSource } from "./brushSource";
import type { BrushTerrain } from "./brushSource";

// The terrain brush (SPEC §5.3), Tiled's `WangBrush` (`src/tiled/wangbrush.cpp`, tag v1.12.2)
// with the set and terrain of `brushTerrain.ts` (through `brushSource.ts`); the painting itself is `core/terrain/brush.ts`.
// Its rail slot, key (T) and icon are planned in `planned.tools.ts`; the context bar is
// `ui/terrains/terrainBrush.contextbar.tsx`, the overlay `terrainBrush.overlay.ts`.
//
//   press: paints the corner, edge or (full tile mode) cell under the pointer
//   drag: paints at every new target, the points between joined as Tiled joins them
//   Shift+press: a line from the last painted point (the first after the tool is selected
//     only sets the start; Tiled's `mLineStartSet`)
//   Ctrl: inverts the context bar's Full tile while held; Alt: rotational symmetry; both
//     repaint at the pointer when they change during a drag; Shift pressed during a drag ends
//     its painting (Tiled's brush turns to its line behaviour)
//   right click: picks the terrain under the pointer into the context bar
//
// Each step runs the filler with corrections on the layer as the steps before it left it;
// cells it cannot resolve stay unchanged and are drawn red. The tile selection does not clip
// the brush (Tiled's brush paints through `PaintTileLayer`, without `TilePainter`). A stroke
// is one history entry.

export const TERRAIN_TOOL_ID = "terrain";

/** Breaks the filler's ties (SPEC §5.2): seeded from the clock once per session. */
const random = xorshift32(clockSeed());

/** The brush's modes for `modifiers` held (Tiled's `modifiersChanged`). */
export function brushModes(
    options: ToolContext["options"],
    modifiers: Readonly<ToolModifiers>,
): { tileMode: boolean; symmetry: boolean; line: boolean } {
    return {
        tileMode: (options.fullTile === true) !== modifiers.ctrl,
        symmetry: modifiers.alt,
        line: modifiers.shift,
    };
}

/** The position `position` (map pixels) in cells of `map`, with its fraction. */
export function cellPosition(
    map: Pick<ProjectMap, "tileWidth" | "tileHeight">,
    position: { x: number; y: number },
): [number, number] {
    return [position.x / map.tileWidth, position.y / map.tileHeight];
}

/** The painting mode of `brush`: Tiled's `effectiveTypeForColor`. */
export const brushMode = (brush: BrushTerrain): TerrainSetType =>
    effectiveTypeForColor(brush.analysis, brush.color);

/** A drag of the brush in progress. */
interface Stroke {
    readonly brush: BrushTerrain;
    readonly mode: TerrainSetType;
    /** A line press (Shift): it paints once and its drag paints nothing. */
    readonly line: boolean;
    tileMode: boolean;
    symmetry: boolean;
    /** Tiled's `mPrevPaintPoint` and `mPaintPoint` / `mWangIndex`. */
    previous: PixelPoint | null;
    current: BrushTarget;
    /**
     * The index the pointer picks outside full tile mode, kept while full tile mode is on
     * (Tiled's `mWangIndex` is not updated then): where an edge drag goes on when Ctrl is let go.
     */
    edgeIndex: WangIndex | null;
    /**
     * Shift went down during the drag: Tiled's brush turns to its line behaviour and paints no
     * more until the next press.
     */
    halted: boolean;
    /** The line start before the press: put back when the stroke is cancelled. */
    readonly startBefore: { mapId: string; point: PixelPoint } | null;
    /** The pointer's last position, in cells. */
    at: [number, number];
    /** What the last step could not resolve. */
    invalid: Region;
}

let stroke: Stroke | null = null;
/** Tiled's `mLineStartPos`, by map: set by every step, forgotten when the tool is selected. */
let lineStart: { mapId: string; point: PixelPoint } | null = null;
const listeners = new Set<() => void>();
const changed = () => {
    for (const listener of [...listeners]) listener();
};

/** Where a Shift+press on map `mapId` draws its line from; null when it would set it. */
export function brushLineStart(mapId: string): PixelPoint | null {
    return lineStart?.mapId === mapId ? lineStart.point : null;
}

/** The drag in progress, as the overlay draws it; null when none. */
export function brushStroke(): {
    readonly current: BrushTarget;
    readonly tileMode: boolean;
    readonly symmetry: boolean;
    readonly invalid: Region;
} | null {
    return stroke;
}

/** Calls `listener` when a stroke began, painted or ended, or the line start changed. */
export function subscribeTerrainBrush(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Forgets the line start: when the tool is selected again (Tiled's `WangBrush::activate`;
 * `terrainBrush.overlay.ts` follows the active tool, which this module cannot import) and when
 * a test starts a new map.
 */
export function resetTerrainBrush(): void {
    stroke = null;
    lineStart = null;
    changed();
}

/** Runs one step on the stroke's layer and writes what it resolved. */
function paintStep(
    paint: PaintStroke,
    brush: BrushTerrain,
    step: Omit<BrushStep, "mode" | "color">,
) {
    const result = brushStep(
        {
            analysis: brush.analysis,
            back: (x, y) => paint.get(x, y),
            width: paint.map.width,
            height: paint.map.height,
            random,
        },
        { ...step, mode: brushMode(brush), color: brush.color },
    );
    for (const { x, y, value } of result.cells) paint.set(x, y, value);
    lineStart = { mapId: paint.mapId, point: step.to.point };
    return result;
}

const samePoint = (a: PixelPoint, b: PixelPoint) => a.x === b.x && a.y === b.y;

/**
 * The drag of `current` reached `(cx, cy)` with `modifiers` held: paints when the target or a
 * mode changed (Tiled's `mouseMoved` and `modifiersChanged`, then `stateChanged`).
 */
function follow(
    context: ToolContext,
    current: Stroke,
    at: [number, number],
    modifiers: Readonly<ToolModifiers>,
): boolean {
    const { paint } = context;
    if (!paint || current.line) return false;
    if (modifiers.shift) current.halted = true;
    if (current.halted) return false;
    current.at = at;
    const { tileMode, symmetry } = brushModes(context.options, modifiers);
    const target = brushTargetAt(
        current.mode,
        tileMode,
        at[0],
        at[1],
        tileMode ? null : { ...current.current, index: current.current.index ?? current.edgeIndex },
    );
    const moved =
        !samePoint(target.point, current.current.point) || target.index !== current.current.index;
    if (!moved && tileMode === current.tileMode && symmetry === current.symmetry) return false;
    if (moved) {
        current.previous = current.current.point;
        current.current = target;
    }
    current.tileMode = tileMode;
    current.symmetry = symmetry;
    const result = paintStep(paint, current.brush, {
        tileMode,
        behaviour: "drag",
        from: current.previous,
        to: current.current,
        symmetry,
    });
    current.current = { point: current.current.point, index: result.index };
    if (!tileMode) current.edgeIndex = result.index;
    current.invalid = result.invalid;
    changed();
    return true;
}

/** Right click: the terrain at the index under the pointer becomes the brush's. */
function sample(context: ToolContext, pointer: ToolPointer): void {
    const brush = brushSource.current();
    if (!brush || context.layerId === null) return;
    const [cx, cy] = cellPosition(context.map, pointer.position);
    const target = brushTargetAt(brushMode(brush), false, cx, cy);
    if (target.index === null) return;
    const found = findLayer(context.map, context.layerId);
    const layer = found?.layer.type === "tile" ? found.layer : null;
    const { x, y } = target.point;
    const inside = x >= 0 && y >= 0 && x < context.map.width && y < context.map.height;
    const value = layer && inside ? layer.cells.get(x, y) : 0;
    const wangId = new Uint8Array(8);
    wangIdOfCell(brush.analysis, value, wangId);
    brushSource.choose(wangId[target.index]!);
}

export const terrainBrushTool: ToolSpec = {
    id: TERRAIN_TOOL_ID,
    label: "Terrain Brush",
    paints: (button) => button === "primary",
    clipsToSelection: false,
    hint: "Shift: line · Ctrl: full tile · Alt: symmetry · Right click: pick terrain",
    options: [{ kind: "toggle", key: "fullTile", label: "Full tile", default: false }],
    onDown(context, pointer) {
        // A press whose commit was refused left its stroke behind; this one replaces it.
        stroke = null;
        if (pointer.button === "secondary") {
            const { shift, ctrl, alt, meta } = pointer.modifiers;
            if (!shift && !ctrl && !alt && !meta) sample(context, pointer);
            return;
        }
        const { paint } = context;
        if (!paint) return;
        const brush = brushSource.current();
        if (!brush) {
            context.feedback("No terrain set");
            return;
        }
        const mode = brushMode(brush);
        const { tileMode, symmetry, line } = brushModes(context.options, pointer.modifiers);
        const at = cellPosition(paint.map, pointer.position);
        const target = brushTargetAt(mode, tileMode, at[0], at[1]);
        const start = brushLineStart(paint.mapId);
        stroke = {
            brush,
            mode,
            line,
            tileMode,
            symmetry,
            previous: null,
            current: target,
            edgeIndex: tileMode ? brushTargetAt(mode, false, at[0], at[1]).index : target.index,
            halted: false,
            startBefore: lineStart,
            at,
            invalid: [],
        };
        if (line && !start) {
            lineStart = { mapId: paint.mapId, point: target.point };
        } else {
            const result = paintStep(paint, brush, {
                tileMode,
                behaviour: line ? "line" : "single",
                from: line ? start : null,
                to: target,
                symmetry,
            });
            stroke.invalid = result.invalid;
            stroke.current = { point: target.point, index: result.index };
            if (!tileMode) stroke.edgeIndex = result.index;
        }
        changed();
    },
    onMove(context, pointer) {
        if (!stroke || pointer.button !== "primary") return;
        follow(context, stroke, cellPosition(context.map, pointer.position), pointer.modifiers);
    },
    onKey(context, key) {
        if (!stroke || !["Ctrl", "Alt", "Shift"].includes(key.key)) return false;
        follow(context, stroke, stroke.at, key.modifiers);
        return true;
    },
    onCommit() {
        stroke = null;
        changed();
    },
    onCancel() {
        if (stroke) lineStart = stroke.startBefore;
        stroke = null;
        changed();
    },
};

// Another project in the window: its maps may carry the same ids (the same file reopened).
let project = sessionStore.getState().session.project;
sessionStore.subscribe((state) => {
    if (state.session.project === project) return;
    project = state.session.project;
    if (lineStart) resetTerrainBrush();
});

export const tools: ToolSpec[] = [terrainBrushTool];
