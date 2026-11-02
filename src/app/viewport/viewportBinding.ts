import type { StoreApi } from "zustand/vanilla";
import type { Touched } from "../../core/history";
import type { Viewport } from "../../engine/viewport";
import type { SessionState } from "../state/session";
import { TilesetUsage, openMapIds } from "./mapTilesets";
import { subscribeStrokeCells } from "./strokeCells";

/**
 * Connects a viewport to the session store (ENGINE §4, redraw on demand): a frame is asked for
 * when the project or its session state changes, and the viewport's tileset textures follow the
 * tilesets the open maps use. Returns the function that disconnects it.
 */
export function bindViewport(viewport: Viewport, store: StoreApi<SessionState>): () => void {
    const usage = new TilesetUsage();
    let unsubscribeHistory: (() => void) | null = null;
    let history = store.getState().history;

    const sync = () => {
        const { session } = store.getState();
        viewport.useTilesets(usage.tilesetsOf(session.project, openMapIds(session)));
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

    // A stroke's cells show before it ends (SPEC §3): live quads, chunk patches.
    const unsubscribeStroke = subscribeStrokeCells((touched) => viewport.noteTouched(touched));

    follow();
    sync();
    viewport.requestRedraw();

    return () => {
        unsubscribeStore();
        unsubscribeHistory?.();
        unsubscribeStroke();
    };
}
