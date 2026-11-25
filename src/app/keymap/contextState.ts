import { createKeyContextStore, setKeyContext as setStateContext } from "@ngne/editor-ui/commands";
import { STATE_CONTEXTS } from "../commands/commandTypes";

/**
 * The two keymap contexts of DESIGN §10.1 that follow editor state instead of focus. The
 * feature that owns the state switches its context on and off: the polygon and polyline
 * marker tools, the collision polygon, the shape fill and the terrain line for `gesture`; the
 * marker selection of a marker layer for `markers`. The store is the editor UI instance's
 * (`sources.keyContextState`, @ngne/editor-ui SPEC §5): it imports no instance, so those
 * features switch it without importing `src/app/editorUi.ts`, and the keymap resolves with it.
 */
export const keyContextStore = createKeyContextStore(STATE_CONTEXTS);

/** The state contexts and whether each is on. */
export type KeyContextState = ReturnType<typeof keyContextStore.getState>;

export function setKeyContext(context: keyof KeyContextState, active: boolean): void {
    setStateContext(keyContextStore, context, active);
}
