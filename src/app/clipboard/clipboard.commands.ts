import {
    copySelectedCells,
    maskSpans,
    setSelectionCommand,
    tileSelectionOf,
} from "../../core/selection";
import { effectiveValues, findLayer } from "../../core/model";
import type { Region } from "../../core/model";
import { appCommands } from "../commands/appCommands";
import type { CommandSpec } from "../commands/types";
import { activeHistory, sessionStore } from "../state/session";
import { statusStore } from "../state/status";
import { toolState } from "../tools/activeTool";
import { toolPipeline } from "../tools/appPipeline";
import { FEEDBACK_MS } from "../tools/pipeline";
import { REFUSALS } from "../tools/paintTarget";
import type { PaintTarget } from "../tools/paintTarget";
import { CUT_LABEL, captureStamp } from "../tools/stamp/capture";
import { setCurrentStamp } from "../tools/stamp/currentStamp";
import { activeLayer, activeLayerId, activeMap } from "../tools/toolSets";
import { clipboardContent, clipboardStore, copyCellsToClipboard } from "./clipboard";

// Cut, Copy, Paste and Delete of cells (SPEC §4.4, DESIGN §5, §10.3; TE-021): Ctrl+X, Ctrl+C,
// Ctrl+V and Delete in the `global` context, on the active map's tile selection and active tile
// layer. They take the items planned for them in the Edit menu (commands/planned.commands.ts).
// As Tiled's `MapDocumentActionHandler` and `MapEditor::paste` (v1.12.2):
//
//   Copy    the selected cells of the active layer, over the selection's bounding box, cells
//           outside it empty (`clipboard.ts`). It reads only, so a hidden or locked layer is
//           copied. No history entry.
//   Cut     Copy, then the selected cells are erased and the selection cleared: one entry,
//           "Cut". Refused on a locked layer, or one under a locked group, before anything is
//           copied; a hidden layer is cut (Tiled's `isTileSelectionLocked` looks at the lock
//           only).
//   Delete  the selected cells are erased, the selection kept: one entry, "Delete"; refused as
//           Cut is. Erasing only empty cells records nothing (SPEC §3).
//   Paste   the clipboard becomes the current stamp, cut to the bounding box of its non-empty
//           cells (Tiled's `normalizeTileLayerPositionsAndMapSize`), and the stamp brush is
//           selected. A tile selection is cleared first, one entry ("Select None"), so the
//           stamp is not clipped to it. A clipboard of empty cells only leaves the stamp as it
//           is (Tiled's `setStamp` ignores an empty stamp).
//
// While a stroke is in progress the history takes no command, so Cut, Delete and Paste are
// disabled then, as undo and redo are.

/** The label of the history entry of Delete. */
export const DELETE_LABEL = "Delete";

/** Whether the history can take a command now. */
const historyIdle = () => !sessionStore.getState().history.transaction && !toolPipeline.stroking;

/** The active map's id and selection when its active layer is a tile layer. */
function selectedTileCells(): { mapId: string; selection: Region } | null {
    const { session } = sessionStore.getState();
    const map = activeMap(session);
    if (!map || activeLayer(session)?.type !== "tile") return null;
    const selection = tileSelectionOf(session, map.id);
    return selection ? { mapId: map.id, selection } : null;
}

/**
 * The layer Cut and Delete erase: the active tile layer of the active map unless it or a group
 * above it is locked; null without a map or a tile layer.
 */
function eraseTarget(): PaintTarget | null {
    const { session } = sessionStore.getState();
    const map = activeMap(session);
    const entry = map ? findLayer(map, activeLayerId(session, map)) : null;
    if (!map || entry?.layer.type !== "tile") return null;
    if (!effectiveValues(entry.layer, entry.ancestors).unlocked)
        return { refused: REFUSALS.locked };
    return { mapId: map.id, layerId: entry.layer.id };
}

/** Shows `message` in the status bar for as long as tool feedback stays. */
function feedback(message: string): void {
    const status = statusStore.getState();
    status.setFeedback(message);
    setTimeout(() => {
        if (statusStore.getState().feedback === message) statusStore.getState().setFeedback(null);
    }, FEEDBACK_MS);
}

/** Copies the selected cells of the active tile layer; false when there are none. */
function copy(): boolean {
    const selected = selectedTileCells();
    const layer = activeLayer(sessionStore.getState().session);
    if (!selected || layer?.type !== "tile") return false;
    copyCellsToClipboard(copySelectedCells(layer.cells, selected.selection));
    return true;
}

/**
 * Erases the selected cells of the active tile layer as one history entry labelled `label`;
 * with `clear`, the selection is cleared in the same entry. A refused layer shows its message
 * and changes nothing; returns whether the layer took the erase.
 */
function eraseSelected(label: string, clear: boolean): boolean {
    const selected = selectedTileCells();
    if (!selected || !historyIdle()) return false;
    const { session } = sessionStore.getState();
    const target = eraseTarget();
    if (!target) return false;
    if ("refused" in target) {
        feedback(target.refused);
        return false;
    }
    const transaction = activeHistory().begin(target);
    try {
        for (const span of maskSpans(selected.selection)) {
            for (let x = span.start; x < span.end; x++) transaction.set(x, span.y, 0);
        }
    } catch (error) {
        transaction.abort();
        throw error;
    }
    const extra = clear ? setSelectionCommand(session, selected.mapId, null, label) : null;
    extra?.do(session);
    try {
        // The history tells the viewport about the entry it records.
        transaction.commit(label, extra ?? undefined);
    } catch (error) {
        // A refused allocation leaves `extra` applied; a refused record has undone it.
        if (extra && tileSelectionOf(session, selected.mapId) === null) extra.undo(session);
        throw error;
    }
    return true;
}

/** The clipboard's cells when they can become the stamp of the active tile layer now. */
function pastableCells() {
    const content = clipboardContent();
    const { session } = sessionStore.getState();
    if (content?.kind !== "cells" || !historyIdle()) return null;
    return activeLayer(session)?.type === "tile" ? content.stamp : null;
}

function paste(): void {
    const stamp = pastableCells();
    if (!stamp) return;
    const { session } = sessionStore.getState();
    const mapId = session.activeMapId;
    const clear = setSelectionCommand(session, mapId, null, "Select None");
    if (clear) activeHistory().execute(clear);
    const { width, height, cells } = stamp;
    const trimmed = captureStamp(
        { get: (x, y) => cells[y * width + x]! },
        { x: 0, y: 0, width, height },
    );
    if (trimmed) setCurrentStamp(trimmed);
    toolState.select("stamp");
}

export const commands: CommandSpec[] = [
    {
        id: "edit.cut",
        title: "Cut",
        shortcut: "Ctrl+X",
        enabled: () => historyIdle() && selectedTileCells() !== null,
        run() {
            const target = eraseTarget();
            if (target && "refused" in target) return feedback(target.refused);
            if (copy()) eraseSelected(CUT_LABEL, true);
        },
    },
    {
        id: "edit.copy",
        title: "Copy",
        shortcut: "Ctrl+C",
        enabled: () => selectedTileCells() !== null,
        run: () => void copy(),
    },
    {
        id: "edit.paste",
        title: "Paste",
        shortcut: "Ctrl+V",
        enabled: () => pastableCells() !== null,
        run: paste,
    },
    {
        id: "edit.delete",
        title: "Delete",
        shortcut: "Delete",
        enabled: () => historyIdle() && selectedTileCells() !== null,
        run: () => void eraseSelected(DELETE_LABEL, false),
    },
];

// Paste is enabled by the clipboard.
clipboardStore.subscribe(() => appCommands.refresh());
