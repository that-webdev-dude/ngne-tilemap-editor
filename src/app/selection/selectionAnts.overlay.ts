import type { StoreApi } from "zustand/vanilla";
import type { Region } from "../../core/model";
import type {} from "../../import-meta";
import type { OverlayLayer } from "../overlay/types";
import { sessionStore } from "../state/session";
import type { SessionState } from "../state/session";
import { activeMap } from "../tools/toolSets";
import { ANTS_PERIOD } from "./antsGeometry";
import { boundaryOf } from "./boundaryCache";
import { pendingResult, pendingSelection, subscribePendingSelection } from "./pendingSelection";
import type { PendingSelection } from "./pendingSelection";
import { ANTS_DARK, ANTS_LIGHT, createRingPainter } from "./ringPainter";
import type {
    AntsSurface,
    AntsSurfaceContext,
    RingPainter,
    RingWork,
    SurfaceFactory,
} from "./ringPainter";

// The marching ants (DESIGN §4, SPEC §4.4; TE-020): the active map's tile selection drawn on
// the overlay as a 1 device pixel ring of black and white dashes just outside the selected
// cells (`antsGeometry.ts`); while a selection tool's gesture is in progress, the selection it
// would leave (`pendingSelection.ts`). They march 8 steps per second: a timer moves the dashes
// one pixel and asks for a redraw. The timer exists only while there is a selection to show
// and motion is allowed; under `prefers-reduced-motion: reduce` the dashes stand still. With
// no selection nothing is drawn and nothing asks for a redraw, so an idle editor still
// redraws nothing (TE-014).
//
// What a redraw costs does not depend on the selection (`ringPainter.ts`): the ring is painted
// once for a selection, a zoom and a canvas size, onto a surface of its own no larger than the
// canvas (none when no pixel of the ring is on it); a pan moves it and paints only the strips
// it uncovered; a new phase recolours it in one fill; each redraw is one `drawImage`. The
// boundary of the selection comes from the boundaries the overlay shares (`boundaryCache.ts`).

/** Order in the overlay's stack: over the cell grid (300), under the tool previews (600). */
export const SELECTION_ANTS_ORDER = 500;
/** se-design §6: 8 steps per second. */
export const ANTS_STEP_MS = 125;
export { ANTS_DARK, ANTS_LIGHT };
export type { AntsSurface, AntsSurfaceContext };

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** Whether motion is allowed, and its changes. */
export interface MotionSource {
    allowed(): boolean;
    /** Calls `listener` when the answer may have changed; returns the function that stops it. */
    subscribe(listener: () => void): () => void;
}

export interface SelectionAntsSources {
    session: StoreApi<SessionState>;
    /** The selection of a gesture in progress, and its changes. */
    pending: {
        get(): PendingSelection | null;
        subscribe(listener: () => void): () => void;
    };
    motion: MotionSource;
    /** Calls `tick` every `ms` milliseconds until the returned function is called. */
    every(tick: () => void, ms: number): () => void;
    /** Makes a surface; called when the ring's area changes size, and once for the tile. */
    surface: SurfaceFactory;
}

/** What tests read of the ants (development builds). */
export interface SelectionAntsProbe {
    /** The dash phase now, 0 to 3. */
    readonly phase: number;
    /** Steps the ants have marched since the layer was made. */
    readonly steps: number;
    /** True while the timer runs. */
    readonly animating: boolean;
    /** What the last draw did to the ring's pixels: kept, moved by a pan, painted, none. */
    readonly ringWork: RingWork;
}

declare module "../testing/testHooks" {
    interface EditorTestHooks {
        /** The marching ants (TE-020). */
        selectionAnts?: SelectionAntsProbe;
    }
}

/** The ants' draw layer and its probe. */
export interface SelectionAntsLayer {
    layer: OverlayLayer;
    probe: SelectionAntsProbe;
}

/**
 * The selection shown on map `mapId`: the pending one of a gesture on it, else the map's own;
 * null without either.
 */
function selectionOn(
    state: SessionState,
    pending: PendingSelection | null,
    mapId: string,
): Region | null {
    const current = state.session.perMap.get(mapId)?.tileSelection ?? null;
    return pending?.mapId === mapId ? pendingResult(current, pending) : current;
}

/** The selection shown on the active map; null without one. */
function shownSelection(state: SessionState, pending: PendingSelection | null): Region | null {
    const map = activeMap(state.session);
    return map ? selectionOn(state, pending, map.id) : null;
}

/** The draw layer of the ants on `sources`. The probe goes on the page with the overlay. */
export function createSelectionAntsLayer(sources: SelectionAntsSources): SelectionAntsLayer {
    let phase = 0;
    let steps = 0;
    let stopTimer: (() => void) | null = null;
    const painter: RingPainter = createRingPainter(sources.surface);

    /** Lets go of what was kept for a selection. */
    const release = () => painter.release();

    const probe: SelectionAntsProbe = {
        get phase() {
            return phase;
        },
        get steps() {
            return steps;
        },
        get animating() {
            return stopTimer !== null;
        },
        get ringWork() {
            return painter.last.work;
        },
    };

    const layer: OverlayLayer = {
        id: "selection-ants",
        order: SELECTION_ANTS_ORDER,
        draw({ context, map, mapping, size }) {
            const state = sources.session.getState();
            const selection = selectionOn(state, sources.pending.get(), map.id);
            if (!selection) {
                release();
                return;
            }
            const corner = mapping.cellToDevice(0, 0);
            const far = mapping.cellToDevice(map.width, map.height);
            const rect = {
                x: corner.x,
                y: corner.y,
                width: far.x - corner.x,
                height: far.y - corner.y,
            };
            painter.draw(
                context,
                { key: selection, bounds: selection, boundary: () => boundaryOf(selection) },
                { rect, doc: { width: map.width, height: map.height }, size },
                phase,
            );
        },
        watch(redraw) {
            const { session, pending, motion } = sources;
            let shown = shownSelection(session.getState(), pending.get());
            // The timer runs while there is a selection and motion is allowed, and only then.
            const sync = () => {
                const wanted = shown !== null && motion.allowed();
                if (wanted && !stopTimer) {
                    stopTimer = sources.every(() => {
                        phase = (phase + 1) % ANTS_PERIOD;
                        steps++;
                        redraw();
                    }, ANTS_STEP_MS);
                } else if (!wanted && stopTimer) {
                    stopTimer();
                    stopTimer = null;
                }
            };
            // A cell edit, a setting or a view change leaves the selection as it is: no redraw
            // from here (the overlay follows the view itself).
            const follow = () => {
                const next = shownSelection(session.getState(), pending.get());
                if (next === shown) return;
                shown = next;
                if (!shown) release();
                redraw();
                sync();
            };
            const stopSession = session.subscribe(follow);
            const stopPending = pending.subscribe(follow);
            const stopMotion = motion.subscribe(sync);
            sync();
            const hooks =
                import.meta.env.DEV && typeof window !== "undefined"
                    ? window.__ngneTest
                    : undefined;
            if (hooks) hooks.selectionAnts = probe;
            return () => {
                stopSession();
                stopPending();
                stopMotion();
                stopTimer?.();
                stopTimer = null;
                release();
                if (hooks?.selectionAnts === probe) delete hooks.selectionAnts;
            };
        },
    };
    return { layer, probe };
}

/** `prefers-reduced-motion` of the page; motion is allowed where there is no page. */
const pageMotion: MotionSource = {
    allowed: () => typeof matchMedia !== "function" || !matchMedia(REDUCED_MOTION).matches,
    subscribe(listener) {
        if (typeof matchMedia !== "function") return () => {};
        const query = matchMedia(REDUCED_MOTION);
        query.addEventListener("change", listener);
        return () => query.removeEventListener("change", listener);
    },
};

export const overlayLayers: OverlayLayer[] = [
    createSelectionAntsLayer({
        session: sessionStore,
        pending: { get: pendingSelection, subscribe: subscribePendingSelection },
        motion: pageMotion,
        every(tick, ms) {
            const timer = setInterval(tick, ms);
            return () => clearInterval(timer);
        },
        surface(width, height) {
            const canvas = new OffscreenCanvas(width, height);
            const context = canvas.getContext("2d");
            if (!context) throw new Error("The marching ants have no 2D context.");
            return { width, height, image: canvas, context };
        },
    }).layer,
];
