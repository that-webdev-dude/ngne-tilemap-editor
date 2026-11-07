import type { StoreApi } from "zustand/vanilla";
import type { Touched } from "../../core/history";
import type { Viewport } from "../../engine/viewport";
import { preferences } from "../preferences/preferences";
import { viewPreferences } from "../view/viewPreferences";
import type { SessionState } from "../state/session";
import type { MapTabsState } from "../tabs/tabs";
import { TilesetUsage, openMapIds } from "./mapTilesets";
import { subscribeStrokeCells } from "./strokeCells";

/**
 * Connects a viewport to the session store (ENGINE §4, redraw on demand): a frame is asked for
 * when the project or its session state changes, and the viewport's tileset textures follow the
 * tilesets the maps of the open tabs (`tabs`) use: a texture no open map uses is released
 * (ENGINE §3). Returns the function that disconnects it.
 */
export function bindViewport(
    viewport: Viewport,
    store: StoreApi<SessionState>,
    tabs: StoreApi<MapTabsState>,
): () => void {
    const usage = new TilesetUsage();
    let unsubscribeHistory: (() => void) | null = null;
    let history = store.getState().history;

    /** The maps of the last `sync`. */
    let shown: readonly string[] = [];

    const sync = () => {
        const { session } = store.getState();
        const open = openMapIds(session, tabs.getState().open);
        // A map that closed is forgotten: it is scanned again when it opens (ENGINE §3), so
        // cells erased while it was open no longer keep a texture.
        for (const id of shown) if (!open.includes(id)) usage.forget(id);
        shown = open;
        viewport.useTilesets(usage.tilesetsOf(session.project, open));
    };

    const onTouched = (touched: Touched) => {
        const { project } = store.getState().session;
        const map =
            touched.mapId === null ? undefined : project.maps.find((m) => m.id === touched.mapId);
        if (touched.structure) {
            if (map) usage.forget(map.id);
            else usage.reset();
        } else if (map && touched.cellRects.length > 0) {
            usage.noteCells(map, touched.cellRects);
        }
        if (touched.tilesetIds.length > 0) viewport.invalidateTilesets(touched.tilesetIds);
        viewport.noteTouched(touched);
        sync();
    };

    const follow = () => {
        unsubscribeHistory?.();
        history = store.getState().history;
        unsubscribeHistory = history.subscribe((change) => onTouched(change.touched));
    };

    const unsubscribeStore = store.subscribe((state, previous) => {
        if (state.history !== previous.history) {
            usage.reset();
            follow();
        }
        sync();
        viewport.requestRedraw();
    });

    // Highlight Current Layer and its opacity are read with the scene (scene.ts).
    const unsubscribeHighlight = viewPreferences.subscribe((state, previous) => {
        if (state.highlightLayer !== previous.highlightLayer) viewport.requestRedraw();
    });
    const unsubscribePreferences = preferences.subscribe((key) => {
        if (key === "highlight") viewport.requestRedraw();
    });

    // A closed tab releases what only its map used.
    const unsubscribeTabs = tabs.subscribe(sync);

    // A stroke's cells show before it ends (SPEC §3): live quads, chunk patches.
    const unsubscribeStroke = subscribeStrokeCells((touched) => viewport.noteTouched(touched));

    follow();
    sync();
    viewport.requestRedraw();

    return () => {
        unsubscribeStore();
        unsubscribeHighlight();
        unsubscribePreferences();
        unsubscribeTabs();
        unsubscribeHistory?.();
        unsubscribeStroke();
    };
}
