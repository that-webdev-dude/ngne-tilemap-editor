import {
    copySelectedCells,
    intersectMask,
    maskSpans,
    rectMask,
    selectionOf,
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
import { MarkerEditError, deleteMarkersCommand, pasteMarkersCommand } from "../../core/markers";
import { walkLayers } from "../../core/model";
import type { Marker } from "../../core/model";
import { markerLayerRefusal } from "../markers/markerToolSupport";
import {
    deleteSelectedMarkersCommand,
    lockedSelectionRefusal,
    markersSelected,
    selectedMarkerIds,
    setMarkerSelection,
} from "../markers/markerSelection";
import { deleteVertex, setChosenVertex } from "../markers/points/markerVertex";
import {
    clipboardContent,
    clipboardMarkers,
    clipboardStore,
    copyCellsToClipboard,
    copyMarkersToClipboard,
} from "./clipboard";

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
//           Cut is. Erasing only empty cells records nothing (SPEC §3). While the `markers`
//           context applies (a marker layer active, markers selected), Delete removes the
//           selected markers instead (SPEC §8; TE-038): one entry, "Delete Marker(s)"; with the
//           Edit points tool's chosen point, that point (TE-039): one entry, "Edit Marker
//           Points", refused below 3 points of a polygon or 2 of a polyline.
//   Paste   the clipboard becomes the current stamp, cut to the bounding box of its non-empty
//           cells (Tiled's `normalizeTileLayerPositionsAndMapSize`), and the stamp brush is
//           selected. A tile selection is cleared first, one entry ("Select None"), so the
//           stamp is not clipped to it. A clipboard of empty cells only leaves the stamp as it
//           is (Tiled's `setStamp` ignores an empty stamp).
//
// Markers (SPEC §8; TE-039), while the `markers` context applies, as Tiled's object clipboard:
//
//   Copy    the selected markers, in their stacking order, with their geometry, name, class and
//           properties; the cells on the clipboard give way (the last copy wins). No entry.
//   Cut     Copy, then the selected markers are deleted: one entry, "Cut". Cut and Delete of
//           markers or of a chosen point are refused, before anything is copied, while a
//           selected marker's layer is locked (`lockedSelectionRefusal`), as for cells.
//   Paste   with markers on the clipboard: they are added at the top of the active layer, at
//           the positions they were copied from, with new IDs, and become the selection: one
//           entry, "Paste". Refused with a status-bar message unless the active layer is a
//           visible, unlocked marker layer under no hidden or locked group.
//
// While a stroke is in progress the history takes no command, so Cut, Delete and Paste are
// disabled then, as undo and redo are.

/** The label of the history entry of Delete. */
export const DELETE_LABEL = "Delete";

/** Whether the history can take a command now. */
const historyIdle = () => !sessionStore.getState().history.transaction && !toolPipeline.stroking;

/**
 * The active map's id and the selected cells inside it when its active layer is a tile layer;
 * null when none is. A selection moved by Resize / Offset Map can reach past the map: Copy,
 * Cut and Delete act on its cells inside the map only (SPEC §4.4; Tiled's `eraseTileLayers`
 * cuts the region to the layer's bounds).
 */
function selectedTileCells(): { mapId: string; selection: Region } | null {
    const { session } = sessionStore.getState();
    const map = activeMap(session);
    if (!map || activeLayer(session)?.type !== "tile") return null;
    const selection = tileSelectionOf(session, map.id);
    if (!selection) return null;
    const { x, y, width, height } = selection;
    const inside = x >= 0 && y >= 0 && x + width <= map.width && y + height <= map.height;
    const cut = inside
        ? selection
        : selectionOf(
              intersectMask(
                  selection,
                  rectMask({ x: 0, y: 0, width: map.width, height: map.height }),
              ),
          );
    return cut ? { mapId: map.id, selection: cut } : null;
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

/** The selected markers of the active map in their stacking order; empty without a selection. */
function selectedMarkersInOrder(): Marker[] {
    const { session } = sessionStore.getState();
    const map = activeMap(session);
    if (!map || !markersSelected(session)) return [];
    const ids = new Set(selectedMarkerIds(session, map));
    const out: Marker[] = [];
    for (const { layer } of walkLayers(map.layers)) {
        if (layer.type !== "marker") continue;
        for (const marker of layer.markers) if (ids.has(marker.id)) out.push(marker);
    }
    return out;
}

/** Whether the `markers` context applies: a marker layer active, markers selected. */
const markersOn = () => markersSelected(sessionStore.getState().session);

/** Copies the selected markers; false when there are none. */
function copyMarkers(): boolean {
    const markers = selectedMarkersInOrder();
    if (markers.length === 0) return false;
    copyMarkersToClipboard(markers);
    return true;
}

/** Copy, then the selected markers deleted as one entry "Cut". */
function cutMarkers(): void {
    const { session } = sessionStore.getState();
    const map = activeMap(session);
    if (!map || !historyIdle()) return;
    const refusal = lockedSelectionRefusal(session, map);
    if (refusal) return feedback(refusal);
    if (!copyMarkers()) return;
    const ids = selectedMarkersInOrder().map((marker) => marker.id);
    activeHistory().execute({
        ...deleteMarkersCommand(session.project, map.id, ids),
        label: CUT_LABEL,
    });
}

/**
 * Pastes the clipboard's markers into the active layer, selecting them; a layer that takes no
 * markers shows why in the status bar.
 */
function pasteMarkers(): void {
    const markers = clipboardMarkers();
    const { session } = sessionStore.getState();
    const map = activeMap(session);
    if (!markers || !map || !historyIdle()) return;
    const layerId = activeLayerId(session, map);
    const refusal = markerLayerRefusal(map, layerId);
    if (refusal !== null) return feedback(refusal);
    try {
        const command = pasteMarkersCommand(map.id, layerId, markers);
        activeHistory().execute(command);
        setMarkerSelection(command.markerIds, map.id);
    } catch (error) {
        if (error instanceof MarkerEditError) {
            feedback(error.message);
            return;
        }
        throw error;
    }
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
        enabled: () => historyIdle() && (markersOn() || selectedTileCells() !== null),
        run() {
            if (markersOn()) return cutMarkers();
            const target = eraseTarget();
            if (target && "refused" in target) return feedback(target.refused);
            if (copy()) eraseSelected(CUT_LABEL, true);
        },
    },
    {
        id: "edit.copy",
        title: "Copy",
        shortcut: "Ctrl+C",
        enabled: () => markersOn() || selectedTileCells() !== null,
        run: () => void (markersOn() ? copyMarkers() : copy()),
    },
    {
        id: "edit.paste",
        title: "Paste",
        shortcut: "Ctrl+V",
        enabled: () => (clipboardMarkers() !== null && historyIdle()) || pastableCells() !== null,
        run: () => (clipboardMarkers() !== null ? pasteMarkers() : paste()),
    },
    {
        id: "edit.delete",
        title: "Delete",
        shortcut: "Delete",
        enabled: () => historyIdle() && (markersOn() || selectedTileCells() !== null),
        run() {
            if (!historyIdle()) return;
            const { session } = sessionStore.getState();
            const map = activeMap(session);
            const refusal = map && markersOn() && lockedSelectionRefusal(session, map);
            if (refusal) return feedback(refusal);
            const vertex = deleteVertex(session);
            if (vertex && "refused" in vertex) return feedback(vertex.refused);
            if (vertex) {
                activeHistory().execute(vertex.command);
                setChosenVertex(null);
                return;
            }
            const markers = deleteSelectedMarkersCommand(session);
            if (markers) activeHistory().execute(markers);
            else eraseSelected(DELETE_LABEL, false);
        },
    },
];

// Paste is enabled by the clipboard.
clipboardStore.subscribe(() => appCommands.refresh());
