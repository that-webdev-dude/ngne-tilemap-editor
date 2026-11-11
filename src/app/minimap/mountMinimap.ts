import { mapPixels, minimapToMap, minimapViewRect } from "../../core/compositor";
import type { Rect, Size } from "../../core/compositor";
import type { History } from "../../core/history";
import type { ProjectMap } from "../../core/model";
import { createMapSession } from "../../core/model";
import type {} from "../../import-meta";
import { sessionStore } from "../state/session";
import { panBy } from "../view/viewNavigation";
import { viewportSize } from "../view/viewportSize";
import { MinimapRenderer } from "./minimapRenderer";
import type { MinimapStats } from "./minimapRenderer";

// The Minimap dock section's behaviour (DESIGN §8.8; TE-057): the image of the active map at
// the section's width, the viewport's rectangle over it, and the drag that pans the viewport.
// The image is redrawn when a history step touches the shown map or a tileset (a change that
// settled), at most once per 500 ms; another map, project or width redraws at once. The dock
// mounts the section's body only while it is expanded, so a collapse stops the minimap.

/** The minimap as end-to-end tests reach it (TE-057). */
export interface MinimapProbe {
    readonly canvas: HTMLCanvasElement;
    /** The image in its own pixels (the canvas's backing size). */
    readonly size: Size;
    /** The viewport's rectangle as drawn, in image pixels; null when none is drawn. */
    readonly frame: Rect | null;
    stats(): MinimapStats;
    /** Starts a full redraw now, as another map would. */
    redrawNow(): void;
}

declare module "../testing/testHooks" {
    interface EditorTestHooks {
        /** The Minimap section while it is expanded (TE-057). */
        minimap?: MinimapProbe;
    }
}

export interface MountedMinimap {
    dispose(): void;
}

export interface MinimapElements {
    /** The element whose width the image takes. */
    box: HTMLElement;
    /** Holds the canvas and the frame, the image's size; takes the pointer. */
    stage: HTMLElement;
    canvas: HTMLCanvasElement;
    /** The viewport's rectangle: a 1 px `--accent` outline. */
    frame: HTMLElement;
}

/** The active map of the open project, or null. */
function shown(): { map: ProjectMap } | null {
    const { open, session } = sessionStore.getState();
    if (!open) return null;
    const map = session.project.maps.find((each) => each.id === session.activeMapId);
    return map ? { map } : null;
}

/** Creates the minimap in `elements` and connects it to the stores. */
export function mountMinimap(elements: MinimapElements): MountedMinimap {
    const { box, stage, canvas, frame } = elements;
    const hooks = import.meta.env.DEV ? window.__ngneTest : undefined;
    const context = canvas.getContext("2d", { colorSpace: "srgb" });
    if (!context) throw new Error("The minimap needs a 2D canvas context.");

    /** The image on the canvas, in image pixels, the map it shows, and the frame drawn. */
    let size: Size = { width: 0, height: 0 };
    let imageMap: ProjectMap | null = null;
    /** The map's size in map pixels when the image was composited. */
    let imagePixels: Size = { width: 0, height: 0 };
    let drawnFrame: Rect | null = null;

    const renderer = new MinimapRenderer({
        content: () => {
            const current = shown();
            return current
                ? { project: sessionStore.getState().session.project, map: current.map }
                : null;
        },
        onImage: (image, content) => {
            size = { width: image.width, height: image.height };
            imageMap = content?.map ?? null;
            imagePixels = content ? mapPixels(content.map) : { width: 0, height: 0 };
            canvas.width = image.width;
            canvas.height = image.height;
            const dpr = window.devicePixelRatio;
            canvas.style.width = `${image.width / dpr}px`;
            canvas.style.height = `${image.height / dpr}px`;
            stage.hidden = image.width === 0;
            if (image.width > 0) {
                // Pixel buffers never sit on shared memory.
                const data = image.data as Uint8ClampedArray<ArrayBuffer>;
                context.putImageData(new ImageData(data, image.width, image.height), 0, 0);
            }
            placeFrame();
        },
    });

    /**
     * The shown map when the image on the canvas is of it at its present size: the frame and a
     * press map onto the image only then. A resize changes the map in place, so until its
     * redraw the image shows other dimensions.
     */
    const imageOf = (): ProjectMap | null => {
        const map = shown()?.map;
        if (!map || map !== imageMap || size.width === 0) return null;
        const pixels = mapPixels(map);
        return pixels.width === imagePixels.width && pixels.height === imagePixels.height
            ? map
            : null;
    };

    /** Puts the viewport's rectangle over the image, on whole image pixels. */
    const placeFrame = () => {
        const map = imageOf();
        const rect = map
            ? minimapViewRect(
                  viewOf(map),
                  viewportSize.size,
                  window.devicePixelRatio,
                  imagePixels,
                  size,
              )
            : null;
        let snapped: Rect | null = null;
        if (rect) {
            const left = Math.round(rect.x);
            const top = Math.round(rect.y);
            const right = Math.max(left + 1, Math.round(rect.x + rect.width));
            const bottom = Math.max(top + 1, Math.round(rect.y + rect.height));
            snapped = { x: left, y: top, width: right - left, height: bottom - top };
        }
        drawnFrame = snapped;
        frame.hidden = snapped === null;
        if (snapped) {
            const dpr = window.devicePixelRatio;
            frame.style.left = `${snapped.x / dpr}px`;
            frame.style.top = `${snapped.y / dpr}px`;
            frame.style.width = `${snapped.width / dpr}px`;
            frame.style.height = `${snapped.height / dpr}px`;
        }
    };

    // What is shown: another map or a new history (Open, Revert, New) redraws at once.
    let mapId: string | null = null;
    let history: History | null = null;
    let stopHistory: (() => void) | null = null;
    const onSession = () => {
        const next = sessionStore.getState().history;
        const nextMap = shown()?.map.id ?? null;
        let restart = nextMap !== mapId;
        mapId = nextMap;
        if (next !== history) {
            stopHistory?.();
            history = next;
            stopHistory = next.subscribe(({ touched }) => {
                // A step of another map leaves this one as it is; a tileset or project step
                // (no map) may change any map.
                if (touched.mapId === null || touched.mapId === mapId || touched.structure) {
                    renderer.changed();
                }
            });
            restart = true;
        }
        if (restart) renderer.restart();
        placeFrame();
    };
    const stopSession = sessionStore.subscribe(onSession);
    const stopViewport = viewportSize.subscribe(placeFrame);

    // The image takes the box's width in device pixels.
    const observer = new ResizeObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        const device = entry.devicePixelContentBoxSize?.[0];
        renderer.setWidth(
            device
                ? device.inlineSize
                : Math.round(entry.contentRect.width * window.devicePixelRatio),
        );
    });
    try {
        observer.observe(box, { box: "device-pixel-content-box" });
    } catch {
        observer.observe(box);
    }

    // Drag pans (Tiled's minimap): a press inside the rectangle keeps the point it grabbed under
    // the pointer; a press outside centres the view there first.
    let drag: { pointerId: number; dx: number; dy: number } | null = null;
    /** The pointer's position on the image, in image pixels. */
    const imagePoint = (event: PointerEvent) => {
        const bounds = canvas.getBoundingClientRect();
        const kx = bounds.width > 0 ? size.width / bounds.width : 0;
        const ky = bounds.height > 0 ? size.height / bounds.height : 0;
        return { x: (event.clientX - bounds.left) * kx, y: (event.clientY - bounds.top) * ky };
    };
    const centreOn = (x: number, y: number) => {
        const map = imageOf();
        if (!map) return;
        const target = minimapToMap(x, y, imagePixels, size);
        const view = viewOf(map);
        const scale = view.zoom * window.devicePixelRatio;
        panBy((view.centreX - target.x) * scale, (view.centreY - target.y) * scale);
    };
    const onDown = (event: PointerEvent) => {
        const map = imageOf();
        if (event.button !== 0 || drag !== null || !map) return;
        event.preventDefault();
        const point = imagePoint(event);
        const rect = drawnFrame;
        const inside =
            rect !== null &&
            point.x >= rect.x &&
            point.x < rect.x + rect.width &&
            point.y >= rect.y &&
            point.y < rect.y + rect.height;
        let dx = 0;
        let dy = 0;
        if (inside) {
            // The grabbed point's offset from the view centre, in image pixels.
            const view = viewOf(map);
            dx = (view.centreX * size.width) / imagePixels.width - point.x;
            dy = (view.centreY * size.height) / imagePixels.height - point.y;
        } else {
            centreOn(point.x, point.y);
        }
        drag = { pointerId: event.pointerId, dx, dy };
        stage.setPointerCapture(event.pointerId);
        stage.classList.add("is-dragging");
    };
    const onMove = (event: PointerEvent) => {
        if (drag === null || event.pointerId !== drag.pointerId) return;
        const point = imagePoint(event);
        centreOn(point.x + drag.dx, point.y + drag.dy);
    };
    const onUp = (event: PointerEvent) => {
        if (drag === null || event.pointerId !== drag.pointerId) return;
        drag = null;
        stage.classList.remove("is-dragging");
        if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    };
    stage.addEventListener("pointerdown", onDown);
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerup", onUp);
    stage.addEventListener("pointercancel", onUp);

    stage.hidden = true;
    frame.hidden = true;
    onSession();

    const probe: MinimapProbe = {
        canvas,
        get size() {
            return size;
        },
        get frame() {
            return drawnFrame;
        },
        stats: () => renderer.stats,
        redrawNow: () => renderer.restart(),
    };
    if (hooks) hooks.minimap = probe;

    return {
        dispose() {
            if (hooks?.minimap === probe) delete hooks.minimap;
            observer.disconnect();
            stage.removeEventListener("pointerdown", onDown);
            stage.removeEventListener("pointermove", onMove);
            stage.removeEventListener("pointerup", onUp);
            stage.removeEventListener("pointercancel", onUp);
            stopSession();
            stopViewport();
            stopHistory?.();
            renderer.dispose();
        },
    };
}

function viewOf(map: ProjectMap) {
    return sessionStore.getState().session.perMap.get(map.id)?.view ?? createMapSession(map).view;
}
