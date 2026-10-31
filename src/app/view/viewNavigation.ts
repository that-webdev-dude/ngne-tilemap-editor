import { createMapSession } from "../../core/model";
import type { MapView, ProjectMap } from "../../core/model";
import { sessionStore } from "../state/session";
import { createViewMapping } from "./coordinates";
import type { Point, ViewMapping } from "./coordinates";
import { clampView, fitView, panView, sameView, viewportCentre, zoomView } from "./navigate";
import type { NavigationContext } from "./navigate";
import { hasSize, viewportSize } from "./viewportSize";
import { zoomStep } from "./zoom";

// View navigation on the app's stores (TE-014): commands, tools and pointer handling change the
// view of the active map through these functions. Every change keeps the pan limits and is
// written to the map's session (SPEC §3), which tells the session store so the viewport and
// the overlay follow. Zoom and centre are per map and not persisted.
//
// Positions are device pixels of the viewport element unless a name says otherwise.

/**
 * The viewport element: the container that holds the NGNE canvas and the overlay canvas, as
 * `ui` mounted it. Client positions are mapped against its box.
 */
let surface: HTMLElement | null = null;

/** Registers the viewport element; `null` when it left the page. */
export function setViewSurface(element: HTMLElement | null): void {
    surface = element;
}

/** The viewport element, or null while none is mounted. */
export function viewSurface(): HTMLElement | null {
    return surface;
}

interface Navigable {
    map: ProjectMap;
    view: MapView;
    ctx: NavigationContext;
}

/** The active map and the viewport, when there is a view to navigate. */
function navigable(): Navigable | null {
    const { session } = sessionStore.getState();
    const map = session.project.maps.find((each) => each.id === session.activeMapId);
    const size = viewportSize.size;
    if (!map || !hasSize(size)) return null;
    const view = session.perMap.get(map.id)?.view ?? createMapSession(map).view;
    return {
        map,
        view,
        ctx: {
            dpr: window.devicePixelRatio,
            size,
            map: { width: map.width * map.tileWidth, height: map.height * map.tileHeight },
        },
    };
}

/** Whether a map is open in a viewport that has a size: the view can be navigated. */
export function canNavigate(): boolean {
    return navigable() !== null;
}

/** The view of the active map, or null when none is open. */
export function activeView(): MapView | null {
    const { session } = sessionStore.getState();
    const map = session.project.maps.find((each) => each.id === session.activeMapId);
    return map ? (session.perMap.get(map.id)?.view ?? createMapSession(map).view) : null;
}

/** Device pixels per map pixel of the active map's view, or null when none is open. */
export function activeScale(): number | null {
    const view = activeView();
    return view ? view.zoom * window.devicePixelRatio : null;
}

/** Writes `view` to the session of `map` and tells the session store. */
function apply(target: Navigable, view: MapView): void {
    if (view === target.view || sameView(view, target.view)) return;
    const { session, touch } = sessionStore.getState();
    const existing = session.perMap.get(target.map.id);
    if (existing) existing.view = view;
    else session.perMap.set(target.map.id, { ...createMapSession(target.map), view });
    touch();
}

/**
 * The mapping between client, device, map and cell coordinates for the active map as it is on
 * screen now (`coordinates.ts`), or null while no map is open or the viewport element is not
 * on the page. It reads the element's box, so it is made when it is needed — per pointer
 * event, per overlay redraw — and not kept.
 */
export function currentViewMapping(): ViewMapping | null {
    const target = navigable();
    if (!target || !surface) return null;
    const box = surface.getBoundingClientRect();
    const { map, view, ctx } = target;
    return createViewMapping({
        view,
        dpr: ctx.dpr,
        size: ctx.size,
        mapWidth: map.width,
        mapHeight: map.height,
        tileWidth: map.tileWidth,
        tileHeight: map.tileHeight,
        left: box.left,
        top: box.top,
    });
}

/** Moves the map by `dx`, `dy` device pixels, as far as the pan limits allow. */
export function panBy(dx: number, dy: number): void {
    const target = navigable();
    if (target) apply(target, panView(target.view, dx, dy, target.ctx));
}

/**
 * Sets the zoom to `scale` device pixels per map pixel, a zoom step (`zoom.ts`), keeping the
 * map position under `anchor` in place; without an anchor, the one at the centre of the
 * viewport.
 */
export function zoomTo(scale: number, anchor?: Point): void {
    const target = navigable();
    if (!target) return;
    const { view, ctx } = target;
    apply(target, zoomView(view, scale, anchor ?? viewportCentre(ctx.size), ctx));
}

/** One zoom step in (`1`) or out (`-1`), about `anchor` or the centre of the viewport. */
export function zoomBy(direction: 1 | -1, anchor?: Point): void {
    const scale = activeScale();
    if (scale !== null) zoomTo(zoomStep(scale, direction), anchor);
}

/** Fits the active map: the largest zoom step at which it fits the viewport, centred. */
export function fitActiveView(): void {
    const target = navigable();
    if (target) apply(target, fitView(target.ctx));
}

/** Moves the active map's view back inside the pan limits (the viewport was resized). */
export function clampActiveView(): void {
    const target = navigable();
    if (target) apply(target, clampView(target.view, target.ctx));
}
