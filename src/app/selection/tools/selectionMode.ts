import { selectCommand, selectNoneCommand, setSelectionCommand } from "../../../core/selection";
import { selectionOf } from "../../../core/selection";
import type { SelectionMode } from "../../../core/selection";
import type { Region } from "../../../core/model";
import type {
    ChoiceToolOption,
    ToolContext,
    ToolModifiers,
    ToolOptionValue,
} from "../../tools/types";

// How a selection tool's shape combines with the tile selection (SPEC §4.3, Tiled's
// `AbstractTileSelectionTool`): the context bar's Mode, unless Shift (add), Ctrl (subtract) or
// both (intersect) are held at the press that begins the gesture. A completed gesture is one
// command of the project's history, labelled with the tool's name; one that would leave the
// same cells selected records nothing. A right click clears the selection.

/** Replace, add, subtract or intersect: the Mode control of the context bar (DESIGN §7). */
export const SELECTION_MODE: ChoiceToolOption = {
    kind: "choice",
    key: "mode",
    label: "Mode",
    choices: [
        { value: "replace", label: "Replace" },
        { value: "add", label: "Add" },
        { value: "subtract", label: "Subtract" },
        { value: "intersect", label: "Intersect" },
    ],
    default: "replace",
};

/** The status-bar hint of the selection tools' modifiers (DESIGN §8.7). */
export const SELECTION_HINT =
    "Shift: add · Ctrl: subtract · Ctrl+Shift: intersect · Right click: clear";

const MODES: readonly SelectionMode[] = ["replace", "add", "subtract", "intersect"];

/**
 * The mode of a gesture: from the modifiers held at its press (Tiled's `modifiersChanged`), or
 * else the tool's Mode option.
 */
export function selectionModeOf(
    values: Readonly<Record<string, ToolOptionValue>>,
    modifiers: Readonly<ToolModifiers>,
): SelectionMode {
    if (modifiers.ctrl && modifiers.shift) return "intersect";
    if (modifiers.shift) return "add";
    if (modifiers.ctrl) return "subtract";
    const chosen = values[SELECTION_MODE.key];
    return MODES.find((mode) => mode === chosen) ?? "replace";
}

/**
 * Combines `shape` with the selection of the stroke's map by `mode`, as one history step
 * labelled `label`. Returns whether it recorded one.
 */
export function applySelection(
    context: ToolContext,
    shape: Region,
    mode: SelectionMode,
    label: string,
): boolean {
    const { session, map } = context;
    // Replace keeps the shape's very mask when it is cut to its cells, so the ants find the
    // boundary its preview worked out (`boundaryCache.ts`).
    const command =
        mode === "replace"
            ? setSelectionCommand(session, map.id, selectionOf(shape), label)
            : selectCommand(session, map.id, shape, mode, label);
    if (!command) return false;
    context.history.execute(command);
    return true;
}

/** Clears the selection of the stroke's map (a right click); returns whether it had one. */
export function clearSelection(context: ToolContext): boolean {
    const command = selectNoneCommand(context.session, context.map.id);
    if (!command) return false;
    context.history.execute(command);
    return true;
}
