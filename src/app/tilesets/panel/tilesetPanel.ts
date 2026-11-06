import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import type { Project, Tile, Tileset } from "../../../core/model";
import { sessionStore } from "../../state/session";
import type { SessionState } from "../../state/session";
import { toolState } from "../../tools/activeTool";
import { setCurrentStamp } from "../../tools/stamp/currentStamp";
import { gridLayout, selectionStamp, shownTile, spanGridRect, tileIndex } from "./tileGrid";
import type { GridPoint, GridRect, PanelZoom } from "./tileGrid";

// The state of the Tilesets panel (SPEC §6.2, DESIGN §8.5), outside the project and not
// undoable, as Tiled's tileset dock keeps it: the tab shown, a selection per tileset, the
// zoom, the class filter and the tile under the pointer. As Tiled's `TilesetDock` (v1.12.2),
// a selection made with the pointer becomes the current stamp at every change, one made with
// the keyboard when Enter is pressed (DESIGN §8.5); `[` and `]` move one tab and stop at the
// ends; adding a tileset does not change the tab shown; removing the shown one shows the tab
// that took its place, else the last (Qt's `QTabBar::SelectRightTab`). As Tiled's
// `MapEditor::setStamp`, a new stamp from the panel selects the stamp brush unless the stamp
// brush, the bucket or the shape fill is the tool (they all use the stamp), and a selection
// without a tile leaves the stamp as it is. Another project in the window starts the panel
// afresh.

/** A selection of one tileset's grid: from where it began to where it ends, both included. */
export interface PanelSelection {
    readonly anchor: GridPoint;
    readonly focus: GridPoint;
}

export interface TilesetPanelState {
    /** The tileset whose tab is shown; null or a removed one shows the first. */
    readonly activeTilesetId: string | null;
    /** The selection of each tileset, by tileset id. */
    readonly selections: Readonly<Record<string, PanelSelection>>;
    readonly zoom: PanelZoom;
    /** Text of the class filter; empty shows every tile. */
    readonly filter: string;
    /** The shown tile under the pointer, by index in display order; null when none is. */
    readonly hovered: { readonly tilesetId: string; readonly index: number } | null;
}

/** The zoom the panel starts at (the 2× of DESIGN §2's sketch). */
export const DEFAULT_PANEL_ZOOM: PanelZoom = 2;

function initialState(): TilesetPanelState {
    return {
        activeTilesetId: null,
        selections: {},
        zoom: DEFAULT_PANEL_ZOOM,
        filter: "",
        hovered: null,
    };
}

/** A store of the panel's state. The app has one (`tilesetPanelStore`); tests create their own. */
export function createTilesetPanelStore(): StoreApi<TilesetPanelState> {
    return createStore<TilesetPanelState>(initialState);
}

export const tilesetPanelStore = createTilesetPanelStore();

export function useTilesetPanel<Slice>(selector: (state: TilesetPanelState) => Slice): Slice {
    return useStore(tilesetPanelStore, selector);
}

/** The tileset `state` shows of `project`: its active one, else the first; null without any. */
export function shownTileset(project: Project, state: TilesetPanelState): Tileset | null {
    const { tilesets } = project;
    return tilesets.find((each) => each.id === state.activeTilesetId) ?? tilesets[0] ?? null;
}

/** The rectangle of `tileset`'s selection in `state`, clipped to its grid; null without one. */
export function selectionRect(tileset: Tileset, state: TilesetPanelState): GridRect | null {
    const selection = state.selections[tileset.id];
    if (!selection) return null;
    const layout = gridLayout(tileset, 1);
    if (layout.rows === 0) return null;
    const clip = ({ column, row }: GridPoint): GridPoint => ({
        column: Math.min(column, layout.columns - 1),
        row: Math.min(row, layout.rows - 1),
    });
    return spanGridRect(clip(selection.anchor), clip(selection.focus));
}

/** The tiles selected for `tileset`, shown ones only, in display order. */
export function selectedTiles(tileset: Tileset): Tile[] {
    const state = tilesetPanelStore.getState();
    const rect = selectionRect(tileset, state);
    if (!rect) return [];
    const layout = gridLayout(tileset, 1);
    const tiles: Tile[] = [];
    for (let row = rect.row; row < rect.row + rect.rows; row++) {
        for (let column = rect.column; column < rect.column + rect.columns; column++) {
            const tile = shownTile(tileset, layout, { column, row }, state.filter);
            if (tile) tiles.push(tile);
        }
    }
    return tiles;
}

/** The tile of `tiles` the selection ends on, else the first; null without any. */
export function focusTile(tileset: Tileset, tiles: readonly Tile[]): Tile | null {
    const selection = tilesetPanelStore.getState().selections[tileset.id];
    const layout = gridLayout(tileset, 1);
    const focus = selection ? tileset.tiles[tileIndex(layout, selection.focus)] : undefined;
    return (focus && tiles.includes(focus) ? focus : tiles[0]) ?? null;
}

/** The panel operations, bound to a panel store and a session store. */
export interface TilesetPanelActions {
    /** Shows the tab of tileset `id`. */
    showTileset(id: string): void;
    /** Shows the tab `delta` places along the list, if there is one (`[` and `]`). */
    cycleTileset(delta: number): void;
    /** Whether there is a tab `delta` places from the shown one. */
    canCycleTileset(delta: number): boolean;
    /** Sets the selection of tileset `id`. */
    select(id: string, anchor: GridPoint, focus: GridPoint): void;
    /**
     * Moves the shown tileset's selection by `(dx, dy)` positions, kept inside its grid; with
     * `extend` only its end moves (Shift). Without a selection the first tile is selected.
     */
    moveSelection(dx: number, dy: number, extend: boolean): void;
    /** Makes the shown tileset's selection the current stamp; false when it has no tile. */
    makeStamp(): boolean;
    setZoom(zoom: PanelZoom): void;
    setFilter(filter: string): void;
    setHovered(hovered: TilesetPanelState["hovered"]): void;
}

/** The tools that use the stamp, which a new stamp keeps (Tiled's `MapEditor::setStamp`). */
const STAMP_TOOLS: ReadonlySet<string> = new Set([
    "stamp",
    "bucket",
    "shapeFill",
    "shapeFillEllipse",
]);

export interface TilesetPanelBinding {
    /** Takes a new stamp; the default sets the app's current stamp and selects its tool. */
    takeStamp?(stamp: NonNullable<ReturnType<typeof selectionStamp>>): void;
}

function takeAppStamp(stamp: NonNullable<ReturnType<typeof selectionStamp>>): void {
    setCurrentStamp(stamp);
    if (!STAMP_TOOLS.has(toolState.selectedId())) toolState.select("stamp");
}

/** The operations of `store` on the project of `session`. */
export function tilesetPanelActions(
    store: StoreApi<TilesetPanelState>,
    session: StoreApi<SessionState>,
    binding: TilesetPanelBinding = {},
): TilesetPanelActions {
    const takeStamp = binding.takeStamp ?? takeAppStamp;
    const project = () => session.getState().session.project;
    const shown = () => shownTileset(project(), store.getState());
    /** The tileset `delta` tabs from the shown one; null past the ends. */
    const neighbour = (delta: number): Tileset | null => {
        const current = shown();
        const { tilesets } = project();
        return current ? (tilesets[tilesets.indexOf(current) + delta] ?? null) : null;
    };
    /** Shows tileset `id`; the tile under the pointer belonged to the tab shown before. */
    const show = (id: string) => store.setState({ activeTilesetId: id, hovered: null });
    const select = (id: string, anchor: GridPoint, focus: GridPoint) => {
        const { selections } = store.getState();
        store.setState({ selections: { ...selections, [id]: { anchor, focus } } });
    };
    return {
        showTileset(id) {
            if (store.getState().activeTilesetId !== id) show(id);
        },
        cycleTileset(delta) {
            const next = neighbour(delta);
            if (next) show(next.id);
        },
        canCycleTileset: (delta) => neighbour(delta) !== null,
        select,
        moveSelection(dx, dy, extend) {
            const tileset = shown();
            if (!tileset) return;
            const layout = gridLayout(tileset, 1);
            if (layout.rows === 0) return;
            const state = store.getState();
            const rect = selectionRect(tileset, state);
            const selection = state.selections[tileset.id];
            const origin = { column: 0, row: 0 };
            if (!rect || !selection) {
                select(tileset.id, origin, origin);
                return;
            }
            const clip = (value: number, size: number) => Math.min(Math.max(value, 0), size - 1);
            const from = {
                column: clip(selection.focus.column, layout.columns),
                row: clip(selection.focus.row, layout.rows),
            };
            const focus = {
                column: clip(from.column + dx, layout.columns),
                row: clip(from.row + dy, layout.rows),
            };
            const anchor = extend
                ? {
                      column: clip(selection.anchor.column, layout.columns),
                      row: clip(selection.anchor.row, layout.rows),
                  }
                : focus;
            select(tileset.id, anchor, focus);
        },
        makeStamp() {
            const tileset = shown();
            if (!tileset) return false;
            const state = store.getState();
            const rect = selectionRect(tileset, state);
            const stamp = rect ? selectionStamp(tileset, rect, state.filter) : null;
            if (!stamp) return false;
            takeStamp(stamp);
            return true;
        },
        setZoom(zoom) {
            if (store.getState().zoom !== zoom) store.setState({ zoom });
        },
        setFilter(filter) {
            if (store.getState().filter !== filter) store.setState({ filter });
        },
        setHovered(hovered) {
            const current = store.getState().hovered;
            const same =
                current === hovered ||
                (current !== null &&
                    hovered !== null &&
                    current.tilesetId === hovered.tilesetId &&
                    current.index === hovered.index);
            if (!same) store.setState({ hovered });
        },
    };
}

/**
 * Keeps `store` following the project of `session`: removed tilesets lose their selection, the
 * shown one's tab gives way to the tab that takes its place, and another project starts the
 * panel afresh. Returns the function that stops it.
 */
export function followProject(
    store: StoreApi<TilesetPanelState>,
    session: StoreApi<SessionState>,
): () => void {
    let project = session.getState().session.project;
    let ids = project.tilesets.map((each) => each.id);
    return session.subscribe((state) => {
        const next = state.session.project;
        const nextIds = next.tilesets.map((each) => each.id);
        if (next !== project) {
            project = next;
            ids = nextIds;
            store.setState({ ...initialState(), zoom: store.getState().zoom });
            return;
        }
        const kept = new Set(nextIds);
        const before = ids;
        ids = nextIds;
        const removed = before.filter((id) => !kept.has(id));
        if (removed.length === 0) return;
        const current = store.getState();
        const selections = { ...current.selections };
        for (const id of removed) delete selections[id];
        const hovered =
            current.hovered && kept.has(current.hovered.tilesetId) ? current.hovered : null;
        // The shown tab was removed: the first tab after it that is left, else the last.
        const shownId = current.activeTilesetId ?? before[0] ?? null;
        let activeTilesetId = current.activeTilesetId;
        if (shownId !== null && !kept.has(shownId)) {
            const after = before.slice(before.indexOf(shownId) + 1).find((id) => kept.has(id));
            activeTilesetId = after ?? nextIds.at(-1) ?? null;
        }
        store.setState({ selections, hovered, activeTilesetId });
    });
}

/** The panel operations of the app. */
export const tilesetPanel = tilesetPanelActions(tilesetPanelStore, sessionStore);

followProject(tilesetPanelStore, sessionStore);
