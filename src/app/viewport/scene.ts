import { createMapSession, findLayer } from "../../core/model";
import type { LayerHighlight, ProjectMap, ProjectSession } from "../../core/model";
import type { ViewportScene } from "../../engine/viewport";
import type { Preferences } from "../preferences/preferences";
import type { SessionState } from "../state/session";
import { viewPreferences } from "../view/viewPreferences";

// What the viewport shows, read from the stores at each draw (SPEC §3, §7).

/** The two checkerboard colours of the current theme, as 0xRRGGBB. */
export interface ThemeChecker {
    a: number;
    b: number;
}

export interface SceneInputs {
    session: SessionState;
    preferences: Preferences;
    themeChecker: ThemeChecker;
    /** Device pixels per CSS pixel. */
    dpr: number;
    /** Highlight Current Layer; the view preference (SPEC §3) when absent. */
    highlightLayer?: boolean;
}

/**
 * Highlight Current Layer (SPEC §7.2) for `map`: the other layers at `percent` of their opacity
 * (the Preferences value, 25% by default). Null when it is off or the map has no active layer.
 */
export function layerHighlight(
    session: ProjectSession,
    map: ProjectMap,
    on: boolean,
    percent: number,
): LayerHighlight | null {
    if (!on) return null;
    const layerId = (session.perMap.get(map.id) ?? createMapSession(map)).activeLayerId;
    if (!findLayer(map, layerId)) return null;
    return { layerId, factor: Math.max(0, Math.min(100, percent)) / 100 };
}

/** The scene of the active map; null while the project has no map. */
export function readScene({
    session,
    preferences,
    themeChecker,
    dpr,
    highlightLayer = viewPreferences.getState().highlightLayer,
}: SceneInputs): ViewportScene | null {
    const { project, activeMapId, perMap } = session.session;
    const map = project.maps.find((each) => each.id === activeMapId);
    if (!map) return null;
    const { colors, size } = preferences.checkerboard;
    const view = perMap.get(map.id)?.view ?? createMapSession(map).view;
    return {
        project,
        map,
        view,
        dpr,
        checker: colors === "theme" ? { ...themeChecker, size } : { ...colors, size },
        highlight: layerHighlight(
            session.session,
            map,
            highlightLayer,
            preferences.highlight.opacity,
        ),
    };
}
