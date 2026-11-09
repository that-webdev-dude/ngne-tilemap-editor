import type { Region } from "../../../core/fill";
import { findLayer } from "../../../core/model";
import { brushTargetAt, mirroredTarget } from "../../../core/terrain";
import type { BrushTarget } from "../../../core/terrain";
import { fillRects } from "../../overlay/draw";
import type { DeviceRect } from "../../overlay/gridLines";
import type { OverlayFrame, OverlayLayer } from "../../overlay/types";
import { historySteps } from "../../state/historySteps";
import { sessionStore } from "../../state/session";
import { toolState } from "../activeTool";
import { toolPipeline } from "../appPipeline";
import { cellDeviceRect, outlineRects } from "../cellOutline";
import { heldModifiers, subscribeHeldModifiers } from "../heldModifiers";
import { brushTerrain, subscribeBrushTerrain } from "./brushTerrain";
import {
    TERRAIN_TOOL_ID,
    brushLineStart,
    brushMode,
    brushModes,
    brushStepSeed,
    brushStroke,
    cellPosition,
    previewStep,
    resetTerrainBrush,
    subscribeTerrainBrush,
} from "./terrainBrush.tools";

// The terrain brush on the overlay (DESIGN §4): the corner it paints as a 6 px `--accent`
// square on the vertex, the edge as a 2 px bar along it, and in full tile mode the cell with a
// 1 px `--accent` outline, at the mirrored place too with symmetry; the cells the filler cannot
// resolve with a 35% `--danger` fill. While a drag is in progress it shows the drag's target
// and what its last step left invalid; between strokes it shows what a press there would do,
// the filler run on the layer as it is with the press's own generator (`previewStep`), so the
// press leaves invalid what the preview showed (Tiled's brush preview, `WangBrush::updateBrush`).

/** Side of the corner mark and width of the edge bar, CSS px (DESIGN §4). */
const CORNER_MARK = 6;
const EDGE_BAR = 2;
/** The fill of cells that cannot be resolved (DESIGN §4). */
export const INVALID_ALPHA = 0.35;

/** What the overlay shows for the brush. */
interface BrushPreview {
    readonly targets: readonly BrushTarget[];
    readonly tileMode: boolean;
    readonly invalid: Region;
}

/** The last preview computed between strokes, by what it depends on. */
let cached: { key: string; preview: BrushPreview } | null = null;

/** What a press at the cursor would paint and leave invalid, with the modifiers held now. */
function hoverPreview(frame: OverlayFrame, at: [number, number]): BrushPreview | null {
    const brush = brushTerrain();
    if (!brush) return null;
    const { map } = frame;
    const { session } = sessionStore.getState();
    const layerId = session.perMap.get(map.id)?.activeLayerId ?? null;
    const found = layerId === null ? undefined : findLayer(map, layerId);
    const layer = found?.layer.type === "tile" ? found.layer : null;
    if (!layer) return null;
    const tool = toolState.active();
    const options = tool ? toolState.options(tool) : {};
    const { tileMode, symmetry, line } = brushModes(options, heldModifiers());
    const mode = brushMode(brush);
    const target = brushTargetAt(mode, tileMode, at[0], at[1]);
    const start = line ? brushLineStart(map.id) : null;
    const targets = symmetry
        ? [target, mirroredTarget(target, tileMode, map.width, map.height)]
        : [target];
    const key = JSON.stringify([
        historySteps.getState().step,
        map.id,
        layerId,
        brush.tileset.id,
        brush.setIndex,
        brush.color,
        tileMode,
        symmetry,
        line,
        start,
        target,
        brushStepSeed(),
    ]);
    if (cached?.key === key) return cached.preview;
    let invalid: Region = [];
    // A Shift+press with no line start only sets it.
    if (!line || start) {
        // With the next press's generator: ties decide what corrections leave invalid.
        invalid = previewStep(
            {
                analysis: brush.analysis,
                back: (x, y) => layer.cells.get(x, y),
                width: map.width,
                height: map.height,
            },
            {
                mode,
                tileMode,
                behaviour: line ? "line" : "single",
                from: start,
                to: target,
                color: brush.color,
                symmetry,
            },
        ).invalid;
    }
    const preview = { targets, tileMode, invalid };
    cached = { key, preview };
    return preview;
}

/** The device rectangles of the marks of `target`. */
function markRects(
    frame: OverlayFrame,
    target: BrushTarget,
    tileMode: boolean,
    dpr: number,
): DeviceRect[] {
    const { mapping } = frame;
    const { x, y } = target.point;
    if (tileMode) {
        return outlineRects(cellDeviceRect(mapping, { x, y, width: 1, height: 1 }));
    }
    if (target.index === null) return [];
    const topLeft = mapping.cellToDevice(x, y);
    if (target.index % 2 === 1) {
        // A vertex: the top-left corner of cell `point`.
        const side = Math.round(CORNER_MARK * dpr);
        return [
            {
                x: Math.round(topLeft.x - side / 2),
                y: Math.round(topLeft.y - side / 2),
                width: side,
                height: side,
            },
        ];
    }
    const cell = cellDeviceRect(mapping, { x, y, width: 1, height: 1 });
    const bar = Math.max(1, Math.round(EDGE_BAR * dpr));
    switch (target.index) {
        case 0:
            return [{ x: cell.x, y: cell.y, width: cell.width, height: bar }];
        case 2:
            return [{ x: cell.x + cell.width - bar, y: cell.y, width: bar, height: cell.height }];
        case 4:
            return [{ x: cell.x, y: cell.y + cell.height - bar, width: cell.width, height: bar }];
        default:
            return [{ x: cell.x, y: cell.y, width: bar, height: cell.height }];
    }
}

function drawTerrainBrush(frame: OverlayFrame): void {
    const tool = toolPipeline.strokeTool ?? toolState.active();
    if (tool?.id !== TERRAIN_TOOL_ID) return;
    const { context, mapping, map, theme, cursor } = frame;
    const dpr = mapping.frame.dpr;
    const stroke = brushStroke();
    let preview: BrushPreview | null = null;
    if (stroke) {
        preview = {
            targets: stroke.symmetry
                ? [
                      stroke.current,
                      mirroredTarget(stroke.current, stroke.tileMode, map.width, map.height),
                  ]
                : [stroke.current],
            tileMode: stroke.tileMode,
            invalid: stroke.invalid,
        };
    } else if (cursor) {
        preview = hoverPreview(frame, cellPosition(map, cursor.map));
    }
    if (!preview) return;
    const invalid: DeviceRect[] = [];
    for (const span of preview.invalid) {
        invalid.push(
            cellDeviceRect(mapping, {
                x: span.start,
                y: span.y,
                width: span.end - span.start,
                height: 1,
            }),
        );
    }
    fillRects(context, invalid, theme.danger, INVALID_ALPHA);
    const marks = preview.targets.flatMap((target) =>
        markRects(frame, target, preview.tileMode, dpr),
    );
    fillRects(context, marks, theme.accent);
}

export const overlayLayers: OverlayLayer[] = [
    {
        id: "terrain-brush",
        order: 600,
        draw: drawTerrainBrush,
        watch(redraw) {
            const stops = [
                toolState.subscribe(redraw),
                subscribeTerrainBrush(redraw),
                subscribeBrushTerrain(redraw),
                subscribeHeldModifiers(redraw),
                historySteps.subscribe(redraw),
            ];
            return () => stops.forEach((stop) => stop());
        },
    },
];

// Tiled forgets the brush's line start when the tool is selected again (`WangBrush::activate`).
let activeId = toolState.activeId();
toolState.subscribe(() => {
    const next = toolState.activeId();
    if (next === activeId) return;
    activeId = next;
    if (next === TERRAIN_TOOL_ID) resetTerrainBrush();
});
