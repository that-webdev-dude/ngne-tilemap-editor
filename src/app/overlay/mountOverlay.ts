import type { DeviceSize } from "../../engine/viewport/geometry";
import type {} from "../../import-meta";
import { sessionStore } from "../state/session";
import type { ViewMapping } from "../view/coordinates";
import { currentViewMapping } from "../view/viewNavigation";
import { createOverlayController } from "./overlayController";
import { overlayLayers } from "./overlayLayers";
import type { OverlayLayer, OverlayTheme } from "./types";

/** What tests read of the overlay on screen (TE-014). */
export interface OverlayProbe {
    /** Redraws since the overlay was mounted. */
    readonly redraws: number;
    /** True while a redraw is scheduled and has not run. */
    readonly pending: boolean;
    /** The canvas's backing size: the viewport element's, in device pixels. */
    readonly canvasSize: DeviceSize;
    /** The overlay canvas itself, for readbacks. */
    readonly canvas: HTMLCanvasElement;
    /** The ids of the draw layers, bottom first. */
    readonly layers: readonly string[];
}

declare module "../testing/testHooks" {
    interface EditorTestHooks {
        /** The overlay on screen (TE-014): its redraw counter, size and canvas. */
        overlay?: OverlayProbe;
    }
}

/** The overlay of the app, mounted on its canvas. */
export interface MountedOverlay {
    /** The viewport element has this size in device pixels: the canvas takes it. */
    resize(size: DeviceSize): void;
    setTheme(theme: OverlayTheme): void;
    /**
     * The mapping of the active map as it is on screen, which client positions go through (see
     * `OverlayController.mapping`).
     */
    mapping(): ViewMapping | null;
    dispose(): void;
}

const MIDDLE_BUTTON = 1;

/**
 * Makes `canvas` the overlay of the viewport element `container` (ENGINE §4, TE-014): it is
 * drawn by the registered draw layers over the NGNE canvas. It is the pointer target of the
 * viewport: a pointer down on it focuses `container`, except with the middle button, which pans
 * and moves no focus. It stops no event: wheel and pointer events reach the listeners of view
 * navigation on `container` by bubbling. In development builds its probe is put on
 * `window.__ngneTest`.
 *
 * Its backing size is that of the NGNE canvas (`resize`, called with the size the viewport
 * host measured), and both fill the same box.
 */
export function mountOverlay(
    canvas: HTMLCanvasElement,
    container: HTMLElement,
    layers: readonly OverlayLayer[] = overlayLayers,
): MountedOverlay {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The overlay canvas has no 2D context.");
    // No pixels until the host has measured the viewport, rather than the default 300 × 150
    // stretched.
    canvas.width = 0;
    canvas.height = 0;
    const controller = createOverlayController(canvas, context, layers, {
        session: sessionStore,
        mapping: currentViewMapping,
        ratio: () => window.devicePixelRatio,
        nextFrame(callback) {
            const request = requestAnimationFrame(() => callback());
            return () => cancelAnimationFrame(request);
        },
    });

    // A tool may cancel the default of its pointer down, which is what focuses an element; the
    // overlay focuses the viewport element itself.
    const onPointerDown = (event: PointerEvent) => {
        if (event.button !== MIDDLE_BUTTON) container.focus({ preventScroll: true });
    };
    // The cursor is followed on the viewport element: a drag that holds the pointer there
    // (a pan) still reports it.
    const onPointer = (event: PointerEvent) =>
        controller.setCursor({ x: event.clientX, y: event.clientY });
    const onPointerLeave = () => controller.setCursor(null);
    canvas.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointerdown", onPointer);
    container.addEventListener("pointermove", onPointer);
    container.addEventListener("pointerleave", onPointerLeave);

    const hooks = import.meta.env.DEV ? window.__ngneTest : undefined;
    const probe: OverlayProbe = {
        get redraws() {
            return controller.redraws;
        },
        get pending() {
            return controller.pending;
        },
        get canvasSize() {
            return controller.size;
        },
        canvas,
        layers: layers.map((layer) => layer.id),
    };
    if (hooks) hooks.overlay = probe;

    return {
        resize: (size) => controller.resize(size),
        setTheme: (theme) => controller.setTheme(theme),
        mapping: () => controller.mapping(),
        dispose() {
            if (hooks?.overlay === probe) delete hooks.overlay;
            canvas.removeEventListener("pointerdown", onPointerDown);
            container.removeEventListener("pointerdown", onPointer);
            container.removeEventListener("pointermove", onPointer);
            container.removeEventListener("pointerleave", onPointerLeave);
            controller.dispose();
        },
    };
}
