import type { StoreApi } from "zustand/vanilla";
import { createMapSession } from "../../core/model";
import type { ProjectMap } from "../../core/model";
import type { DeviceSize } from "../../engine/viewport/geometry";
import type { SessionState } from "../state/session";
import type { Point, ViewMapping } from "../view/coordinates";
import { DEFAULT_OVERLAY_THEME } from "./types";
import type { OverlayCursor, OverlayFrame, OverlayLayer, OverlayTheme } from "./types";

// When and how the overlay redraws (ENGINE §4, TE-014). No DOM here: the size and the pointer
// are reported by `mountOverlay`, so the policy is unit-tested in Node.
//
// A redraw clears the canvas and runs every draw layer bottom to top. It happens only when
//
//   - the view changed: the active map, its size or tile size, or its view (centre, zoom), or
//     the canvas's size;
//   - the cursor moved to another device pixel, or entered or left the viewport;
//   - a layer asked for it (`OverlayLayer.watch`), or the theme changed;
//
// and at most once per animation frame. A change of the canvas's size clears the canvas
// itself, so it is drawn again at once, in the same task. Nothing else draws: an idle editor
// redraws nothing, and a history step that changes cells only does not reach the overlay.

/** Where the overlay draws. `HTMLCanvasElement` is one; tests pass a recording stand-in. */
export interface OverlayCanvas {
    width: number;
    height: number;
}

export interface OverlaySources {
    session: StoreApi<SessionState>;
    /**
     * The mapping of the active map as it is on screen now, or null while the viewport
     * element is not on the page (`currentViewMapping`). Read at each redraw, never kept.
     */
    mapping(): ViewMapping | null;
    /** Device pixels per CSS pixel now. */
    ratio(): number;
    /** Calls `callback` in the next animation frame; returns the function that cancels it. */
    nextFrame(callback: () => void): () => void;
    /** A layer threw while drawing or watching; once per layer and message. */
    onError?(layer: string, error: unknown): void;
}

export interface OverlayController {
    /** Redraws so far: the counter of the test hook. */
    readonly redraws: number;
    /** True while a redraw is scheduled and has not run. */
    readonly pending: boolean;
    /** The canvas's backing size. */
    readonly size: Readonly<DeviceSize>;
    /** The canvas has this backing size: it is cleared and drawn again at once. */
    resize(size: DeviceSize): void;
    /** The pointer moved over the viewport to `client` (CSS pixels), or left it (null). */
    setCursor(client: Point | null): void;
    setTheme(theme: OverlayTheme): void;
    /** Asks for a redraw in the next animation frame. */
    requestRedraw(): void;
    /** The mapping a redraw would draw with now; null while no map is open or mounted. */
    mapping(): ViewMapping | null;
    /** Stops following the stores and the layers. The canvas keeps what it shows. */
    dispose(): void;
}

function activeMap(state: SessionState): ProjectMap | undefined {
    const { project, activeMapId } = state.session;
    return project.maps.find((map) => map.id === activeMapId);
}

/** What makes the view drawn differ: the map, its geometry and its view. */
function viewKey(state: SessionState): string {
    const map = activeMap(state);
    if (!map) return "";
    const { view } = state.session.perMap.get(map.id) ?? createMapSession(map);
    return [
        map.id,
        `${map.width}x${map.height}`,
        `${map.tileWidth}x${map.tileHeight}`,
        `${view.zoom}@${view.centreX},${view.centreY}`,
    ].join("|");
}

/**
 * The canvas pixel a client position lies in, as a key: from the mapping, which takes a
 * position within 1/128 of a device pixel as that pixel, as the readout and the tools do
 * (Chrome reports device pixel 102 at a ratio of 1.25 as 81.5999984741211 CSS pixels). Only
 * without a mapping (no map) from the ratio alone.
 */
function devicePixelKey(client: Point | null, mapping: ViewMapping | null, ratio: number): string {
    if (!client) return "";
    if (!mapping) return `~${Math.floor(client.x * ratio)},${Math.floor(client.y * ratio)}`;
    const device = mapping.clientToDevice(client.x, client.y);
    return `${Math.floor(device.x)},${Math.floor(device.y)}`;
}

/** The message of a thrown value. */
function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * The overlay's drawing: `layers` (bottom first) on `context`, which draws on `canvas`,
 * following `sources`. The first redraw is asked for here.
 */
export function createOverlayController(
    canvas: OverlayCanvas,
    context: CanvasRenderingContext2D,
    layers: readonly OverlayLayer[],
    sources: OverlaySources,
): OverlayController {
    const { session } = sources;
    let theme: OverlayTheme = { ...DEFAULT_OVERLAY_THEME };
    let cursor: Point | null = null;
    let cursorKey = "";
    let shownView = viewKey(session.getState());
    let cancelFrame: (() => void) | null = null;
    let redraws = 0;
    let disposed = false;

    const reported = new Set<string>();
    const report = (layer: OverlayLayer, error: unknown) => {
        const key = `${layer.id}\n${messageOf(error)}`;
        if (reported.has(key)) return;
        reported.add(key);
        console.error(`Overlay layer "${layer.id}":`, error);
        try {
            sources.onError?.(layer.id, error);
        } catch {
            // Reporting is best effort.
        }
    };

    const mappingNow = (): ViewMapping | null =>
        activeMap(session.getState()) ? sources.mapping() : null;

    const cursorFor = (mapping: ViewMapping): OverlayCursor | null => {
        if (!cursor) return null;
        const device = mapping.clientToDevice(cursor.x, cursor.y);
        return {
            client: { ...cursor },
            device,
            map: mapping.deviceToMap(device.x, device.y),
            cell: mapping.deviceToCell(device.x, device.y),
        };
    };

    const draw = () => {
        cancelFrame?.();
        cancelFrame = null;
        redraws++;
        const size = { width: canvas.width, height: canvas.height };
        context.clearRect(0, 0, size.width, size.height);
        if (size.width === 0 || size.height === 0) return;
        const map = activeMap(session.getState());
        const mapping = mappingNow();
        if (!map || !mapping) return;
        const frame: OverlayFrame = {
            context,
            size,
            map,
            mapping,
            cursor: cursorFor(mapping),
            theme,
        };
        for (const layer of layers) {
            context.save();
            try {
                layer.draw(frame);
            } catch (error) {
                // One layer that fails leaves the others drawn.
                report(layer, error);
            } finally {
                context.restore();
            }
        }
    };

    const requestRedraw = () => {
        if (disposed || cancelFrame) return;
        cancelFrame = sources.nextFrame(() => {
            cancelFrame = null;
            if (!disposed) draw();
        });
    };

    const stopSession = session.subscribe((state) => {
        const next = viewKey(state);
        if (next === shownView) return;
        shownView = next;
        requestRedraw();
    });
    const stopLayers = layers.map((layer) => {
        try {
            return layer.watch?.(requestRedraw) ?? (() => {});
        } catch (error) {
            report(layer, error);
            return () => {};
        }
    });
    requestRedraw();

    return {
        get redraws() {
            return redraws;
        },
        get pending() {
            return cancelFrame !== null;
        },
        get size() {
            return { width: canvas.width, height: canvas.height };
        },
        resize(size) {
            if (disposed || (size.width === canvas.width && size.height === canvas.height)) {
                return;
            }
            // Setting the size clears the canvas: drawn again before the browser paints it.
            canvas.width = size.width;
            canvas.height = size.height;
            draw();
        },
        setCursor(client) {
            cursor = client ? { x: client.x, y: client.y } : null;
            const key = devicePixelKey(cursor, cursor ? mappingNow() : null, sources.ratio());
            if (key === cursorKey) return;
            cursorKey = key;
            requestRedraw();
        },
        setTheme(next) {
            const same =
                next.ink === theme.ink &&
                next.accent === theme.accent &&
                next.danger === theme.danger;
            if (same) return;
            theme = { ...next };
            requestRedraw();
        },
        requestRedraw,
        mapping: mappingNow,
        dispose() {
            if (disposed) return;
            disposed = true;
            cancelFrame?.();
            cancelFrame = null;
            stopSession();
            for (const stop of stopLayers) {
                try {
                    stop();
                } catch {
                    // A layer that cannot stop is gone with the overlay.
                }
            }
        },
    };
}
