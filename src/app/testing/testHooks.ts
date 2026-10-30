import { assertInvariants } from "../../core/model";
import { recentCommands } from "../commandPalette/recentCommands";
import { appCommands } from "../commands/appCommands";
import type { CommandRegistry } from "../commands/registry";
import { keyContextStore } from "../keymap/contextState";
import { preferences } from "../preferences/preferences";
import type { PreferenceStore } from "../preferences/preferences";
import { bottomPanelStore } from "../shell/bottomPanel";
import { sessionStore } from "../state/session";
import { viewPreferences } from "../view/viewPreferences";

/**
 * What end-to-end tests reach in the page: the stores and the registry themselves. `App.tsx`
 * installs it in development builds only; the production bundle has no such global.
 */
export interface EditorTestHooks {
    readonly session: typeof sessionStore;
    readonly keyContexts: typeof keyContextStore;
    readonly bottomPanel: typeof bottomPanelStore;
    readonly commands: CommandRegistry;
    readonly preferences: PreferenceStore;
    readonly viewPreferences: typeof viewPreferences;
    readonly recentCommands: typeof recentCommands;
    /** Throws when the project violates an invariant of SPEC §2.1. */
    assertInvariants(): void;
}

declare global {
    interface Window {
        __ngneTest?: EditorTestHooks;
    }
}

/** Puts the hooks on `target.__ngneTest` and returns them. */
export function installTestHooks(target: Window = window): EditorTestHooks {
    const hooks: EditorTestHooks = {
        session: sessionStore,
        keyContexts: keyContextStore,
        bottomPanel: bottomPanelStore,
        commands: appCommands,
        preferences,
        viewPreferences,
        recentCommands,
        assertInvariants: () => assertInvariants(sessionStore.getState().session.project),
    };
    target.__ngneTest = hooks;
    return hooks;
}
