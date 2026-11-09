import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { Command } from "../../core/history";
import { MAX_TERRAINS, MAX_TERRAIN_SETS } from "../../core/model";
import type { TerrainSet, TerrainSetType, Tileset } from "../../core/model";
import {
    TerrainEditError,
    addTerrainCommand,
    addTerrainSetCommand,
    assignTerrainCommand,
    brushIndexAt,
    moveTerrainCommand,
    moveTerrainSetCommand,
    removeTerrainCommand,
    removeTerrainSetCommand,
    renameTerrainSetCommand,
    setTerrainFieldCommand,
    setTerrainSetTypeCommand,
    terrainNameProblem,
} from "../../core/terrain";
import type { TerrainFields, TerrainTarget } from "../../core/terrain";
import { historySteps } from "../state/historySteps";
import { sessionStore } from "../state/session";
import { currentTileset, historyIdle } from "../tilesets/edit/tilesetEdit";

// The state and operations of the Terrains panel (SPEC §5.1, DESIGN §8.6; TE-043), outside the
// project and not undoable. The panel shows the terrain sets of the active tileset, the one the
// Tilesets panel shows. Per tileset it keeps the selected set and terrain, which clicks on the
// tileset grid assign, and the sets collapsed in the list. Every change of the project goes
// through the history as one command of `core/terrain`; the selection follows the set or
// terrain an operation adds or moves. As Tiled's `WangDock`, a new set or terrain starts its
// rename at once. A click on a tile assigns the selected terrain to the index under the pointer,
// picked as the terrain brush picks it for the set's type (`brushIndexAt`: SPEC §5.3 names the
// rule per set type, and Tiled's tileset view picks by `WangSet::type()`, not the terrain's
// effective type, so a terrain used only at corners of a mixed set can still go on an edge); a
// right click clears that index; with Shift either acts on the whole tile.

/** The menu of the panel's Add Terrain Set button (`CommandSpec.contextMenus`). */
export const TERRAIN_SET_NEW_MENU = "terrainSetNew";
/** The menu of a terrain set's row. */
export const TERRAIN_SET_MENU = "terrainSet";
/** The menu of a terrain's row. */
export const TERRAIN_MENU = "terrain";

/** The selection of one tileset: its terrain set (index) and terrain (1-based). */
export interface TerrainSelection {
    readonly set: number;
    readonly terrain: number;
}

/** What is being renamed in place: a set (`terrain` null) or one of its terrains. */
export interface TerrainRename {
    readonly tilesetId: string;
    readonly set: number;
    readonly terrain: number | null;
    readonly text: string;
}

/** The tile under the pointer and the index a click there would assign; null at none. */
export interface TerrainHover {
    readonly tilesetId: string;
    readonly tileId: number;
    readonly target: TerrainTarget | null;
}

export interface TerrainsPanelState {
    readonly selections: Readonly<Record<string, TerrainSelection>>;
    /** The sets shown collapsed, by index, per tileset id. */
    readonly collapsed: Readonly<Record<string, readonly number[]>>;
    readonly renaming: TerrainRename | null;
    /** Whether the list of missing combinations is open. */
    readonly missingOpen: boolean;
    readonly hover: TerrainHover | null;
}

function initialState(): TerrainsPanelState {
    return { selections: {}, collapsed: {}, renaming: null, missingOpen: false, hover: null };
}

export const terrainsPanelStore = createStore<TerrainsPanelState>(initialState);

export function useTerrainsPanel<Slice>(selector: (state: TerrainsPanelState) => Slice): Slice {
    return useStore(terrainsPanelStore, selector);
}

/** The selection of `tileset`, kept inside its sets and terrains; null without a set. */
export function terrainSelection(
    tileset: Tileset | null,
    selections: TerrainsPanelState["selections"] = terrainsPanelStore.getState().selections,
): TerrainSelection | null {
    if (!tileset || tileset.terrainSets.length === 0) return null;
    const stored = selections[tileset.id] ?? { set: 0, terrain: 1 };
    const set = Math.min(Math.max(stored.set, 0), tileset.terrainSets.length - 1);
    const count = tileset.terrainSets[set]!.colors.length;
    return { set, terrain: Math.min(Math.max(stored.terrain, 1), count) };
}

/** The selected terrain set of the active tileset and its index; null without one. */
export function selectedSet(): {
    tileset: Tileset;
    set: TerrainSet;
    selection: TerrainSelection;
} | null {
    const tileset = currentTileset();
    const selection = terrainSelection(tileset);
    if (!tileset || !selection) return null;
    return { tileset, set: tileset.terrainSets[selection.set]!, selection };
}

/** The terrain sets of each tileset as `followSets` last saw them. */
const seenSets = new Map<string, readonly TerrainSet[]>();

/** Notes the sets of tileset `tilesetId` as they are, for `followSets`. */
function seeSets(tilesetId: string): void {
    const tileset = sessionStore
        .getState()
        .session.project.tilesets.find((each) => each.id === tilesetId);
    if (tileset) seenSets.set(tileset.id, tileset.terrainSets);
}

function select(tilesetId: string, selection: TerrainSelection): void {
    seeSets(tilesetId);
    const { selections } = terrainsPanelStore.getState();
    const current = selections[tilesetId];
    if (current?.set === selection.set && current.terrain === selection.terrain) return;
    terrainsPanelStore.setState({ selections: { ...selections, [tilesetId]: selection } });
}

/** Selects set `set` of the active tileset, with its terrain `terrain` (default its first). */
export function selectTerrain(set: number, terrain = 1): void {
    const tileset = currentTileset();
    if (tileset) select(tileset.id, { set, terrain });
}

export function isCollapsed(tilesetId: string, set: number): boolean {
    return terrainsPanelStore.getState().collapsed[tilesetId]?.includes(set) ?? false;
}

/** Shows or hides the terrains of set `set` of the active tileset in the list. */
export function toggleCollapsed(
    set: number,
    collapsed = !isCollapsed(currentTileset()?.id ?? "", set),
): void {
    const tileset = currentTileset();
    if (!tileset) return;
    seeSets(tileset.id);
    const state = terrainsPanelStore.getState();
    const list = state.collapsed[tileset.id] ?? [];
    if (list.includes(set) === collapsed) return;
    const next = collapsed ? [...list, set] : list.filter((each) => each !== set);
    terrainsPanelStore.setState({ collapsed: { ...state.collapsed, [tileset.id]: next } });
}

/** Executes `command` on the app's history; false when there is none or a stroke is open. */
function run(command: Command | null): boolean {
    if (!command || !historyIdle()) return false;
    sessionStore.getState().history.execute(command);
    return true;
}

/**
 * Runs an edit the panel's own controls start (not the registry, which reports refusals in a
 * toast): a refused edit changes nothing and returns false.
 */
function runQuietly(make: () => Command | null): boolean {
    try {
        return run(make());
    } catch (error) {
        if (error instanceof TerrainEditError) return false;
        throw error;
    }
}

/** Whether a command can change the active tileset's terrain now. */
export const terrainEditable = (): boolean => currentTileset() !== null && historyIdle();

/** Whether the active tileset takes another terrain set (FORMAT §2.8: 256). */
export const canAddTerrainSet = (): boolean =>
    terrainEditable() && currentTileset()!.terrainSets.length < MAX_TERRAIN_SETS;

/** Whether the selected set takes another terrain (FORMAT §2.8: 254). */
export function canAddTerrain(): boolean {
    const selected = selectedSet();
    return terrainEditable() && selected !== null && selected.set.colors.length < MAX_TERRAINS;
}

/** Adds a terrain set of `type` to the active tileset, selects it and starts its rename. */
export function newTerrainSet(type: TerrainSetType): boolean {
    const tileset = currentTileset();
    if (!tileset || !run(addTerrainSetCommand(tileset.id, type))) return false;
    const set = tileset.terrainSets.length - 1;
    select(tileset.id, { set, terrain: 1 });
    toggleCollapsed(set, false);
    startTerrainRename(set, null);
    return true;
}

/** Removes the selected terrain set. */
export function removeSelectedSet(): boolean {
    const selected = selectedSet();
    if (!selected) return false;
    const { tileset, selection } = selected;
    if (!run(removeTerrainSetCommand(tileset.id, selection.set))) return false;
    select(tileset.id, {
        set: Math.max(0, Math.min(selection.set, tileset.terrainSets.length - 1)),
        terrain: 1,
    });
    return true;
}

/** Whether the selected set has a neighbour `delta` places along the list. */
export function canMoveSelectedSet(delta: -1 | 1): boolean {
    const selected = selectedSet();
    if (!selected) return false;
    return selected.tileset.terrainSets[selected.selection.set + delta] !== undefined;
}

/** Moves the selected terrain set one place up or down; it stays selected. */
export function moveSelectedSet(delta: -1 | 1): boolean {
    const selected = selectedSet();
    if (!selected || !canMoveSelectedSet(delta)) return false;
    const { tileset, selection } = selected;
    // The selection and the collapsed flags follow the moved set (`followSets`).
    return run(moveTerrainSetCommand(tileset.id, selection.set, delta));
}

/** Sets the type of set `set` of the active tileset (SPEC §5.1: unused indexes cleared). */
export function setTerrainSetType(set: number, type: TerrainSetType): boolean {
    const tileset = currentTileset();
    if (!tileset) return false;
    return runQuietly(() =>
        setTerrainSetTypeCommand(sessionStore.getState().session.project, tileset.id, set, type),
    );
}

/** Adds a terrain to the selected set, selects it and starts its rename. */
export function addTerrainToSelectedSet(): boolean {
    const selected = selectedSet();
    if (!selected) return false;
    const { tileset, selection } = selected;
    if (!run(addTerrainCommand(tileset.id, selection.set))) return false;
    const terrain = tileset.terrainSets[selection.set]!.colors.length;
    select(tileset.id, { set: selection.set, terrain });
    toggleCollapsed(selection.set, false);
    startTerrainRename(selection.set, terrain);
    return true;
}

/** Removes the selected terrain; refused for the set's only one. */
export function removeSelectedTerrain(): boolean {
    const selected = selectedSet();
    if (!selected) return false;
    const { tileset, selection } = selected;
    if (!run(removeTerrainCommand(tileset.id, selection.set, selection.terrain))) return false;
    const count = tileset.terrainSets[selection.set]!.colors.length;
    select(tileset.id, { set: selection.set, terrain: Math.min(selection.terrain, count) });
    return true;
}

/** Whether the selected terrain has a neighbour `delta` places along its set. */
export function canMoveSelectedTerrain(delta: -1 | 1): boolean {
    const selected = selectedSet();
    if (!selected) return false;
    const to = selected.selection.terrain + delta;
    return to >= 1 && to <= selected.set.colors.length;
}

/** Moves the selected terrain one place up or down its set, with its indexes. */
export function moveSelectedTerrain(delta: -1 | 1): boolean {
    const selected = selectedSet();
    if (!selected || !canMoveSelectedTerrain(delta)) return false;
    const { tileset, selection } = selected;
    if (!run(moveTerrainCommand(tileset.id, selection.set, selection.terrain, delta))) return false;
    select(tileset.id, { ...selection, terrain: selection.terrain + delta });
    return true;
}

/** Sets a field of terrain `terrain` of set `set` of the active tileset; one entry. */
export function setTerrainField<Key extends keyof TerrainFields>(
    set: number,
    terrain: number,
    key: Key,
    value: TerrainFields[Key],
): boolean {
    const tileset = currentTileset();
    if (!tileset) return false;
    const { project } = sessionStore.getState().session;
    return runQuietly(() => setTerrainFieldCommand(project, tileset.id, set, terrain, key, value));
}

/** How a click on a tile acts: the left button assigns, the right clears; Shift: whole tile. */
export interface TileClick {
    readonly erase: boolean;
    readonly wholeTile: boolean;
}

/**
 * The target of a click at `(fx, fy)` within a tile (0..1 across it) in the selected set: the
 * whole tile with Shift, else the index the terrain brush picks for the set's type; null in the
 * dead centre of a mixed set.
 */
export function clickTarget(fx: number, fy: number, click: TileClick): TerrainTarget | null {
    const selected = selectedSet();
    if (!selected) return null;
    if (click.wholeTile) return "tile";
    return brushIndexAt(selected.set.type, fx, fy);
}

/** Assigns (or clears) the selected terrain on tile `tileId` at `(fx, fy)`; one entry. */
export function clickTile(tileId: number, fx: number, fy: number, click: TileClick): boolean {
    const selected = selectedSet();
    const target = clickTarget(fx, fy, click);
    if (!selected || target === null) return false;
    const { tileset, selection } = selected;
    const terrain = click.erase ? 0 : selection.terrain;
    const { project } = sessionStore.getState().session;
    return runQuietly(() =>
        assignTerrainCommand(project, tileset.id, selection.set, tileId, target, terrain),
    );
}

export function setTerrainHover(hover: TerrainHover | null): void {
    const current = terrainsPanelStore.getState().hover;
    const same =
        current === hover ||
        (current !== null &&
            hover !== null &&
            current.tilesetId === hover.tilesetId &&
            current.tileId === hover.tileId &&
            current.target === hover.target);
    if (!same) terrainsPanelStore.setState({ hover });
}

export function setMissingOpen(missingOpen: boolean): void {
    if (terrainsPanelStore.getState().missingOpen !== missingOpen) {
        terrainsPanelStore.setState({ missingOpen });
    }
}

/** Starts renaming set `set` (`terrain` null) or its terrain `terrain` in place. */
export function startTerrainRename(set: number, terrain: number | null): boolean {
    const tileset = currentTileset();
    const owner = tileset?.terrainSets[set];
    if (!tileset || !owner) return false;
    const named = terrain === null ? owner : owner.colors[terrain - 1];
    if (!named) return false;
    terrainsPanelStore.setState({
        renaming: { tilesetId: tileset.id, set, terrain, text: named.name },
    });
    return true;
}

export function setTerrainRenameText(text: string): void {
    const { renaming } = terrainsPanelStore.getState();
    if (renaming) terrainsPanelStore.setState({ renaming: { ...renaming, text } });
}

/** Ends the rename and keeps the old name. */
export function cancelTerrainRename(): void {
    if (terrainsPanelStore.getState().renaming) terrainsPanelStore.setState({ renaming: null });
}

/**
 * Ends the rename and applies the typed name, one entry when it differs; a blank name keeps the
 * old one. Returns whether the name changed.
 */
export function applyTerrainRename(): boolean {
    const { renaming } = terrainsPanelStore.getState();
    if (!renaming) return false;
    terrainsPanelStore.setState({ renaming: null });
    if (terrainNameProblem(renaming.text) !== null) return false;
    const { project } = sessionStore.getState().session;
    const { tilesetId, set, terrain, text } = renaming;
    return runQuietly(() =>
        terrain === null
            ? renameTerrainSetCommand(project, tilesetId, set, text)
            : setTerrainFieldCommand(project, tilesetId, set, terrain, "name", text),
    );
}

/**
 * Where set `index` of `before` is in `after`: found by identity (a move, or a set added or
 * removed around it; commands replace only the sets they change), else the same place when the
 * list kept its length (the set itself edited); null when it went.
 */
function followIndex(
    index: number,
    before: readonly TerrainSet[],
    after: readonly TerrainSet[],
): number | null {
    const set = before[index];
    if (!set) return null;
    const at = after.indexOf(set);
    if (at !== -1) return at;
    return before.length === after.length ? index : null;
}

/**
 * After every step of the history, its undo and redo included, the selection and the collapsed
 * flags of each tileset follow their sets to wherever the step put them. The sets are noted when
 * the selection or a flag is set and after every step.
 */
function followSets(): void {
    const state = terrainsPanelStore.getState();
    let { selections, collapsed } = state;
    for (const tileset of sessionStore.getState().session.project.tilesets) {
        const before = seenSets.get(tileset.id);
        const after = tileset.terrainSets;
        seenSets.set(tileset.id, after);
        if (!before || before === after) continue;
        const selection = selections[tileset.id];
        const set = selection ? followIndex(selection.set, before, after) : null;
        if (selection && set !== null && set !== selection.set) {
            selections = { ...selections, [tileset.id]: { ...selection, set } };
        }
        const flags = collapsed[tileset.id];
        if (flags && flags.length > 0) {
            const next = flags
                .map((each) => followIndex(each, before, after))
                .filter((each) => each !== null);
            collapsed = { ...collapsed, [tileset.id]: next };
        }
    }
    if (selections !== state.selections || collapsed !== state.collapsed) {
        terrainsPanelStore.setState({ selections, collapsed });
    }
}

for (const tileset of sessionStore.getState().session.project.tilesets) {
    seenSets.set(tileset.id, tileset.terrainSets);
}
historySteps.subscribe(followSets);

// Another project in the window starts the panel afresh; a rename whose set or terrain went
// away (an undo) ends.
let project = sessionStore.getState().session.project;
sessionStore.subscribe((state) => {
    const next = state.session.project;
    if (next !== project) {
        project = next;
        seenSets.clear();
        terrainsPanelStore.setState(initialState());
        return;
    }
    const { renaming } = terrainsPanelStore.getState();
    if (!renaming) return;
    const set = next.tilesets.find((each) => each.id === renaming.tilesetId)?.terrainSets[
        renaming.set
    ];
    const gone = !set || (renaming.terrain !== null && !set.colors[renaming.terrain - 1]);
    if (gone) terrainsPanelStore.setState({ renaming: null });
});
