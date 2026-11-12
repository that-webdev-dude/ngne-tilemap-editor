import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import type { ProjectSession } from "../../core/model";
import { sessionStore } from "./session";
import type { SessionState } from "./session";

// What the dock's sections show of the session. The canvas comes first: a switch to another
// map is drawn by the viewport at the next animation frame, and sections that rendered the new
// map's layers and properties in the task of the switch would delay that frame by their
// render. So the sections that show the active map read the session through this store. It
// follows `sessionStore` at once, except while the active map is another than the one shown:
// then it stays as it is until the frame of the switch has been drawn, and takes the newest
// state. The wait is the sprite editor's for its timeline panel (its `useShownTimeline`): two
// animation frames, then the main thread idle, at the latest `LATEST_MS` later.
//
// A section that is behind shows the rows of the map before; `current()` is false meanwhile,
// and such a section takes no input (`ui/panels/showsActiveMap.tsx`).

/** The session as the dock's sections show it. */
export interface ShownSession {
    readonly open: boolean;
    /** The mutable session of `sessionStore`: what it holds is never behind. */
    readonly session: ProjectSession;
    /** `sessionStore`'s revision when this was brought up to date. */
    readonly revision: number;
    /** The map shown: the active map when this was brought up to date. */
    readonly mapId: string;
}

/** Runs `update` once the frame of a change has been drawn; returns what cancels it. */
export type AfterFrame = (update: () => void) => () => void;

/** Once idle, at the latest this long after the frames it waits for, the sections follow (ms). */
const LATEST_MS = 50;

const afterFrame: AfterFrame = (update) => {
    let idle: number | null = null;
    let frame: number | null = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
            frame = null;
            idle = requestIdleCallback(update, { timeout: LATEST_MS });
        });
    });
    return () => {
        if (frame !== null) cancelAnimationFrame(frame);
        if (idle !== null) cancelIdleCallback(idle);
    };
};

export interface ShownSessionSource {
    readonly store: StoreApi<ShownSession>;
    /** Whether the sections show the active map: false while they wait for a switch's frame. */
    current(): boolean;
    dispose(): void;
}

/** The shown session of `source`; `later` waits for the frame of a switch (tests give theirs). */
export function createShownSession(
    source: StoreApi<SessionState>,
    later: AfterFrame = afterFrame,
): ShownSessionSource {
    const read = (): ShownSession => {
        const { open, session, revision } = source.getState();
        return { open, session, revision, mapId: session.activeMapId };
    };
    const store = createStore<ShownSession>(() => read());
    let cancel: (() => void) | null = null;
    /** Whether the active map is another map of the same project than the one shown. */
    const behind = (): boolean => {
        const { open, session } = source.getState();
        const shown = store.getState();
        return (
            open === shown.open &&
            session === shown.session &&
            session.activeMapId !== shown.mapId &&
            session.project.maps.some((map) => map.id === shown.mapId)
        );
    };
    const stop = source.subscribe(() => {
        if (behind()) {
            cancel ??= later(() => {
                cancel = null;
                store.setState(read());
            });
            return;
        }
        cancel?.();
        cancel = null;
        store.setState(read());
    });
    return {
        store,
        current: () => !behind(),
        dispose() {
            stop();
            cancel?.();
            cancel = null;
        },
    };
}

/** The app's shown session, of `sessionStore`. */
export const shownSession: ShownSessionSource = createShownSession(sessionStore);

/** What a dock section shows of the session (see the top of this file). */
export function useShownSession<Slice>(selector: (state: ShownSession) => Slice): Slice {
    return useStore(shownSession.store, selector);
}
