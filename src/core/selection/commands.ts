import { touchedNothing } from "../history";
import type { Command } from "../history";
import { createMapSession } from "../model";
import type { MapSession, ProjectSession, Region } from "../model";
import { selectionsEqual } from "./mask";
import { combineSelection, invertSelection, selectAll } from "./operations";
import type { SelectionMode } from "./operations";

// Tile selection changes as commands of the project's history (SPEC §3, §4.4; TE-020): undoable
// as Tiled's `ChangeSelectedArea` and the sprite editor's selection commands, not saved. A
// command keeps the selection of its map before and after; both are values nobody changes
// (mask.ts), so undo puts back the very mask that was there. A change that would leave the same
// cells selected makes no command (null), so it records no history entry, as a stroke that
// changes nothing. The entry names its map, so undoing it from another map's tab goes there
// first (SPEC §3).

/** The session of map `mapId`, made when the map has none yet. */
function mapSessionOf(session: ProjectSession, mapId: string): MapSession {
    const existing = session.perMap.get(mapId);
    if (existing) return existing;
    const map = session.project.maps.find((each) => each.id === mapId);
    if (!map) throw new RangeError(`The project has no map "${mapId}".`);
    const made = createMapSession(map);
    session.perMap.set(mapId, made);
    return made;
}

/** The tile selection of map `mapId`; null without one. */
export function tileSelectionOf(session: ProjectSession, mapId: string): Region | null {
    return session.perMap.get(mapId)?.tileSelection ?? null;
}

/**
 * The command that makes `next` the tile selection of map `mapId`, labelled `label`; null
 * when `next` selects the same cells as the selection now.
 */
export function setSelectionCommand(
    session: ProjectSession,
    mapId: string,
    next: Region | null,
    label: string,
): Command | null {
    const before = tileSelectionOf(session, mapId);
    if (selectionsEqual(before, next)) return null;
    return {
        label,
        bytes: (before?.mask.byteLength ?? 0) + (next?.mask.byteLength ?? 0),
        // No cells change: the viewport has nothing to draw again.
        touched: touchedNothing(mapId),
        do(target) {
            mapSessionOf(target, mapId).tileSelection = next;
        },
        undo(target) {
            mapSessionOf(target, mapId).tileSelection = before;
        },
    };
}

/**
 * Combines `shape` (a rectangle, a flood region, the cells of some values) with the selection
 * of map `mapId` by `mode` (`combineSelection`); null when the selection would not change.
 */
export function selectCommand(
    session: ProjectSession,
    mapId: string,
    shape: Region,
    mode: SelectionMode,
    label: string,
): Command | null {
    const next = combineSelection(tileSelectionOf(session, mapId), shape, mode);
    return setSelectionCommand(session, mapId, next, label);
}

function mapOf(session: ProjectSession, mapId: string) {
    const map = session.project.maps.find((each) => each.id === mapId);
    if (!map) throw new RangeError(`The project has no map "${mapId}".`);
    return map;
}

/** Select All: every cell of the map; null when every cell is selected already. */
export function selectAllCommand(session: ProjectSession, mapId: string): Command | null {
    const { width, height } = mapOf(session, mapId);
    return setSelectionCommand(session, mapId, selectAll(width, height), "Select All");
}

/** Select None: no selection; null when there is none. */
export function selectNoneCommand(session: ProjectSession, mapId: string): Command | null {
    return setSelectionCommand(session, mapId, null, "Select None");
}

/** Invert Selection (`invertSelection`): with no selection, every cell. */
export function invertSelectionCommand(session: ProjectSession, mapId: string): Command | null {
    const { width, height } = mapOf(session, mapId);
    const next = invertSelection(tileSelectionOf(session, mapId), width, height);
    return setSelectionCommand(session, mapId, next, "Invert Selection");
}
