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

/** The viewport as end-to-end tests reach it (TE-013); null while there is none. */
export interface ViewportProbe {
    readonly canvas: HTMLCanvasElement;
    /** The renderer's status: "ready", "recovering" or "failed". */
    readonly status: string;
    /** Frames submitted, and the sprites and draw calls of the last frame. */
    readonly stats: Readonly<{
        frames: number;
        sprites: number;
        drawCalls: number;
        lastDrawMs: number;
        lastBuildMs: number;
    }>;
    /**
     * Submits a frame now. Read the canvas in the same task: a WebGPU canvas holds its image
     * only until the frame is presented.
     */
    renderNow(): boolean;
    /** IDs of the manual textures the renderer holds. */
    textureIds(): string[];
    /** Renderers this page has created. */
    rendererCreations(): number;
}

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
    /** Set by the viewport host while it is mounted. */
    viewport: ViewportProbe | null;
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
        viewport: null,
        assertInvariants: () => assertInvariants(sessionStore.getState().session.project),
    };
    target.__ngneTest = hooks;
    return hooks;
}

/** Publishes (or clears) the viewport probe; nothing happens where the hooks are not installed. */
export function setViewportProbe(probe: ViewportProbe | null): void {
    if (window.__ngneTest) window.__ngneTest.viewport = probe;
}
