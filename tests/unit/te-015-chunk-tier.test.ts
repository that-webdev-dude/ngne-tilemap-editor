import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CHUNK_SIZE, CellStore, cellValue } from "../../src/core/cells";
import type { CellRect, Orientation } from "../../src/core/cells";
import { compositeMap, cellScale } from "../../src/core/compositor";
import type { PixelBuffer, Project, ProjectMap, TileLayer } from "../../src/core/model";
import { createTileLayer } from "../../src/core/model";
import {
    CHUNK_MEMORY_LIMIT,
    LIVE_LIMIT,
    LIVE_RETURN,
    chooseResolution,
    chunkBytes,
    nextTier,
    planSets,
    visibleCells,
    visibleCount,
} from "../../src/engine/viewport/chunkPlan";
import type { Tier } from "../../src/engine/viewport/chunkPlan";
import { ChunkTier, chunkTextureId } from "../../src/engine/viewport/chunkTier";
import type { ChunkRegion, ChunkTarget } from "../../src/engine/viewport/chunkTier";
import { createReferenceProject } from "../support/referenceProject";
import { mapOf, projectOf, tilesetOf } from "./te-012-support";

// TE-015: the chunk tier (ENGINE §4) against a fake renderer whose updates settle when the test
// says so. Chunk textures are checked against `core/compositor` texel for texel.

const FULL_HD = { width: 1920, height: 1080 };

/** A map of `layers` full tile layers of `size × size` cells of 2-pixel tiles, four tiles. */
function filledProject(size: number, layers: number): Project {
    const tileset = tilesetOf(
        [
            ["AB", "CD"],
            ["EF", ".G"],
            ["HI", "JK"],
            ["L.", "MN"],
        ],
        { slot: 1 },
    );
    const list: TileLayer[] = [];
    for (let index = 0; index < layers; index += 1) {
        const layer = createTileLayer(index + 1, `Layer ${index + 1}`);
        const cells = new CellStore();
        for (let y = 0; y < size; y += 1) {
            for (let x = 0; x < size; x += 1) {
                if ((x + y + index) % 5 === 0) continue;
                const orientation = ((x * 3 + y + index) % 8) as Orientation;
                cells.set(x, y, cellValue(1, (x + 2 * y + index) % 4, orientation));
            }
        }
        layer.cells = cells;
        list.push(layer);
    }
    const map = mapOf({ width: size, height: size, tileWidth: 2, layers: list });
    return projectOf(map, [tileset]);
}

interface Update {
    id: string;
    pixels: PixelBuffer;
    region: ChunkRegion;
    settle(ok?: boolean, drop?: boolean): void;
}

/** A renderer that keeps editable textures as pixels; updates wait for `settle`. */
function fakeRenderer() {
    const textures = new Map<string, PixelBuffer>();
    const updates: Update[] = [];
    const created: string[] = [];
    const released: string[] = [];
    const target: ChunkTarget = {
        createTexture(id, width, height) {
            if (textures.has(id)) return Promise.reject(new Error(`${id} exists`));
            created.push(id);
            textures.set(id, { width, height, data: new Uint8ClampedArray(width * height * 4) });
            return Promise.resolve();
        },
        updateTexture(id, source, region) {
            const pixels = source as unknown as PixelBuffer;
            return new Promise<void>((resolve, reject) => {
                updates.push({
                    id,
                    pixels,
                    region,
                    settle(ok = true, drop = false) {
                        updates.splice(updates.indexOf(this), 1);
                        if (!ok) {
                            if (drop) textures.delete(id);
                            reject(new Error("lost"));
                            return;
                        }
                        const texture = textures.get(id);
                        if (!texture) {
                            reject(new Error(`${id} absent`));
                            return;
                        }
                        for (let y = 0; y < region.height; y += 1) {
                            const from = ((region.sourceY + y) * pixels.width + region.sourceX) * 4;
                            const to =
                                ((region.destinationY + y) * texture.width + region.destinationX) *
                                4;
                            texture.data.set(
                                pixels.data.subarray(from, from + region.width * 4),
                                to,
                            );
                        }
                        resolve();
                    },
                });
            });
        },
        releaseTexture(id) {
            released.push(id);
            textures.delete(id);
        },
        has: (id) => textures.has(id),
    };
    return { target, textures, updates, created, released };
}

/** Slices run when the test says so. */
function manualSlices() {
    const jobs: (() => void)[] = [];
    return {
        slice(job: () => void) {
            jobs.push(job);
            return () => {
                const at = jobs.indexOf(job);
                if (at >= 0) jobs.splice(at, 1);
            };
        },
        jobs,
    };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setUp(project: Project, size = { width: 400, height: 300 }) {
    const renderer = fakeRenderer();
    const slices = manualSlices();
    const changes = { count: 0, errors: [] as unknown[] };
    const tier = new ChunkTier({
        target: renderer.target,
        hooks: {
            onChange: () => (changes.count += 1),
            onError: (error) => changes.errors.push(error),
        },
        // A canvas holds a copy of the pixels.
        source: (pixels) =>
            ({ ...pixels, data: pixels.data.slice() }) as unknown as HTMLCanvasElement,
        slice: (job) => slices.slice(job),
    });
    const map = project.maps[0]!;
    tier.sync(project, map, size);
    /** Runs slices and settles updates until nothing is left. */
    const settleAll = async () => {
        for (let round = 0; round < 10_000; round += 1) {
            await flush();
            if (slices.jobs.length > 0) {
                slices.jobs.shift()!();
                continue;
            }
            if (renderer.updates.length > 0) {
                renderer.updates[0]!.settle();
                continue;
            }
            await flush();
            if (slices.jobs.length === 0 && renderer.updates.length === 0) return;
        }
        throw new Error("did not settle");
    };
    return { tier, renderer, slices, changes, map, settleAll };
}

/** The reference of one chunk texture: its set's layers composited in their own space. */
function chunkReference(
    project: Project,
    map: ProjectMap,
    layerIds: number[],
    cx: number,
    cy: number,
    texels: number,
): PixelBuffer {
    const side = CHUNK_SIZE * texels;
    return compositeMap(project, map, {
        x: cx * side,
        y: cy * side,
        width: side,
        height: side,
        scaleX: cellScale(texels, map.tileWidth),
        scaleY: cellScale(texels, map.tileHeight),
        layerIds: new Set(layerIds),
        layerSpace: true,
        background: false,
    });
}

function expectChunksEqualReference(
    project: Project,
    textures: Map<string, PixelBuffer>,
    texels: number,
): void {
    const map = project.maps[0]!;
    let checked = 0;
    for (const set of planSets(map)) {
        for (const [id, texture] of textures) {
            const [, , key, cx, cy] = id.split(":");
            if (Number(key) !== set.key) continue;
            const expected = chunkReference(project, map, set.layerIds, +cx!, +cy!, texels);
            expect(Buffer.from(texture.data).equals(Buffer.from(expected.data)), id).toBe(true);
            checked += 1;
        }
    }
    expect(checked).toBeGreaterThan(0);
}

describe("chunk sets (ENGINE §4)", () => {
    it("flattens consecutive layers that share parallax and offset; the parallax layer has its own", () => {
        const map = createReferenceProject().maps[0]!;
        const sets = planSets(map);
        expect(sets.map((set) => set.layerIds)).toEqual([[1, 2, 3, 4, 5, 6, 7], [8]]);
        expect(sets.map((set) => set.key)).toEqual([1, 8]);
        expect(sets[1]!.placement).toMatchObject({ parallaxX: 0.5, parallaxY: 0.5 });
    });

    it("keeps the layers' order: a layer with its own offset splits a run", () => {
        const map = createReferenceProject().maps[0]!;
        (map.layers[3] as TileLayer).offsetX = 4;
        expect(planSets(map).map((set) => set.layerIds)).toEqual([[1, 2, 3], [4], [5, 6, 7], [8]]);
    });

    it("leaves out hidden layers and layers at opacity 0; opacity is part of the content", () => {
        const map = createReferenceProject().maps[0]!;
        const before = planSets(map)[0]!.content;
        (map.layers[1] as TileLayer).visible = false;
        (map.layers[2] as TileLayer).opacity = 0;
        (map.layers[3] as TileLayer).opacity = 100;
        const after = planSets(map)[0]!;
        expect(after.layerIds).toEqual([1, 4, 5, 6, 7]);
        expect(after.content).not.toBe(before);
    });
});

describe("resolution (ENGINE §4)", () => {
    it("gives the reference map T = 8 and 32 MB at 1920 × 1080", () => {
        const project = createReferenceProject();
        const map = project.maps[0]!;
        const sets = planSets(map);
        const chunks = 2 * 64;
        const texels = chooseResolution(map, visibleCells(map, sets), chunks, FULL_HD);
        expect(texels).toBe(8);
        expect(chunkBytes(chunks, texels!)).toBe(32 * 1024 * 1024);
    });

    it("is reduced until the chunks fit 64 MB", () => {
        const project = createReferenceProject();
        const map = project.maps[0]!;
        const cells = visibleCells(map, planSets(map));
        // At 4K the switch zoom gives about 32 device pixels a cell: 512 MB at T = 32.
        const texels = chooseResolution(map, cells, 128, { width: 3840, height: 2160 })!;
        expect(chunkBytes(128, texels)).toBeLessThanOrEqual(CHUNK_MEMORY_LIMIT);
        expect(chunkBytes(128, texels * 2)).toBeGreaterThan(CHUNK_MEMORY_LIMIT);
        // Too many chunks for one texel a cell: no chunk tier.
        expect(chooseResolution(map, cells, 70_000, FULL_HD)).toBeNull();
    });
});

describe("tier choice (ENGINE §4)", () => {
    it("enters above 65,536 once built and returns at 58,982 or below", () => {
        expect(nextTier("live", LIVE_LIMIT + 1, false)).toBe("live");
        expect(nextTier("live", LIVE_LIMIT + 1, true)).toBe("chunk");
        expect(nextTier("live", LIVE_LIMIT, true)).toBe("live");
        expect(nextTier("chunk", LIVE_LIMIT, true)).toBe("chunk");
        expect(nextTier("chunk", LIVE_RETURN + 1, true)).toBe("chunk");
        expect(nextTier("chunk", LIVE_RETURN, true)).toBe("live");
        expect(nextTier("chunk", LIVE_LIMIT * 4, false)).toBe("live");
    });

    it("counts the evenly filled reference map exactly and pans without flipping", () => {
        const map = createReferenceProject().maps[0]!;
        const sets = planSets(map).map((set) => ({
            ...set,
            placement: { parallaxX: 1, parallaxY: 1, offsetX: 0, offsetY: 0 },
        }));
        // A 1920 × 1080 view at the switch zoom holds 65,536 cells of the 8 full layers.
        const scale = Math.sqrt((8 * 1920 * 1080) / (LIVE_LIMIT * 256));
        const camera = { centreX: 2048, centreY: 2048, scale };
        expect(visibleCount(map, sets, camera, FULL_HD)).toBeCloseTo(LIVE_LIMIT, 6);

        // Pan one map pixel at a time over two chunks at zooms around the switch: the count
        // moves smoothly, so the tier changes at most once each way.
        for (const factor of [0.97, 0.99, 1, 1.01, 1.03, 1.06]) {
            let tier: Tier = "live";
            let changes = 0;
            let previous = -1;
            for (let dx = -1024; dx <= 1024; dx += 1) {
                const count = visibleCount(
                    map,
                    sets,
                    { centreX: 2048 + dx, centreY: 2048 + dx / 3, scale: scale * factor },
                    FULL_HD,
                );
                if (previous >= 0) expect(Math.abs(count - previous)).toBeLessThan(2000);
                previous = count;
                const next = nextTier(tier, count, true);
                if (next !== tier) changes += 1;
                tier = next;
            }
            expect(changes).toBeLessThanOrEqual(1);
        }
    });

    it("whole chunk counts would flip tiers on such a pan (why the count weighs coverage)", () => {
        const map = createReferenceProject().maps[0]!;
        const view = { width: 1920, height: 1080 };
        let worst = 0;
        for (let scale = 1; scale <= 2.5; scale += 0.05) {
            let tier: Tier = "live";
            let changes = 0;
            // A diagonal pan: the view's edges cross chunk columns and rows.
            for (let dx = 0; dx <= 2048; dx += 4) {
                const w = view.width / scale;
                const h = view.height / scale;
                const cx = 1024 + dx;
                const cy = 1024 + dx * 0.37;
                const rect = {
                    x: Math.floor((cx - w / 2) / 16),
                    y: Math.floor((cy - h / 2) / 16),
                    width: 0,
                    height: 0,
                };
                rect.width = Math.ceil((cx + w / 2) / 16) - rect.x;
                rect.height = Math.ceil((cy + h / 2) / 16) - rect.y;
                let count = 0;
                for (const layer of map.layers as TileLayer[]) {
                    count += layer.cells.countUpperBound(rect);
                }
                const next = nextTier(tier, count, true);
                if (next !== tier) changes += 1;
                tier = next;
            }
            worst = Math.max(worst, changes);
        }
        expect(worst).toBeGreaterThan(2);
    });
});

describe("chunk tier against a fake renderer", () => {
    it("plans nothing for a map within the live tier's limit", async () => {
        const project = filledProject(64, 8);
        expect(visibleCells(project.maps[0]!, planSets(project.maps[0]!))).toBeLessThan(LIVE_LIMIT);
        const { tier, renderer, slices } = setUp(project);
        await flush();
        expect(tier.stats.sets).toBe(0);
        expect(slices.jobs).toEqual([]);
        expect(renderer.created).toEqual([]);
    });

    it("builds one chunk per slice in the background; the textures equal the compositor", async () => {
        const project = filledProject(128, 8);
        const { tier, renderer, slices, changes, settleAll } = setUp(project);
        expect(tier.ready).toBe(false);
        const stats = tier.stats;
        expect(stats.sets).toBe(1);
        expect(stats.chunks).toBe(16);

        // Nothing happens in the call. Each slice then creates one texture, or composites one
        // chunk and submits one update; a created chunk is populated next. At most two
        // creations and updates are under way: the slices wait for one to settle.
        expect(renderer.created).toEqual([]);
        const step = async () => {
            await flush();
            expect(slices.jobs.length).toBe(1);
            slices.jobs.shift()!();
            return [renderer.created.length, renderer.updates.length];
        };
        expect(await step()).toEqual([1, 0]);
        expect(await step()).toEqual([1, 1]);
        expect(renderer.updates[0]!.region).toMatchObject({ destinationX: 0, destinationY: 0 });
        expect(await step()).toEqual([2, 1]);
        expect(await step()).toEqual([2, 2]);
        await flush();
        expect(slices.jobs.length).toBe(0);
        renderer.updates[0]!.settle();
        expect(await step()).toEqual([3, 1]);

        await settleAll();
        expect(tier.ready).toBe(true);
        expect(changes.count).toBeGreaterThan(0);
        expect(tier.stats.builds).toBe(1);
        expect(tier.stats.slices).toBe(32);
        expect(tier.stats.bytes).toBe(chunkBytes(16, tier.stats.texelsPerCell));
        expectChunksEqualReference(project, renderer.textures, tier.stats.texelsPerCell);
    });

    it("patches a changed cell with one update in flight per chunk; later edits coalesce", async () => {
        const project = filledProject(128, 8);
        const { tier, renderer, slices, map, settleAll } = setUp(project);
        await settleAll();
        const layer = map.layers[2] as TileLayer;
        const touch = (rect: CellRect) =>
            tier.noteTouched({
                mapId: map.id,
                layerIds: [layer.id],
                cellRects: [rect],
                tilesetIds: [],
                structure: false,
            });

        layer.cells.set(3, 4, cellValue(1, 3, 5));
        touch({ x: 3, y: 4, width: 1, height: 1 });
        expect(tier.stats.live).toBe(1);
        await flush();
        slices.jobs.shift()!();
        expect(renderer.updates.length).toBe(1);

        // Two more edits of the same chunk while its update is in flight: nothing more is sent.
        layer.cells.set(10, 4, cellValue(1, 0));
        touch({ x: 10, y: 4, width: 1, height: 1 });
        layer.cells.set(5, 20, 0);
        touch({ x: 5, y: 20, width: 1, height: 1 });
        await flush();
        expect(slices.jobs.length).toBe(0);
        expect(renderer.updates.length).toBe(1);

        // Once it settles, one update covers both later edits.
        renderer.updates[0]!.settle();
        await flush();
        expect(tier.stats.live).toBe(1);
        slices.jobs.shift()!();
        expect(renderer.updates.length).toBe(1);
        const texels = tier.stats.texelsPerCell;
        expect(renderer.updates[0]!.region).toEqual({
            sourceX: 0,
            sourceY: 0,
            width: 6 * texels,
            height: 17 * texels,
            destinationX: 5 * texels,
            destinationY: 4 * texels,
        });
        renderer.updates[0]!.settle();
        await settleAll();
        // Settled: no live quads, and the chunk equals the document.
        expect(tier.stats.live).toBe(0);
        expect(tier.stats.pending).toBe(0);
        expectChunksEqualReference(project, renderer.textures, texels);
    });

    it("recovers a rejected update by compositing the region again from the document", async () => {
        const project = filledProject(128, 8);
        const { tier, renderer, slices, map, settleAll } = setUp(project);
        await settleAll();
        const layer = map.layers[7] as TileLayer;
        const touch = (x: number, y: number) =>
            tier.noteTouched({
                mapId: map.id,
                layerIds: [layer.id],
                cellRects: [{ x, y, width: 1, height: 1 }],
                tilesetIds: [],
                structure: false,
            });

        layer.cells.set(40, 40, cellValue(1, 1));
        touch(40, 40);
        await flush();
        slices.jobs.shift()!();
        const first = renderer.updates[0]!;
        // The cell changes again before the loss is known: the retry must show the newer value.
        layer.cells.set(40, 40, cellValue(1, 2, 6));
        touch(40, 40);
        first.settle(false);
        await flush();
        expect(tier.stats.rejected).toBe(1);
        expect(tier.stats.live).toBe(1);
        slices.jobs.shift()!();
        const retry = renderer.updates[0]!;
        const texels = tier.stats.texelsPerCell;
        const expected = chunkReference(project, map, planSets(map)[0]!.layerIds, 1, 1, texels);
        // The retry's pixels are the cell's region of a fresh composite.
        const x = (40 - 32) * texels;
        for (let row = 0; row < texels; row += 1) {
            const at = (x + row * expected.width) * 4 + (40 - 32) * texels * expected.width * 4;
            const got = retry.pixels.data
                .subarray(row * retry.pixels.width * 4)
                .subarray(0, texels * 4);
            expect([...got]).toEqual([...expected.data.subarray(at, at + texels * 4)]);
        }
        await settleAll();
        expect(tier.stats.live).toBe(0);
        expect(changesOf(tier)).toEqual({ pending: 0, rejected: 1 });
        expectChunksEqualReference(project, renderer.textures, texels);
    });

    it("re-creates and repopulates a chunk whose registration was dropped", async () => {
        const project = filledProject(128, 8);
        const { tier, renderer, slices, map, settleAll } = setUp(project);
        await settleAll();
        const layer = map.layers[0] as TileLayer;
        layer.cells.set(70, 70, cellValue(1, 0, 3));
        tier.noteTouched({
            mapId: map.id,
            layerIds: [layer.id],
            cellRects: [{ x: 70, y: 70, width: 1, height: 1 }],
            tilesetIds: [],
            structure: false,
        });
        await flush();
        slices.jobs.shift()!();
        const id = renderer.updates[0]!.id;
        expect(id).toBe(chunkTextureId(1, 2, 2));
        const createdBefore = renderer.created.length;
        renderer.updates[0]!.settle(false, true);
        await flush();
        // Until it is back, the whole chunk is drawn as live quads.
        expect(tier.stats.live).toBe(1);
        await settleAll();
        expect(renderer.created.length).toBe(createdBefore + 1);
        expect(renderer.created.at(-1)).toBe(id);
        expect(tier.stats.live).toBe(0);
        expect(tier.ready).toBe(true);
        expectChunksEqualReference(project, renderer.textures, tier.stats.texelsPerCell);
    });

    it("reports a chunk that keeps failing and leaves it to live quads", async () => {
        const project = filledProject(128, 8);
        const { tier, renderer, slices, changes, map, settleAll } = setUp(project);
        await settleAll();
        const layer = map.layers[0] as TileLayer;
        layer.cells.set(1, 1, 0);
        tier.noteTouched({
            mapId: map.id,
            layerIds: [layer.id],
            cellRects: [{ x: 1, y: 1, width: 1, height: 1 }],
            tilesetIds: [],
            structure: false,
        });
        for (let attempt = 0; attempt < 3; attempt += 1) {
            await flush();
            slices.jobs.shift()!();
            renderer.updates[0]!.settle(false);
        }
        await flush();
        expect(changes.errors.length).toBe(1);
        expect(slices.jobs.length).toBe(0);
        expect(tier.stats.live).toBe(1);
    });

    it("rebuilds a set after an opacity change and keeps it when only its offset changes", async () => {
        const project = filledProject(128, 8);
        const { tier, renderer, map, settleAll } = setUp(project, { width: 400, height: 300 });
        await settleAll();
        const size = { width: 400, height: 300 };

        // Every layer moves by the same offset: the set is drawn elsewhere, its chunks stay.
        for (const layer of map.layers) layer.offsetX = 6;
        tier.sync(project, map, size);
        expect(tier.ready).toBe(true);
        expect(tier.stats.pending).toBe(0);

        // An opacity change: the set is composited again and the tier waits for it.
        (map.layers[4] as TileLayer).opacity = 90;
        tier.sync(project, map, size);
        expect(tier.ready).toBe(false);
        await settleAll();
        expect(tier.ready).toBe(true);
        expect(tier.stats.builds).toBe(2);
        expectChunksEqualReference(project, renderer.textures, tier.stats.texelsPerCell);

        // One layer gets parallax: the run splits into three sets; IDs of the old set's
        // upper layers are new.
        (map.layers[5] as TileLayer).parallaxX = 0.5;
        tier.sync(project, map, size);
        expect(tier.stats.sets).toBe(3);
        await settleAll();
        expect(renderer.created).toContain(chunkTextureId(6, 0, 0));
        expect(renderer.created).toContain(chunkTextureId(7, 0, 0));
        expectChunksEqualReference(project, renderer.textures, tier.stats.texelsPerCell);
    });

    it("releases its textures for another map and for a deleted layer", async () => {
        const project = filledProject(128, 8);
        const { tier, renderer, map, settleAll } = setUp(project);
        await settleAll();
        const size = { width: 400, height: 300 };

        // The bottom layer is deleted: the set's key and so every texture ID changes.
        map.layers.shift();
        tier.noteTouched({
            mapId: map.id,
            layerIds: [],
            cellRects: [],
            tilesetIds: [],
            structure: true,
        });
        tier.sync(project, map, size);
        expect(renderer.released).toContain(chunkTextureId(1, 0, 0));
        await settleAll();
        expect([...renderer.textures.keys()].every((id) => id.startsWith("ed:chunk:2:"))).toBe(
            true,
        );

        // Another map: everything of this one is released.
        const other = filledProject(16, 1);
        tier.sync(other, other.maps[0]!, size);
        expect(renderer.textures.size).toBe(0);
        expect(tier.stats.sets).toBe(0);
    });

    it("rebuilds every chunk when a tileset's pixels change", async () => {
        const project = filledProject(128, 8);
        const { tier, renderer, settleAll } = setUp(project);
        await settleAll();
        const tileset = project.tilesets[0]!;
        tileset.pixels.data.fill(77, 0, 16);
        tier.noteTouched({
            mapId: null,
            layerIds: [],
            cellRects: [],
            tilesetIds: [tileset.id],
            structure: false,
        });
        expect(tier.ready).toBe(false);
        await settleAll();
        expect(tier.ready).toBe(true);
        expectChunksEqualReference(project, renderer.textures, tier.stats.texelsPerCell);
    });
});

describe("chunk tier review follow-ups", () => {
    /** Runs one slice or settles one update; false when nothing is left. */
    async function stepOnce(
        slices: ReturnType<typeof manualSlices>,
        renderer: ReturnType<typeof fakeRenderer>,
    ): Promise<boolean> {
        await flush();
        if (slices.jobs.length > 0) {
            slices.jobs.shift()!();
            return true;
        }
        if (renderer.updates.length > 0) {
            renderer.updates[0]!.settle();
            return true;
        }
        return false;
    }

    it("a cell painted while its chunk's build update is in flight still ends the build", async () => {
        const project = filledProject(128, 8);
        const { tier, renderer, slices, map, settleAll } = setUp(project);
        // Create the first chunk, then submit its full composite.
        await flush();
        slices.jobs.shift()!();
        await flush();
        slices.jobs.shift()!();
        expect(renderer.updates.length).toBe(1);
        const layer = map.layers[0] as TileLayer;
        layer.cells.set(2, 2, cellValue(1, 3, 1));
        tier.noteTouched({
            mapId: map.id,
            layerIds: [layer.id],
            cellRects: [{ x: 2, y: 2, width: 1, height: 1 }],
            tilesetIds: [],
            structure: false,
        });
        await settleAll();
        expect(tier.ready).toBe(true);
        expectChunksEqualReference(project, renderer.textures, tier.stats.texelsPerCell);
    });

    it("a set change that leaves nothing to build ends the build", async () => {
        const project = filledProject(128, 8);
        (project.maps[0]!.layers[7] as TileLayer).parallaxX = 0.5;
        const { tier, renderer, slices, map } = setUp(project);
        expect(tier.stats.sets).toBe(2);
        // Build until the parallax set starts: the bottom set is then all created.
        while (!renderer.created.some((id) => id.startsWith("ed:chunk:8:"))) {
            expect(await stepOnce(slices, renderer)).toBe(true);
        }
        for (const update of [...renderer.updates]) {
            if (update.id.startsWith("ed:chunk:1:")) update.settle();
        }
        await flush();
        // The parallax layer is hidden: the bottom set, built, is all that is left.
        (map.layers[7] as TileLayer).visible = false;
        tier.sync(project, map, { width: 400, height: 300 });
        while (await stepOnce(slices, renderer));
        expect(tier.stats.sets).toBe(1);
        expect(tier.ready).toBe(true);
    });

    it("a chunk that keeps failing during the build is left to live quads; the build ends", async () => {
        const project = filledProject(128, 8);
        const { tier, renderer, slices, changes } = setUp(project);
        let rejected = 0;
        for (let round = 0; round < 10_000; round += 1) {
            await flush();
            if (slices.jobs.length > 0) {
                slices.jobs.shift()!();
                continue;
            }
            const update = renderer.updates[0];
            if (!update) break;
            // Every update of the first chunk is lost.
            const lost = update.id === chunkTextureId(1, 0, 0);
            if (lost) rejected += 1;
            update.settle(!lost);
        }
        expect(rejected).toBe(3);
        expect(changes.errors.length).toBe(1);
        expect(tier.ready).toBe(true);
        expect(tier.liveCells()).toEqual([
            { set: 0, cells: { x: 0, y: 0, width: 32, height: 32 } },
        ]);
    });

    it("a chunk a paint creates during the build is part of the build", async () => {
        const project = filledProject(128, 8);
        const map = project.maps[0]!;
        // The bottom-right chunk is empty: it has no texture.
        for (const layer of map.layers as TileLayer[]) {
            layer.cells.clear({ x: 96, y: 96, width: 32, height: 32 });
        }
        const { tier, renderer, slices, settleAll } = setUp(project);
        expect(tier.stats.chunks).toBe(15);
        await flush();
        slices.jobs.shift()!();
        const layer = map.layers[2] as TileLayer;
        layer.cells.set(100, 100, cellValue(1, 1));
        tier.noteTouched({
            mapId: map.id,
            layerIds: [layer.id],
            cellRects: [{ x: 100, y: 100, width: 1, height: 1 }],
            tilesetIds: [],
            structure: false,
        });
        expect(tier.stats.chunks).toBe(16);
        // Settle step by step: the build may not end while the new chunk is not populated.
        for (;;) {
            await flush();
            if (tier.ready) {
                expect(renderer.textures.has(chunkTextureId(1, 3, 3))).toBe(true);
                expect(tier.stats.pending).toBe(0);
            }
            if (slices.jobs.length > 0) slices.jobs.shift()!();
            else if (renderer.updates.length > 0) renderer.updates[0]!.settle();
            else break;
        }
        await settleAll();
        expect(tier.ready).toBe(true);
        expectChunksEqualReference(project, renderer.textures, tier.stats.texelsPerCell);
    });

    it("a texture the renderer still holds but cannot report is released before it is created again", async () => {
        const project = filledProject(128, 8);
        const { tier, renderer, slices, map, settleAll } = setUp(project);
        await settleAll();
        // As past the inspection's limit of 1,000 entries: the registration is not reported.
        renderer.target.has = () => false;
        const layer = map.layers[0] as TileLayer;
        layer.cells.set(5, 5, cellValue(1, 2));
        tier.noteTouched({
            mapId: map.id,
            layerIds: [layer.id],
            cellRects: [{ x: 5, y: 5, width: 1, height: 1 }],
            tilesetIds: [],
            structure: false,
        });
        await flush();
        slices.jobs.shift()!();
        renderer.updates[0]!.settle(false);
        await settleAll();
        expect(tier.stats.rejected).toBe(1);
        expect(tier.stats.live).toBe(0);
        expect(tier.stats.pending).toBe(0);
        expect(renderer.released).toContain(chunkTextureId(1, 0, 0));
        expectChunksEqualReference(project, renderer.textures, tier.stats.texelsPerCell);
    });

    it("a tileset change plans the chunks again: tiles that reach further get chunks", async () => {
        const project = filledProject(128, 8);
        const { tier, renderer, map, settleAll } = setUp(project);
        await settleAll();
        expect(tier.stats.chunks).toBe(16);
        const tileset = project.tilesets[0]!;
        tileset.offsetX = 3;
        tier.noteTouched({
            mapId: null,
            layerIds: [],
            cellRects: [],
            tilesetIds: [tileset.id],
            structure: false,
        });
        tier.sync(project, map, { width: 400, height: 300 });
        await settleAll();
        // Tiles of the right column now reach into a fifth column of chunks.
        expect(tier.stats.chunks).toBe(20);
        expect(tier.ready).toBe(true);
        expectChunksEqualReference(project, renderer.textures, tier.stats.texelsPerCell);
    });

    it("no map shown releases every chunk; the map shown again is planned and built anew", async () => {
        const project = filledProject(128, 8);
        const { tier, renderer, map, settleAll } = setUp(project);
        await settleAll();
        expect(renderer.textures.size).toBe(16);
        tier.clear();
        expect(renderer.textures.size).toBe(0);
        expect(tier.stats.chunks).toBe(0);
        expect(tier.stats.bytes).toBe(0);
        expect(tier.ready).toBe(false);
        // A command while no map is shown changes nothing.
        tier.noteTouched({
            mapId: map.id,
            layerIds: [map.layers[0]!.id],
            cellRects: [{ x: 0, y: 0, width: 1, height: 1 }],
            tilesetIds: [],
            structure: false,
        });
        await settleAll();
        expect(renderer.textures.size).toBe(0);
        tier.sync(project, map, { width: 400, height: 300 });
        await settleAll();
        expect(tier.ready).toBe(true);
        expect(renderer.textures.size).toBe(16);
        expectChunksEqualReference(project, renderer.textures, tier.stats.texelsPerCell);
    });

    it("no map shown during a build leaves no texture once the work under way settles", async () => {
        const project = filledProject(128, 8);
        const { tier, renderer, slices, settleAll } = setUp(project);
        await flush();
        slices.jobs.shift()!();
        await flush();
        slices.jobs.shift()!();
        expect(renderer.updates.length).toBe(1);
        tier.clear();
        await settleAll();
        expect(renderer.textures.size).toBe(0);
        expect(tier.stats.chunks).toBe(0);
        expect(tier.stats.pending).toBe(0);
    });
});

function changesOf(tier: ChunkTier) {
    const { pending, rejected } = tier.stats;
    return { pending, rejected };
}

describe("compositor fast path", () => {
    // Tiles 1 and 3 are opaque: where one of them lies in a layer at full opacity, the layers
    // under it are skipped. The slow path (an unused tileset with an offset turns the fast path
    // off) skips nothing.
    const tiles = [
        ["AB", "C."],
        ["DE", "FG"],
        ["H.", ".I"],
        ["JK", "LM"],
    ];
    const cell = fc.tuple(fc.nat(7), fc.nat(5), fc.nat(3), fc.integer({ min: 0, max: 7 }));

    it("tiles inside their cells composite the same with and without the fast path", () => {
        fc.assert(
            fc.property(
                fc.record({
                    layers: fc.array(
                        fc.record({
                            cells: fc.array(cell, { maxLength: 40 }),
                            opacity: fc.constantFrom(255, 255, 140),
                            visible: fc.constantFrom(true, true, false),
                        }),
                        { minLength: 1, maxLength: 4 },
                    ),
                    background: fc.constantFrom<number | null>(null, 0x336699ff),
                    texels: fc.constantFrom(1, 2, 3, 5),
                    pixels: fc.constantFrom(2, 3, 4),
                    x: fc.integer({ min: -3, max: 6 }),
                    y: fc.integer({ min: -3, max: 6 }),
                    layerSpace: fc.boolean(),
                }),
                (c) => {
                    const layers = c.layers.map((spec, index) => {
                        const layer = createTileLayer(index + 1, `Layer ${index + 1}`);
                        layer.opacity = spec.opacity;
                        layer.visible = spec.visible;
                        for (const [x, y, id, o] of spec.cells) {
                            layer.cells.set(x, y, cellValue(1, id, o as Orientation));
                        }
                        return layer;
                    });
                    const map = mapOf({
                        width: 8,
                        height: 6,
                        tileWidth: 2,
                        layers,
                        backgroundColor: c.background,
                    });
                    const fast = projectOf(map, [tilesetOf(tiles, { slot: 1 })]);
                    const slow = projectOf(map, [
                        tilesetOf(tiles, { slot: 1 }),
                        tilesetOf([["N"]], { slot: 2, offsetX: 1 }),
                    ]);
                    const request = {
                        x: c.x,
                        y: c.y,
                        width: 14,
                        height: 10,
                        scaleX: { texels: c.texels, pixels: c.pixels },
                        scaleY: { texels: c.texels, pixels: c.pixels },
                        layerSpace: c.layerSpace,
                    };
                    const a = compositeMap(fast, map, request);
                    const b = compositeMap(slow, map, request);
                    expect([...a.data]).toEqual([...b.data]);
                },
            ),
            { numRuns: 300 },
        );
    });

    it("skips the layers under opaque cells, and only those", () => {
        const project = createReferenceProject();
        const map = project.maps[0]!;
        // Every tile of the reference map is opaque: the top layer hides the six under it.
        const top = map.layers[6] as TileLayer;
        const request = {
            x: 0,
            y: 0,
            width: 64,
            height: 64,
            layerIds: new Set([1, 2, 3, 4, 5, 6, 7]),
            layerSpace: true,
        };
        const all = compositeMap(project, map, request);
        const alone = compositeMap(project, map, { ...request, layerIds: new Set([7]) });
        expect(Buffer.from(all.data).equals(Buffer.from(alone.data))).toBe(true);
        // A hole in the top layer shows the layer under it there.
        top.cells.set(1, 1, 0);
        const holed = compositeMap(project, map, request);
        const under = compositeMap(project, map, { ...request, layerIds: new Set([6]) });
        const at = (16 * 64 + 16) * 4;
        expect([...holed.data.subarray(at, at + 4)]).toEqual([...under.data.subarray(at, at + 4)]);
    });
});
