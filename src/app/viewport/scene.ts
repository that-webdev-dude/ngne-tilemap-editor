import { createMapSession } from "../../core/model";
import type { ViewportScene } from "../../engine/viewport";
import type { Preferences } from "../preferences/preferences";
import type { SessionState } from "../state/session";

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
}

/** The scene of the active map; null while the project has no map. */
export function readScene({
    session,
    preferences,
    themeChecker,
    dpr,
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
    };
}
