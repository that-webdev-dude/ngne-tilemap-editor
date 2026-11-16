import type { Region } from "../../../core/fill";
import { findLayer } from "../../../core/model";
import type { ProjectMap, TerrainSetType } from "../../../core/model";
import type { PixelPoint } from "../../../core/raster/line";
import {
    WANG_INDEXES,
    brushIndexAt,
    brushStep,
    brushTargetAt,
    clockSeed,
    effectiveTypeForColor,
    isCorner,
    wangIdOfCell,
    xorshift32,
} from "../../../core/terrain";
import type {
    BrushBehaviour,
    BrushStep,
    BrushStepResult,
    BrushTarget,
    TerrainFillerOptions,
    WangIndex,
} from "../../../core/terrain";
import { sessionStore } from "../../state/session";
import type { PaintStroke, ToolContext, ToolModifiers, ToolPointer, ToolSpec } from "../types";
import { brushSource } from "./brushSource";
import type { BrushTerrain } from "./brushSource";

// The terrain brush tool (SPEC §5.3; DESIGN for its rail slot, context bar and overlay). Its
// overlay is `terrainBrush.overlay.ts`, its terrain `brushSource.ts`. When another project is
// opened in the window, a line start it kept is forgotten (its maps may carry the same ids).
//
//   press: paints the target under the pointer (corner, edge, or the whole cell in full tile
//     mode), with the 180° symmetric target too while Alt is held
//   drag: each new target joined to the one before (`brushStep`); Ctrl pressed or let go
//     switches full tile mode for the rest of the drag; Shift pressed ends its painting
//   Shift+press: a line from the last painted point; with none since the tool was selected,
//     the press only sets it
//   right press without modifiers: the terrain under the pointer becomes the brush's
//
// Each stroke is one history entry (the pipeline's transaction). Every paint step breaks its
// ties with a generator seeded from `brushStepSeed`, which then changes, so the overlay's
// preview between strokes (`previewStep`) uses the generator the next press will use.

export const TERRAIN_TOOL_ID = "terrain";

/** The seed of the next paint step. */
let seed = clockSeed();

/** The stroke in progress. */
interface Stroke {
    /** The set and terrain at the press. */
    readonly brush: BrushTerrain;
    /** The painting mode of the terrain in its set. */
    readonly mode: TerrainSetType;
    /** The Full tile option at the press; Ctrl inverts it. */
    readonly option: boolean;
    /** The index under the pointer at the press, outside full tile mode. */
    readonly pressIndex: WangIndex | null;
    tileMode: boolean;
    symmetry: boolean;
    /** A drag goes on painting: not after a line press, nor once Shift was pressed. */
    painting: boolean;
    /** The target the drag is at: painted, or where a change of full tile mode put it. */
    current: BrushTarget;
    /** The last point painted, or set as the line's start; null when none. */
    last: PixelPoint | null;
    /** The last index painted outside full tile mode. */
    lastIndex: WangIndex | null;
    /** The pointer's last position, in cells with their fraction. */
    position: [number, number];
    /** What the last paint step left invalid. */
    invalid: Region;
}

let stroke: Stroke | null = null;
/** Where the next Shift+press draws its line from, by map. */
let lineStart: { mapId: string; point: PixelPoint } | null = null;
const listeners = new Set<() => void>();
const changed = () => {
    for (const listener of [...listeners]) listener();
};

/**
 * The seed of the generator the next paint step breaks its ties with (SPEC §5.2). It starts
 * from the clock and changes after each step.
 */
export function brushStepSeed(): number {
    return seed;
}

/** Sets the seed of the next paint step: tests make the brush deterministic. */
export function seedTerrainBrush(next: number): void {
    seed = next >>> 0;
}

/** The generator of the next paint step; the seed moves on. */
function stepRandom() {
    const random = xorshift32(seed);
    seed = xorshift32(seed)();
    return random;
}

/**
 * What a press with `step` would do on the layer `options.back` holds, without painting: with
 * the generator the next press will use, so the press leaves invalid exactly what the overlay
 * showed (SPEC §5.3, last item).
 */
export function previewStep(
    options: Omit<TerrainFillerOptions, "corrections" | "random">,
    step: BrushStep,
): BrushStepResult {
    return brushStep({ ...options, random: xorshift32(seed) }, step);
}

/** The brush's modes with `modifiers` held and the context bar's `options` (SPEC §5.3). */
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

/** The painting mode of `brush` (SPEC §5.3, first item). */
export function brushMode(brush: BrushTerrain): TerrainSetType {
    return effectiveTypeForColor(brush.analysis, brush.color);
}

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
    if (!stroke) return null;
    const { current, tileMode, symmetry, invalid } = stroke;
    return { current, tileMode, symmetry, invalid };
}

/** Calls `listener` when a stroke began, painted or ended, or the line start changed. */
export function subscribeTerrainBrush(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Forgets the stroke and the line start: called when the tool is selected again and when a
 * test starts a new map.
 */
export function resetTerrainBrush(): void {
    stroke = null;
    lineStart = null;
    changed();
}

/** Runs one paint step of `current` on the stroke's cells. */
function paintStep(
    paint: PaintStroke,
    current: Stroke,
    behaviour: BrushBehaviour,
    from: PixelPoint | null,
    to: BrushTarget,
    tileMode: boolean,
): void {
    const result = brushStep(
        {
            analysis: current.brush.analysis,
            back: (x, y) => paint.get(x, y),
            width: paint.map.width,
            height: paint.map.height,
            random: stepRandom(),
        },
        {
            mode: current.mode,
            tileMode,
            behaviour,
            from,
            to,
            color: current.brush.color,
            symmetry: current.symmetry,
        },
    );
    for (const { x, y, value } of result.cells) paint.set(x, y, value);
    current.invalid = result.invalid;
    if (!tileMode && result.index !== null) current.lastIndex = result.index;
}

const sameTarget = (a: BrushTarget, b: BrushTarget) =>
    a.index === b.index && a.point.x === b.point.x && a.point.y === b.point.y;

/**
 * Switches the stroke's full tile mode. Leaving it, the drag goes on with the index it last
 * painted outside full tile mode, or else the one under the pointer at the press (SPEC §5.3).
 */
function setTileMode(current: Stroke, tileMode: boolean): boolean {
    if (current.tileMode === tileMode) return false;
    current.tileMode = tileMode;
    const [cx, cy] = current.position;
    const index = current.lastIndex ?? current.pressIndex;
    if (tileMode || index === null || isCorner(index)) {
        current.current = brushTargetAt(current.mode, tileMode, cx, cy);
    } else {
        current.current = { point: { x: Math.floor(cx), y: Math.floor(cy) }, index };
    }
    return true;
}

/** Follows the modifiers held during a stroke; true when the stroke changed. */
function follow(current: Stroke, modifiers: Readonly<ToolModifiers>): boolean {
    let different = false;
    // Shift pressed during a drag ends its painting, as in Tiled.
    if (modifiers.shift && current.painting) {
        current.painting = false;
        different = true;
    }
    if (current.symmetry !== modifiers.alt) {
        current.symmetry = modifiers.alt;
        different = true;
    }
    return setTileMode(current, current.option !== modifiers.ctrl) || different;
}

/** Right press: the terrain under the pointer becomes the brush's (SPEC §5.3). */
function sampleTerrain(context: ToolContext, pointer: ToolPointer): void {
    const { shift, ctrl, alt, meta } = pointer.modifiers;
    if (shift || ctrl || alt || meta || !pointer.inside) return;
    const brush = brushSource.current();
    if (!brush || context.layerId === null) return;
    const layer = findLayer(context.map, context.layerId)?.layer;
    if (layer?.type !== "tile") return;
    const { x, y } = pointer.cell;
    const wangId = new Uint8Array(WANG_INDEXES);
    wangIdOfCell(brush.analysis, layer.cells.get(x, y), wangId);
    const [cx, cy] = cellPosition(context.map, pointer.position);
    const index =
        brushIndexAt(brush.analysis.type, cx - x, cy - y) ??
        brushIndexAt("corner", cx - x, cy - y)!;
    // An empty cell or a tile outside the set has no terrain there: "erase terrain".
    brushSource.choose(wangId[index]!);
}

export const terrainBrushTool: ToolSpec = {
    id: TERRAIN_TOOL_ID,
    label: "Terrain Brush",
    paints: (button) => button === "primary",
    clipsToSelection: false,
    hint: "Shift: line · Ctrl: full tile · Alt: symmetry · Right click: pick terrain",
    options: [{ kind: "toggle", key: "fullTile", label: "Full tile", default: false }],
    onDown(context, pointer) {
        // A press that aborted its commit left its stroke behind; this one replaces it.
        stroke = null;
        if (pointer.button === "secondary") {
            sampleTerrain(context, pointer);
            return;
        }
        const { paint } = context;
        if (!paint) return;
        const brush = brushSource.current();
        if (!brush) {
            context.feedback("No terrain set");
            return;
        }
        const position = cellPosition(context.map, pointer.position);
        const [cx, cy] = position;
        const { tileMode, symmetry, line } = brushModes(context.options, pointer.modifiers);
        const mode = brushMode(brush);
        const pressed = brushTargetAt(mode, false, cx, cy);
        // A line of a mixed set is painted in full tile mode, so it ends at the cell.
        const lineTileMode = tileMode || mode === "mixed";
        const target = brushTargetAt(mode, line ? lineTileMode : tileMode, cx, cy);
        const current: Stroke = {
            brush,
            mode,
            option: context.options.fullTile === true,
            pressIndex: pressed.index,
            tileMode,
            symmetry,
            painting: !line,
            current: target,
            last: null,
            lastIndex: null,
            position,
            invalid: [],
        };
        stroke = current;
        if (line) {
            const start = brushLineStart(paint.mapId);
            // With no start yet the press only sets it (Tiled).
            if (start) paintStep(paint, current, "line", start, target, lineTileMode);
            current.last = target.point;
        } else if (tileMode || target.index !== null) {
            paintStep(paint, current, "single", null, target, tileMode);
            current.last = target.point;
        }
        changed();
    },
    onMove(context, pointer) {
        const current = stroke;
        if (!current) return;
        current.position = cellPosition(context.map, pointer.position);
        const different = follow(current, pointer.modifiers);
        const { paint } = context;
        if (!current.painting || !paint) {
            if (different) changed();
            return;
        }
        const [cx, cy] = current.position;
        const drag = current.mode === "edge" && !current.tileMode ? current.current : null;
        const next = brushTargetAt(current.mode, current.tileMode, cx, cy, drag);
        if (sameTarget(next, current.current)) {
            if (different) changed();
            return;
        }
        const from = current.current.point;
        current.current = next;
        if (current.tileMode || next.index !== null) {
            paintStep(paint, current, "drag", from, next, current.tileMode);
            current.last = next.point;
        }
        changed();
    },
    onKey(_context, key) {
        const current = stroke;
        if (!current) return false;
        const different = follow(current, key.modifiers);
        if (different) changed();
        return different;
    },
    onCommit(context) {
        const last = stroke?.last;
        stroke = null;
        if (last) lineStart = { mapId: context.map.id, point: last };
        changed();
    },
    onCancel() {
        // The line start stays what it was before the stroke.
        stroke = null;
        changed();
    },
};

// Another project in the window: its maps may carry the same ids (the same file reopened).
let project = sessionStore.getState().session.project;
sessionStore.subscribe((state) => {
    if (state.session.project === project) return;
    project = state.session.project;
    if (lineStart) {
        lineStart = null;
        changed();
    }
});

export const tools: ToolSpec[] = [terrainBrushTool];
