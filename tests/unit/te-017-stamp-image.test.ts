import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_OVERLAY_THEME } from "../../src/app/overlay/types";
import type { OverlayFrame, OverlayLayer } from "../../src/app/overlay/types";
import { sessionStore } from "../../src/app/state/session";
import { toolState } from "../../src/app/tools/activeTool";
import { overlayLayers as fillLayers } from "../../src/app/tools/fill/fillPreview.overlay";
import { setCurrentStamp } from "../../src/app/tools/stamp/currentStamp";
import { stampThumbnail } from "../../src/app/tools/stamp/stampImage";
import { overlayLayers as stampLayers } from "../../src/app/tools/stamp/stampPreview.overlay";
import { createViewMapping } from "../../src/app/view/coordinates";
import { cellValue } from "../../src/core/cells";
import type { Stamp } from "../../src/core/cells";
import { MapCompositor } from "../../src/core/compositor";
import type { CompositeRequest } from "../../src/core/compositor";
import { createProject, createProjectSession, sequentialIds } from "../../src/core/model";
import type { ProjectMap, Tileset } from "../../src/core/model";
import { tileset } from "./te-006-support";

// TE-017: the picture of the current stamp (SPEC §4.2) costs what is shown, not the stamp's
// pixels. The overlay's stamp and fill previews composite only the part of the stamp in view, at
// the view's scale; the rail's preview composites the stamp at its own size. A 256 × 256 stamp
// (Select All, Copy, Paste on a full 256 × 256 map) is previewed on a 1612 × 784 canvas, the
// viewport of the reference window (ENGINE §6), with 16 px and 32 px cells: what is composited
// and the canvases made stay within a few canvases' worth either way.

/** The overlay canvas of the reference window at DPR 1 (ENGINE §6). */
const CANVAS = { width: 1612, height: 784 };
const CANVAS_AREA = CANVAS.width * CANVAS.height;
/** What a preview may composite and allocate, in texels: a few canvases, whatever the stamp. */
const BOUND = 3 * CANVAS_AREA;
const SIDE = 256;

// Node has no canvas: a stand-in that records the canvases made and takes any drawing call.
const canvases: { width: number; height: number }[] = [];
const requests: CompositeRequest[] = [];

function recordingContext(): CanvasRenderingContext2D {
    const state: Record<string | symbol, unknown> = {};
    return new Proxy(state, {
        get(target, key) {
            if (key in target) return target[key];
            if (key === "createPattern") return () => ({ setTransform() {} });
            return () => undefined;
        },
        set(target, key, value) {
            target[key] = value;
            return true;
        },
    }) as unknown as CanvasRenderingContext2D;
}

beforeAll(() => {
    // The previews follow the held modifiers (`heldModifiers.ts`).
    vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal("document", {
        createElement() {
            const canvas = { width: 300, height: 150, getContext: () => recordingContext() };
            canvases.push(canvas);
            return canvas;
        },
    });
    vi.stubGlobal(
        "ImageData",
        class {
            constructor(
                readonly data: Uint8ClampedArray,
                readonly width: number,
                readonly height: number,
            ) {}
        },
    );
    vi.stubGlobal(
        "DOMMatrix",
        class {
            constructor(readonly values: number[]) {}
        },
    );
    const composite = MapCompositor.prototype.composite;
    vi.spyOn(MapCompositor.prototype, "composite").mockImplementation(function (
        this: MapCompositor,
        request,
        target,
    ) {
        requests.push(request);
        // Fails before allocating what it would not be allowed to.
        if (request.width * request.height > BOUND) {
            throw new RangeError(`Composited ${request.width} × ${request.height} texels.`);
        }
        return composite.call(this, request, target);
    });
});

afterAll(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

afterEach(() => {
    setCurrentStamp(null);
    canvases.length = 0;
    requests.length = 0;
});

const composited = () => requests.reduce((sum, { width, height }) => sum + width * height, 0);
const allocated = () => canvases.reduce((sum, { width, height }) => sum + width * height, 0);

/** A tileset of four opaque tiles of `size` px, tile `n` filled with grey `64 · n`. */
function tilesOf(size: number): Tileset {
    const base = tileset("ts", 1, 4);
    const data = new Uint8ClampedArray(4 * size * size * 4);
    for (let i = 0; i < data.length; i += 4) {
        const grey = 64 * Math.floor(((i / 4) % (4 * size)) / size);
        data.set([grey, grey, grey, 255], i);
    }
    return {
        ...base,
        tileWidth: size,
        tileHeight: size,
        pixels: { width: 4 * size, height: size, data },
    };
}

/** A `SIDE × SIDE` map of `size` px cells with the tileset in the session; the map. */
function openMap(size: number): ProjectMap {
    const project = createProject({
        newId: sequentialIds("p"),
        map: { width: SIDE, height: SIDE, tileWidth: size, tileHeight: size },
    });
    project.tilesets.push(tilesOf(size));
    sessionStore.getState().replace(createProjectSession(project));
    return project.maps[0]!;
}

/** A `width × height` stamp of the tileset's tiles, every cell filled. */
function stampOf(width: number, height: number): Stamp {
    const cells = new Uint32Array(width * height);
    cells.forEach((_, n) => (cells[n] = cellValue(1, n % 4)));
    return { width, height, cells };
}

/** A frame of the overlay over `map` at `zoom`, its centre in view, the pointer on `cell`. */
function frameOf(map: ProjectMap, zoom: number, cell = { x: SIDE / 2, y: SIDE / 2 }): OverlayFrame {
    const mapping = createViewMapping({
        view: { centreX: (SIDE * map.tileWidth) / 2, centreY: (SIDE * map.tileHeight) / 2, zoom },
        dpr: 1,
        size: CANVAS,
        mapWidth: map.width,
        mapHeight: map.height,
        tileWidth: map.tileWidth,
        tileHeight: map.tileHeight,
        left: 0,
        top: 0,
    });
    const device = mapping.cellToDevice(cell.x + 0.5, cell.y + 0.5);
    return {
        context: recordingContext(),
        size: CANVAS,
        map,
        mapping,
        cursor: { client: device, device, map: mapping.deviceToMap(device.x, device.y), cell },
        theme: DEFAULT_OVERLAY_THEME,
    };
}

/** Draws `layer` until it asks for no further redraw, as the overlay would; the draws. */
function drawSettled(layer: OverlayLayer, frame: OverlayFrame): number {
    let asked = 0;
    const stop = layer.watch?.(() => asked++) ?? (() => {});
    let draws = 0;
    try {
        do {
            asked = 0;
            layer.draw(frame);
            draws++;
        } while (asked > 0 && draws < 1000);
    } finally {
        stop();
    }
    return draws;
}

describe("the stamp brush preview of a 256 × 256 stamp", () => {
    for (const size of [16, 32]) {
        it(`composites only what is in view at ${size} px cells`, () => {
            const map = openMap(size);
            setCurrentStamp(stampOf(SIDE, SIDE));
            expect(toolState.select("stamp")).toBe(true);
            const frame = frameOf(map, 1);

            expect(drawSettled(stampLayers[0]!, frame)).toBeLessThan(1000);
            expect(requests.length).toBeGreaterThan(0);
            expect(composited()).toBeLessThanOrEqual(BOUND);
            expect(allocated()).toBeLessThanOrEqual(BOUND);

            // A redraw with nothing changed composites nothing more.
            requests.length = 0;
            drawSettled(stampLayers[0]!, frame);
            expect(requests).toEqual([]);
        });
    }

    it("composites at the view's scale when zoomed out", () => {
        const map = openMap(32);
        setCurrentStamp(stampOf(SIDE, SIDE));
        expect(toolState.select("stamp")).toBe(true);
        // 1/8: 4 device pixels per cell, the whole map in 1024 × 1024 device pixels.
        drawSettled(stampLayers[0]!, frameOf(map, 1 / 8));
        const shown = Math.min(CANVAS.width, 1024) * Math.min(CANVAS.height, 1024);
        expect(composited()).toBeLessThanOrEqual(2 * shown);
        expect(allocated()).toBeLessThanOrEqual(2 * shown);
    });
});

describe("the bucket fill preview of a 256 × 256 stamp", () => {
    it("composites only what is in view at 32 px cells", () => {
        const map = openMap(32);
        setCurrentStamp(stampOf(SIDE, SIDE));
        expect(toolState.select("bucket")).toBe(true);
        // The layer is empty: the region is the whole map.
        drawSettled(fillLayers[0]!, frameOf(map, 1, { x: 3, y: 3 }));
        expect(requests.length).toBeGreaterThan(0);
        expect(composited()).toBeLessThanOrEqual(BOUND);
        expect(allocated()).toBeLessThanOrEqual(BOUND);
    });
});

describe("stampThumbnail", () => {
    it("composites the stamp at the rail's size, whatever its pixels", () => {
        for (const size of [16, 32]) {
            const map = openMap(size);
            const { project } = sessionStore.getState().session;
            const image = stampThumbnail(project, map, stampOf(SIDE, SIDE), 35);
            expect([image.width, image.height]).toEqual([35, 35]);
            expect(composited()).toBe(35 * 35);
            requests.length = 0;
        }
    });

    it("fits the stamp's proportions, nearest neighbour, enlarging a small stamp", () => {
        const map = openMap(16);
        const { project } = sessionStore.getState().session;
        // Tiles 0 and 3: black and grey 192, side by side.
        const stamp = {
            width: 2,
            height: 1,
            cells: Uint32Array.of(cellValue(1, 0), cellValue(1, 3)),
        };
        const image = stampThumbnail(project, map, stamp, 28);
        expect([image.width, image.height]).toEqual([28, 14]);
        const at = (x: number, y: number) => [
            ...image.data.subarray((y * 28 + x) * 4, (y * 28 + x) * 4 + 4),
        ];
        expect(at(0, 0)).toEqual([0, 0, 0, 255]);
        expect(at(13, 13)).toEqual([0, 0, 0, 255]);
        expect(at(14, 0)).toEqual([192, 192, 192, 255]);
        expect(at(27, 13)).toEqual([192, 192, 192, 255]);
    });
});
