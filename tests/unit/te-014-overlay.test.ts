import { describe, expect, it, vi } from "vitest";
import { createOverlayController } from "../../src/app/overlay/overlayController";
import type { OverlaySources } from "../../src/app/overlay/overlayController";
import { OverlayLayerError, collectOverlayLayers } from "../../src/app/overlay/overlayLayers";
import type { OverlayFrame, OverlayLayer } from "../../src/app/overlay/types";
import { createSessionStore } from "../../src/app/state/session";
import { createViewMapping } from "../../src/app/view/coordinates";
import { newSession } from "./te-006-support";

// When the overlay redraws (TE-014): on a change of the map's view or geometry, of the cursor's
// device pixel, of the canvas size, of the theme or when a layer asks; once per frame; and not
// otherwise.

function setup(layers: OverlayLayer[] = []) {
    const store = createSessionStore(newSession(8, 8));
    const frames: (() => void)[] = [];
    const calls: string[] = [];
    const context = {
        clearRect: () => calls.push("clear"),
        save: () => calls.push("save"),
        restore: () => calls.push("restore"),
    } as unknown as CanvasRenderingContext2D;
    const canvas = { width: 640, height: 480 };
    const sources: OverlaySources = {
        session: store,
        mapping: () => {
            const { session } = store.getState();
            const map = session.project.maps[0]!;
            return createViewMapping({
                view: session.perMap.get(map.id)!.view,
                dpr: 1,
                size: { width: canvas.width, height: canvas.height },
                mapWidth: map.width,
                mapHeight: map.height,
                tileWidth: map.tileWidth,
                tileHeight: map.tileHeight,
                left: 0,
                top: 0,
            });
        },
        ratio: () => 1,
        nextFrame(callback) {
            frames.push(callback);
            return () => frames.splice(frames.indexOf(callback), 1);
        },
    };
    const controller = createOverlayController(canvas, context, layers, sources);
    const flush = () => frames.splice(0).forEach((callback) => callback());
    return { store, canvas, controller, flush, calls, frames };
}

describe("overlay controller", () => {
    it("draws the first frame it asked for, once", () => {
        const { controller, flush, frames } = setup();
        expect(controller.pending).toBe(true);
        expect(frames).toHaveLength(1);
        flush();
        expect(controller.redraws).toBe(1);
        expect(controller.pending).toBe(false);
    });

    it("does not redraw while idle or for a change that is not the view", () => {
        const { store, controller, flush } = setup();
        flush();
        store.getState().touch();
        store.getState().session.project.name = "Renamed";
        store.getState().touch();
        expect(controller.pending).toBe(false);
        expect(controller.redraws).toBe(1);
    });

    it("redraws once per frame for any number of view changes", () => {
        const { store, controller, flush } = setup();
        flush();
        const { session, touch } = store.getState();
        const view = session.perMap.get(session.activeMapId)!.view;
        for (let zoom = 2; zoom < 6; zoom++) {
            view.zoom = zoom;
            touch();
        }
        flush();
        expect(controller.redraws).toBe(2);
    });

    it("redraws for a new centre, a new map size and a cursor on another device pixel", () => {
        const { store, controller, flush } = setup();
        flush();
        const { session, touch } = store.getState();
        const map = session.project.maps[0]!;
        session.perMap.get(map.id)!.view.centreX += 10;
        touch();
        flush();
        map.tileWidth = 32;
        touch();
        flush();
        expect(controller.redraws).toBe(3);

        controller.setCursor({ x: 100, y: 100 });
        controller.setCursor({ x: 100.2, y: 100.4 });
        flush();
        expect(controller.redraws).toBe(4);
        controller.setCursor({ x: 101, y: 100 });
        flush();
        expect(controller.redraws).toBe(5);
        controller.setCursor(null);
        flush();
        expect(controller.redraws).toBe(6);
    });

    it("draws a resize at once and not twice for the same size", () => {
        const { controller, canvas, flush } = setup();
        flush();
        controller.resize({ width: 800, height: 600 });
        expect(canvas).toMatchObject({ width: 800, height: 600 });
        expect(controller.redraws).toBe(2);
        controller.resize({ width: 800, height: 600 });
        expect(controller.redraws).toBe(2);
    });

    it("calls each layer between save and restore, bottom first, with the map and cursor", () => {
        const seen: OverlayFrame[] = [];
        const order: string[] = [];
        const layer = (id: string, at: number): OverlayLayer => ({
            id,
            order: at,
            draw(frame) {
                order.push(id);
                seen.push(frame);
            },
        });
        const { controller, flush, calls } = setup(
            collectOverlayLayers({
                "a.overlay.ts": { overlayLayers: [layer("top", 300), layer("bottom", 100)] },
            }),
        );
        controller.setCursor({ x: 8, y: 8 });
        flush();
        expect(order).toEqual(["bottom", "top"]);
        expect(calls).toEqual(["clear", "save", "restore", "save", "restore"]);
        expect(seen[0]!.map.width).toBe(8);
        expect(seen[0]!.cursor?.client).toEqual({ x: 8, y: 8 });
        expect(seen[0]!.cursor?.cell).toBeDefined();
    });

    it("leaves the other layers drawn when one throws, and reports it once", () => {
        const drawn: string[] = [];
        const failing: OverlayLayer = {
            id: "failing",
            order: 1,
            draw() {
                throw new Error("boom");
            },
        };
        const fine: OverlayLayer = { id: "fine", order: 2, draw: () => drawn.push("fine") };
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const { store, flush } = setup([failing, fine]);
        flush();
        const { session, touch } = store.getState();
        session.perMap.get(session.activeMapId)!.view.zoom = 3;
        touch();
        flush();
        expect(drawn).toEqual(["fine", "fine"]);
        expect(error).toHaveBeenCalledTimes(1);
        error.mockRestore();
    });

    it("follows a layer's watch and stops it on dispose", () => {
        const stop = vi.fn();
        let redraw = () => {};
        const watcher: OverlayLayer = {
            id: "watcher",
            order: 1,
            draw: () => {},
            watch(request) {
                redraw = request;
                return stop;
            },
        };
        const { controller, flush } = setup([watcher]);
        flush();
        redraw();
        expect(controller.pending).toBe(true);
        flush();
        controller.dispose();
        expect(stop).toHaveBeenCalledTimes(1);
        redraw();
        expect(controller.pending).toBe(false);
    });
});

describe("overlay layer registry", () => {
    const layer = (id: string, order: number): OverlayLayer => ({ id, order, draw: () => {} });

    it("rejects a duplicate id, a missing export and a layer without order", () => {
        expect(() =>
            collectOverlayLayers({
                "a.overlay.ts": { overlayLayers: [layer("x", 1)] },
                "b.overlay.ts": { overlayLayers: [layer("x", 2)] },
            }),
        ).toThrow(OverlayLayerError);
        expect(() => collectOverlayLayers({ "c.overlay.ts": {} })).toThrow(/overlayLayers/);
        expect(() =>
            collectOverlayLayers({ "d.overlay.ts": { overlayLayers: [layer("y", NaN)] } }),
        ).toThrow(/order/);
    });

    it("finds the cell grid in the app's own registry, at order 300", async () => {
        const { overlayLayers } = await import("../../src/app/overlay/overlayLayers");
        expect(overlayLayers.map((each) => [each.id, each.order])).toEqual([
            ["cell-grid", 300],
            ["capture-preview", 600],
            ["eraser-preview", 600],
            ["fill-preview", 600],
            ["stamp-preview", 600],
        ]);
    });
});
