// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { viewPreferences } from "../../../src/app/view/viewPreferences";
import { findLayer } from "../../../src/core/model";
import type { LayerHighlight } from "../../../src/core/model";

// Highlight Current Layer as the readback references take it (SPEC §7.2, TE-034): when the view
// preference is on, every layer outside the active layer of the active map is expected at the
// Preferences' highlight opacity. Derived here from the stores, not from the viewport's scene,
// so a scene that dropped or misread the highlight shows as a mismatch. Null when it is off,
// which leaves the TE-013 and TE-015 references as they were.

export function referenceHighlight(): LayerHighlight | null {
    if (!viewPreferences.getState().highlightLayer) return null;
    const hooks = window.__ngneTest!;
    const { session } = hooks.session.getState();
    const map = session.project.maps.find((each) => each.id === session.activeMapId);
    const layerId = session.perMap.get(session.activeMapId)?.activeLayerId;
    if (!map || layerId === undefined || !findLayer(map, layerId)) return null;
    return { layerId, factor: hooks.preferences.get("highlight").opacity / 100 };
}
