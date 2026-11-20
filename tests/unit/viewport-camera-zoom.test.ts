import { Camera } from "@ngne/core";
import type { Frame, Sprite } from "@ngne/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CellStore, cellValue } from "../../src/core/cells";
import { createImageLayer, createTileLayer } from "../../src/core/model";
import type { Project } from "../../src/core/model";
import { packTileset } from "../../src/core/pack";
import { createViewMapping } from "../../src/app/view/coordinates";
import { CHUNK_SIZE } from "../../src/core/cells";
import { checkerSpec } from "../../src/engine/viewport/checker";
import { ChunkTier } from "../../src/engine/viewport/chunkTier";
import type { ChunkTarget } from "../../src/engine/viewport/chunkTier";
import { deviceClip, visibleRect } from "../../src/engine/viewport/geometry";
import { emitImageLayer } from "../../src/engine/viewport/imageLayers";
import {
    EmitterCache,
    LAYER,
    buildLiveFrame,
    placeCamera,
    sceneCamera,
} from "../../src/engine/viewport/liveTier";
import type { ViewportScene } from "../../src/engine/viewport/liveTier";
import { tilesetTextureId } from "../../src/engine/viewport/textures";
import { createViewportSceneProject } from "../support/viewportScene";
import { mapOf, projectOf, tilesetOf } from "./te-012-support";

// GitHub #7: the viewport's NGNE camera carries the view scale (ENGINE §4 "Camera"). Quads are
// emitted at map size, the camera sits at the view's top-left in map pixels with the device
// pixels per map pixel as its zoom, and the overlay maps a map position as NGNE does,
// `(point − camera) × zoom`.

const CHECKER = { a: 0x3a3a3a, b: 0x4a4a4a, size: 8 };

/** A frame that keeps the camera of its scene and a copy of each quad it is given. */
class RecordingFrame {
    cameras: { x: number; y: number; zoom: number }[] = [];
    sprites: Sprite[] = [];
    rects: number[][] = [];
    reset() {
        this.sprites = [];
        this.rects = [];
    }
    scene(camera: Camera, alpha: number) {
        this.cameras.push(camera.view(alpha));
    }
    sprite(s: Sprite) {
        this.sprites.push({ ...s });
    }
    rect(...args: number[]) {
        this.rects.push(args);
    }
}

function emitterOf(project: Project) {
    return new EmitterCache().emitter(
        project.tilesets.map((tileset) => ({
            tileset,
            texture: tilesetTextureId(tileset.id),
            uvTable: packTileset(tileset).uvTable,
            version: 1,
        })),
    );
}

function sceneOf(project: Project, zoom: number, dpr: number): ViewportScene {
    return {
        project,
        map: project.maps[0]!,
        view: { centreX: 160, centreY: 96, zoom },
        dpr,
        checker: CHECKER,
    };
}

function liveFrame(scene: ViewportScene, size: { width: number; height: number }) {
    const frame = new RecordingFrame();
    const camera = new Camera();
    camera.pixelSnap = false;
    buildLiveFrame(frame as unknown as Frame, {
        scene,
        size,
        camera,
        emitter: emitterOf(scene.project),
        checkerReady: checkerSpec(CHECKER),
    });
    return { frame, camera };
}

describe("the NGNE camera carries the view scale", () => {
    it("sits at the view's top-left in map pixels with zoom × dpr as its zoom, drawn as set", () => {
        const project = createViewportSceneProject({ background: null });
        const scene = sceneOf(project, 2, 1.25);
        const size = { width: 400, height: 240 };
        const { frame, camera } = liveFrame(scene, size);
        // 400 × 240 device pixels at 2.5 per map pixel show 160 × 96 map pixels about (160, 96).
        expect(camera.zoom).toBe(2.5);
        expect([camera.x, camera.y]).toEqual([80, 48]);
        expect([camera.previousX, camera.previousY, camera.previousZoom]).toEqual([80, 48, 2.5]);
        expect(camera.pixelSnap).toBe(false);
        expect(frame.cameras).toEqual([{ x: 80, y: 48, zoom: 2.5 }]);
        const visible = visibleRect(sceneCamera(scene), size);
        expect([visible.x, visible.y]).toEqual([camera.x, camera.y]);
    });

    it("live-tier quads are emitted at map size: the view scale changes only the camera", () => {
        const project = createViewportSceneProject({ background: 0x203040c0 });
        // The whole map shows at both scales, so both frames hold the same quads.
        const size = { width: 2000, height: 1200 };
        const near = liveFrame(sceneOf(project, 2, 1.25), size).frame;
        const far = liveFrame(sceneOf(project, 1, 1), size).frame;
        expect(near.cameras[0]!.zoom).toBe(2.5);
        expect(far.cameras[0]!.zoom).toBe(1);
        const tiles = near.sprites.filter((s) => s.layer === LAYER.tiles);
        expect(tiles.length).toBeGreaterThan(0);
        expect(near.sprites.length).toBeGreaterThan(tiles.length);
        expect(near.sprites).toEqual(far.sprites);
        expect(near.rects).toEqual(far.rects);
        // A 16 × 16 tile is 16 × 16 map pixels, flipped or turned.
        for (const tile of tiles) {
            expect([Math.abs(tile.width), Math.abs(tile.height)]).toEqual([16, 16]);
        }
    });

    it("an image layer's quad is emitted at map size", () => {
        const sprites: Sprite[] = [];
        const frame = {
            sprite: (s: Sprite) => {
                sprites.push({ ...s });
            },
        };
        const layer = createImageLayer(7, "Sky", "img");
        emitImageLayer(
            frame as unknown as Frame,
            {
                layer,
                ready: { texture: "ed:img:7", width: 16, height: 8 },
                opacity: 255,
                shift: { x: 10, y: 5 },
            },
            { x: 0, y: 0, width: 100, height: 50 },
            { layer: LAYER.tiles, depth: 1 },
        );
        expect(sprites).toHaveLength(1);
        expect(sprites[0]).toMatchObject({ x: 18, y: 9, width: 16, height: 8 });
    });

    it("chunk-tier quads are emitted at map size", async () => {
        // Two full layers of 192 × 192 cells: past the live tier's limit, one flattened set.
        const tileset = tilesetOf([["AB", "CD"]], { slot: 1 });
        const side = 192;
        const layers = [1, 2].map((id) => {
            const layer = createTileLayer(id, `Layer ${id}`);
            const cells = new CellStore();
            for (let y = 0; y < side; y += 1) {
                for (let x = 0; x < side; x += 1) cells.set(x, y, cellValue(1, 0, 0));
            }
            layer.cells = cells;
            return layer;
        });
        const project = projectOf(mapOf({ width: side, height: side, tileWidth: 2, layers }), [
            tileset,
        ]);
        const map = project.maps[0]!;
        const target: ChunkTarget = {
            createTexture: () => Promise.resolve(),
            updateTexture: () => Promise.resolve(),
            releaseTexture: () => undefined,
            has: () => true,
        };
        const errors: unknown[] = [];
        const tier = new ChunkTier({
            target,
            hooks: {
                onChange: () => undefined,
                onError: (error) => {
                    errors.push(error);
                },
            },
            slice: (job) => {
                const timer = setTimeout(job, 0);
                return () => clearTimeout(timer);
            },
        });
        const size = { width: 1000, height: 600 };
        tier.sync(project, map, size);
        for (let round = 0; round < 10_000 && !tier.ready; round += 1) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        expect(errors).toEqual([]);
        expect(tier.ready).toBe(true);
        const chunkQuads = (zoom: number) => {
            const frame = new RecordingFrame();
            const scene: ViewportScene = {
                project,
                map,
                view: { centreX: 100, centreY: 100, zoom },
                dpr: 1,
                checker: CHECKER,
            };
            const inputs = {
                scene,
                size,
                camera: new Camera(),
                emitter: emitterOf(project),
                checkerReady: null,
            };
            const counts = { tileQuads: 0, checkerQuads: 0 };
            const drawn = tier.draw(
                frame as unknown as Frame,
                inputs,
                sceneCamera(scene),
                counts,
                0,
            );
            const quads = frame.sprites.filter((s) => s.texture?.startsWith("ed:chunk:"));
            expect(quads).toHaveLength(drawn);
            return quads;
        };
        // 32 × 32 cells of 2 map pixels each, wherever the view is and whatever its scale.
        const chunk = CHUNK_SIZE * 2;
        const near = chunkQuads(3);
        const far = chunkQuads(0.5);
        expect(near.length).toBeGreaterThan(0);
        expect(far).toHaveLength(36);
        for (const quad of [...near, ...far]) {
            const [, , , cx, cy] = quad.texture!.split(":").map(Number);
            expect(quad).toMatchObject({
                x: cx! * chunk + chunk / 2,
                y: cy! * chunk + chunk / 2,
                width: chunk,
                height: chunk,
            });
        }
        for (const quad of near) expect(far).toContainEqual(quad);
    });
});

describe("the overlay maps as NGNE draws: (point − camera) × zoom", () => {
    const coordinate = fc.double({ min: -5000, max: 5000, noNaN: true });
    const zoom = fc.double({ min: 1 / 32, max: 32, noNaN: true });
    const dpr = fc.constantFrom(1, 1.25, 1.5, 2);
    const extent = fc.integer({ min: 1, max: 4000 });

    it("a map position lands on the device pixel NGNE puts it on, and back", () => {
        fc.assert(
            fc.property(
                coordinate,
                coordinate,
                zoom,
                dpr,
                extent,
                extent,
                coordinate,
                coordinate,
                (centreX, centreY, z, ratio, width, height, x, y) => {
                    const view = { centreX, centreY, zoom: z };
                    const size = { width, height };
                    const camera = new Camera();
                    const placed = { centreX, centreY, scale: z * ratio };
                    placeCamera(camera, placed, size);
                    const engine = camera.view(1);
                    const mapping = createViewMapping({
                        view,
                        dpr: ratio,
                        size,
                        mapWidth: 10,
                        mapHeight: 10,
                        tileWidth: 16,
                        tileHeight: 16,
                        left: 0,
                        top: 0,
                    });
                    expect(mapping.mapToDevice(x, y)).toEqual({
                        x: (x - engine.x) * engine.zoom,
                        y: (y - engine.y) * engine.zoom,
                    });
                    const back = mapping.deviceToMap((x - engine.x) * engine.zoom, 0);
                    expect(back.x).toBeCloseTo(x, 6);
                    // A sprite clip starts on the device pixel the engine puts its corner near.
                    const clip = deviceClip(placed, size, { x, y, width: 1, height: 1 });
                    expect(clip.x).toBe(Math.round((x - engine.x) * engine.zoom));
                    expect(clip.y).toBe(Math.round((y - engine.y) * engine.zoom));
                },
            ),
            { numRuns: 500 },
        );
    });
});
