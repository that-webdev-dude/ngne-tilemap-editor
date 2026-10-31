import { sessionStore } from "../state/session";
import { clampActiveView } from "./viewNavigation";
import { viewportSize } from "./viewportSize";

// The views a map keeps without the user navigating (TE-014).
//
// Pan limit. At least 32 device pixels of the active map stay visible (`clampView`). The user
// cannot pan past that; the viewport can get there by changing its size, and a map can come
// back as the active one with a view that was set under a larger viewport. So the limit is
// applied again when the viewport's size changes and when another map becomes the active one.
// The view is moved, never fitted, and only when the limit asks for it.

/**
 * Keeps the active map's view inside the pan limits when the viewport's size changes or
 * another map becomes active. Returns the function that stops it.
 */
export function connectViewPolicy(): () => void {
    let active = sessionStore.getState().session.activeMapId;
    const stopSession = sessionStore.subscribe((state) => {
        const next = state.session.activeMapId;
        if (next === active) return;
        active = next;
        clampActiveView();
    });
    const stopSize = viewportSize.subscribe(clampActiveView);
    clampActiveView();
    return () => {
        stopSize();
        stopSession();
    };
}
