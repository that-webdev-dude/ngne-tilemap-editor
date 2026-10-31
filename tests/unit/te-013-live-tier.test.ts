import type { Camera, Frame } from "@ngne/core";
import { describe, expect, it } from "vitest";
import { cellValue } from "../../src/core/cells";
import { createTileLayer, createGroupLayer } from "../../src/core/model";
import type { Project, TileLayer } from "../../src/core/model";
import { packTileset } from "../../src/core/pack";
import { checkerSpec } from "../../src/engine/viewport/checker";
import {
    EmitterCache,
    LAYER,
    MIN_CHECKER_SQUARE,
    buildLiveFrame,
} from "../../src/engine/viewport/liveTier";
import type { ViewportScene } from "../../src/engine/viewport/liveTier";
import { CHECKER_TEXTURE_ID, tilesetTextureId } from "../../src/engine/viewport/textures";
import type { ReadyTileset } from "../../src/engine/viewport/textures";
import { SCENE, createViewportSceneProject } from "../support/viewportScene";

// TE-013: the frame the live tier builds (ENGINE §4): layer order, depth, alpha, shifts,
// culling and the checkerboard. A recording frame stands in for NGNE's; what NGNE draws from it
// is the E2E readback's.

interface Recorded {
    x: number;
    y: number;
    width: number;
    height: number;
    texture?: string;
    u?: number;
    v?: number;
    uw?: number;
    vh?: number;
    alpha?: number;
    layer?: number;
    depth?: number;
    color?: number;
}
interface RecordedRect {
    x: number;
    y: number;
    width: number;
    height: number;
    color: number;
    alpha: number;
    layer: number;
}

class RecordingFrame {
    resets = 0;
    scenes = 0;
    sprites: Recorded[] = [];
    rects: RecordedRect[] = [];
    reset() {
        this.resets += 1;
        this.sprites = [];
        this.rects = [];
    }
    scene() {
        this.scenes += 1;
    }
    sprite(s: Recorded) {
        this.sprites.push({ ...s });
    }
    rect(x: number, y: number, width: number, height: number, color: number, alpha = 1, layer = 0) {
        this.rects.push({ x, y, width, height, color, alpha, layer });
    }
}

const CHECKER = { a: 0x3a3a3a, b: 0x4a4a4a, size: 8 };

function readyTilesets(project: Project): ReadyTileset[] {
    return project.tilesets.map((tileset) => ({
        tileset,
        texture: tilesetTextureId(tileset.id),
        uvTable: packTileset(tileset).uvTable,
        version: 1,
    }));
}

interface Setup {
    project: Project;
    scene: ViewportScene;
}

function setup(background: number | null = null): Setup {
    const project = createViewportSceneProject({ background });
    const map = project.maps[0]!;
    const scene: ViewportScene = {
        project,
        map,
        view: { centreX: 160, centreY: 96, zoom: 1 },
        dpr: 1,
        checker: CHECKER,
    };
    return { project, scene };
}

function build(
    { project, scene }: Setup,
    size = { width: 400, height: 240 },
    checkerReady: string | null = checkerSpec(CHECKER),
) {
    const frame = new RecordingFrame();
    const emitter = new EmitterCache().emitter(readyTilesets(project));
    const counts = buildLiveFrame(frame as unknown as Frame, {
        scene,
        size,
        camera: {} as Camera,
        emitter,
        checkerReady,
    });
    return { frame, counts };
}

const tileSprites = (frame: RecordingFrame) => frame.sprites.filter((s) => s.layer === LAYER.tiles);

describe("layers", () => {
    it("draws visible tile layers bottom to top, one depth each, tiles above the map", () => {
        const { frame, counts } = build(setup());
        expect(frame.resets).toBe(1);
        expect(frame.scenes).toBe(1);
        const tiles = tileSprites(frame);
        expect(counts.tileQuads).toBe(tiles.length);
        // Consecutive in the order of the layers: depth never goes down.
        const depths = tiles.map((s) => s.depth!);
        expect([...depths].sort((a, b) => a - b)).toEqual(depths);
        expect(new Set(depths)).toEqual(new Set([1, 2, 3]));
        // The checkerboard comes first, on the lower NGNE layer.
        const firstTile = frame.sprites.findIndex((s) => s.layer === LAYER.tiles);
        expect(frame.sprites.slice(0, firstTile).every((s) => s.layer === LAYER.map)).toBe(true);
    });

    it("draws a layer's opacity as alpha and skips hidden and transparent layers", () => {
        const set = setup();
        const [base, faint, far] = set.project.maps[0]!.layers as TileLayer[];
        let { frame } = build(set);
        const alphaOf = (depth: number) =>
            new Set(
                tileSprites(frame)
                    .filter((s) => s.depth === depth)
                    .map((s) => s.alpha),
            );
        expect(alphaOf(1)).toEqual(new Set([1]));
        expect(alphaOf(2)).toEqual(new Set([SCENE.opacity / 255]));

        faint!.visible = false;
        ({ frame } = build(set));
        // The hidden layer takes no depth: the layer above it moves down.
        expect(new Set(tileSprites(frame).map((s) => s.depth))).toEqual(new Set([1, 2]));
        faint!.visible = true;

        far!.opacity = 0;
        ({ frame } = build(set));
        expect(new Set(tileSprites(frame).map((s) => s.depth))).toEqual(new Set([1, 2]));
        far!.opacity = 255;
        expect(base!.visible).toBe(true);
    });

    it("applies the visibility and opacity of groups to the layers inside", () => {
        const set = setup();
        const map = set.project.maps[0]!;
        const group = createGroupLayer(10, "Group");
        group.opacity = 128;
        const inside = createTileLayer(11, "Inside");
        inside.cells.set(0, 0, cellValue(1, 0));
        group.layers.push(inside);
        map.layers = [group];

        let { frame } = build(set);
        expect(tileSprites(frame)).toHaveLength(1);
        expect(tileSprites(frame)[0]!.alpha).toBeCloseTo(128 / 255, 6);

        group.visible = false;
        ({ frame } = build(set));
        expect(tileSprites(frame)).toHaveLength(0);
    });

    it("draws nothing of tilesets whose texture is not ready", () => {
        const set = setup();
        const frame = new RecordingFrame();
        const ready = readyTilesets(set.project).slice(0, 1);
        buildLiveFrame(frame as unknown as Frame, {
            scene: set.scene,
            size: { width: 400, height: 240 },
            camera: {} as Camera,
            emitter: new EmitterCache().emitter(ready),
            checkerReady: checkerSpec(CHECKER),
        });
        const textures = new Set(tileSprites(frame).map((s) => s.texture));
        expect(textures).toEqual(new Set([ready[0]!.texture]));
    });
});

describe("culling", () => {
    it("emits only the tiles that can show in the view", () => {
        const all = build(setup(), { width: 400, height: 240 });
        // A canvas of two cells by two, at the top-left of the map.
        const set = setup();
        set.scene.view = { centreX: 16, centreY: 16, zoom: 1 };
        const small = build(set, { width: 32, height: 32 });
        expect(small.counts.tileQuads).toBeGreaterThan(0);
        expect(small.counts.tileQuads).toBeLessThan(all.counts.tileQuads / 4);
        for (const sprite of tileSprites(small.frame)) {
            // Every quad overlaps the canvas.
            expect(sprite.x + Math.abs(sprite.width) / 2).toBeGreaterThan(0);
            expect(sprite.x - Math.abs(sprite.width) / 2).toBeLessThan(32);
        }
    });
});

describe("shifts", () => {
    /** Screen x of the far layer's first quad with the view centre at `centreX`. */
    function farX(mutate: (layer: TileLayer) => void, centreX: number): number {
        const set = setup();
        mutate(set.project.maps[0]!.layers[2] as TileLayer);
        set.scene.view = { centreX, centreY: 96, zoom: 1 };
        const { frame } = build(set);
        return tileSprites(frame).find((s) => s.depth === 3)!.x;
    }

    it("moves a layer by its offset", () => {
        const plain = farX((layer) => (layer.offsetX = 0), 160);
        expect(farX((layer) => (layer.offsetX = 5), 160) - plain).toBe(5);
    });

    it("moves a parallax layer by (1 − parallax) of the view centre's travel", () => {
        const at = (parallax: number, centre: number) =>
            farX((layer) => (layer.parallaxX = parallax), centre);
        // Moving the view right by 10 moves a layer on the screen left by 10 × parallax.
        expect(at(1, 170) - at(1, 160)).toBeCloseTo(-10, 9);
        expect(at(0.5, 170) - at(0.5, 160)).toBeCloseTo(-5, 9);
        expect(at(0, 170) - at(0, 160)).toBeCloseTo(0, 9);
    });

    it("scales positions and sizes by the zoom and the device pixel ratio", () => {
        const one = setup();
        const scaled = setup();
        scaled.scene.view = { ...scaled.scene.view, zoom: 2 };
        scaled.scene.dpr = 1.25;
        const a = tileSprites(build(one, { width: 4000, height: 4000 }).frame)[0]!;
        const b = tileSprites(build(scaled, { width: 4000, height: 4000 }).frame)[0]!;
        expect(Math.abs(b.width) / Math.abs(a.width)).toBeCloseTo(2.5, 9);
    });
});

describe("map background and checkerboard", () => {
    it("draws the background colour over the visible part of the map, with its alpha", () => {
        const { frame } = build(setup(0x203040c0), { width: 400, height: 240 });
        expect(frame.rects.filter((r) => r.layer === LAYER.map && r.color === 0x203040)).toEqual([
            {
                x: 200,
                y: 120,
                width: 320,
                height: 192,
                color: 0x203040,
                alpha: 0xc0 / 255,
                layer: 0,
            },
        ]);
        // The rectangle is clipped to the canvas: the view's corner is the map's, so the map
        // fills the lower right quarter of the canvas.
        const set = setup(0x203040ff);
        set.scene.view = { centreX: 0, centreY: 0, zoom: 1 };
        const clipped = build(set, { width: 100, height: 60 }).frame.rects.find(
            (r) => r.color === 0x203040,
        )!;
        expect(clipped).toMatchObject({ x: 75, y: 45, width: 50, height: 30 });
    });

    it("draws no background for a map without one or with alpha 0", () => {
        for (const background of [null, 0x20304000]) {
            const { frame } = build(setup(background));
            expect(frame.rects.filter((r) => r.color === 0x203040)).toEqual([]);
        }
    });

    it("covers the map with quads of the checker image, edge blocks cut by their UV", () => {
        const { frame, counts } = build(setup(), { width: 400, height: 240 });
        const quads = frame.sprites.filter((s) => s.texture === CHECKER_TEXTURE_ID);
        expect(counts.checkerQuads).toBe(quads.length);
        // 320 × 192 map pixels over blocks of 16 squares of 8 = 128 map pixels: 3 × 2 blocks.
        expect(quads).toHaveLength(6);
        const area = quads.reduce((sum, q) => sum + q.width * q.height, 0);
        expect(area).toBe(320 * 192);
        // The block at the right edge shows 64 of its 128 pixels (320 − 256).
        const edge = quads.find((q) => q.x > 300)!;
        expect(edge.uw).toBe(64 / 128);
        expect(edge.u).toBe(0);
    });

    it("draws one rectangle of the mean colour while the squares are too small or not uploaded", () => {
        const small = setup();
        small.scene.view = {
            centreX: 160,
            centreY: 96,
            zoom: (MIN_CHECKER_SQUARE - 1) / CHECKER.size,
        };
        let { frame } = build(small);
        expect(frame.sprites.filter((s) => s.texture === CHECKER_TEXTURE_ID)).toEqual([]);
        expect(frame.rects.filter((r) => r.color === 0x424242)).toHaveLength(1);

        ({ frame } = build(setup(), { width: 400, height: 240 }, null));
        expect(frame.sprites.filter((s) => s.texture === CHECKER_TEXTURE_ID)).toEqual([]);
        expect(frame.rects.filter((r) => r.color === 0x424242)).toHaveLength(1);
    });

    it("draws neither when the map is out of view", () => {
        const set = setup();
        set.scene.view = { centreX: 5000, centreY: 5000, zoom: 1 };
        const { frame, counts } = build(set);
        expect(counts).toEqual({ tileQuads: 0, checkerQuads: 0 });
        expect(frame.rects).toEqual([]);
    });
});
