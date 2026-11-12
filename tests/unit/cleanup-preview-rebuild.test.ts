import { describe, expect, it } from "vitest";
import { previewWire } from "../../src/app/preview/buildTilemap";
import { PreviewSource } from "../../src/app/preview/previewSource";
import { cellValue } from "../../src/core/cells";
import { History, cellPatchCommand, touchedNothing } from "../../src/core/history";
import type { Command } from "../../src/core/history";
import { setLayerValuesCommand } from "../../src/core/layers";
import { createProjectSession } from "../../src/core/model";
import type { Project, TileLayer } from "../../src/core/model";
import { packTileset } from "../../src/core/pack";
import { projectFromWire } from "../../src/core/project";
import { readTilemap } from "../../src/core/runtime/runtime";
import { tilemapFor, tilemapFromParts, tilemapParts } from "../../src/core/tilemap";
import type { TilemapParts } from "../../src/core/tilemap";
import { DemandScheduler } from "../../src/engine/preview/demandScheduler";
import type { FrameClock } from "../../src/engine/preview/demandScheduler";
import type { PreviewContent } from "../../src/engine/preview";
import { createConformanceProject } from "../support/conformanceProject";

// The preview's tilemap is made off the notification path (cleanup; SPEC §12, ENGINE §6): a
// store or history notification only asks for it. The build starts later, runs one at a time
// on the newest project, and the preview draws no frame of an older tilemap meanwhile.

const LAYERS_MAP = "layers";

/** Lets pending promises and timers of zero delay run. */
async function settle(): Promise<void> {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function atlasesOf(project: Project): Record<string, unknown> {
    const atlases: Record<string, unknown> = {};
    for (const tileset of project.tilesets)
        atlases[tileset.exportName] = packTileset(tileset).atlas;
    return atlases;
}

/** The tilemap a game would load from the export of `project`'s map now. */
function fresh(project: Project, mapExportName = LAYERS_MAP) {
    const map = project.maps.find((each) => each.exportName === mapExportName)!;
    return readTilemap(JSON.parse(tilemapFor(project, map)), atlasesOf(project));
}

const mapOf = (project: Project) => project.maps.find((each) => each.exportName === LAYERS_MAP)!;
const otherOf = (project: Project) => project.maps.find((each) => each.exportName !== LAYERS_MAP)!;

function groundOf(project: Project): TileLayer {
    return mapOf(project).layers.find((layer) => layer.name === "Ground") as TileLayer;
}

/** A step that changes the opacity of the layer Far: the tilemap is built again. */
function opacity(project: Project, value: number): Command {
    const map = mapOf(project);
    const far = map.layers.find((layer) => layer.name === "Far")!;
    return setLayerValuesCommand(project, map.id, [far.id], { opacity: value });
}

/** A step that writes one cell of Ground. */
function paint(project: Project, x: number, y: number, value: number): Command {
    const map = mapOf(project);
    const ground = groundOf(project);
    return cellPatchCommand({
        label: "Stamp Brush",
        mapId: map.id,
        layerId: ground.id,
        width: map.width,
        words: new Uint32Array([y * map.width + x, ground.cells.get(x, y), value]),
        cellRect: { x, y, width: 1, height: 1 },
    });
}

interface Harness {
    project: Project;
    history: History;
    source: PreviewSource;
    contents: (PreviewContent | null)[];
    pending: (string | null)[];
    cells: number;
    errors: string[];
    /** The export name of the map of every build started. */
    builds: string[];
    /** The starts the source asked to run later. */
    deferred: (() => void)[];
    /** Ends each build in flight, in the order they started. */
    gates: (() => void)[];
    /** Builds end by themselves while true. */
    auto: boolean;
    /** Runs the deferred starts. */
    start(): void;
    /** Runs the deferred starts and lets everything under way end. */
    flush(): Promise<void>;
}

/** A source shown the conformance project's layers map, its first tilemap built. */
async function harness(): Promise<Harness> {
    const project = createConformanceProject();
    const history = new History(createProjectSession(project));
    const state: Harness = {
        project,
        history,
        source: null as unknown as PreviewSource,
        contents: [],
        pending: [],
        cells: 0,
        errors: [],
        builds: [],
        deferred: [],
        gates: [],
        auto: true,
        start() {
            for (const run of state.deferred.splice(0)) run();
        },
        async flush() {
            for (let round = 0; round < 4; round += 1) {
                state.start();
                await settle();
            }
        },
    };
    state.source = new PreviewSource({
        pack: async (tileset) => packTileset(tileset),
        build: (from, map, atlases) => {
            state.builds.push(map.exportName);
            // Read now, as a build in the worker reads its snapshot.
            const parts = tilemapParts(from, map, atlases);
            if (state.auto) return Promise.resolve(parts);
            return new Promise<TilemapParts>((resolve) => {
                state.gates.push(() => resolve(parts));
            });
        },
        defer: (run) => state.deferred.push(run),
        onContent: (content) => state.contents.push(content),
        onCells: () => (state.cells += 1),
        onPending: (pending) => state.pending.push(pending),
        onError: (message) => state.errors.push(message),
    });
    history.subscribe(({ touched }) => state.source.touched(touched));
    state.source.show(project, mapOf(project).id);
    await state.flush();
    return state;
}

describe("the preview's tilemap off the notification path (SPEC §12)", () => {
    it("shows another map without building it before `show` returns", async () => {
        const h = await harness();
        expect(h.builds).toEqual([LAYERS_MAP]);
        const count = h.contents.length;
        const other = otherOf(h.project);
        h.source.show(h.project, other.id);
        // Asked for, not built; nothing of the map shown before is drawn meanwhile.
        expect(h.builds).toEqual([LAYERS_MAP]);
        expect(h.deferred).toHaveLength(1);
        expect(h.contents).toHaveLength(count);
        expect(h.pending.at(-1)).toBe("blank");
        expect(h.source.content).toBeNull();
        await h.flush();
        expect(h.builds).toEqual([LAYERS_MAP, other.exportName]);
        expect(h.contents).toHaveLength(count + 1);
        expect(h.contents.at(-1)!.tilemap).toEqual(fresh(h.project, other.exportName));
        expect(h.pending.at(-1)).toBeNull();
        expect(h.errors).toEqual([]);
    });

    it("asks for the tilemap of a step that is no cell step, and builds it later", async () => {
        const h = await harness();
        const before = h.contents.at(-1)!;
        const count = h.contents.length;
        h.history.execute(opacity(h.project, 99));
        // Nothing was built before `execute` returned; no frame is drawn until it is.
        expect(h.builds).toHaveLength(1);
        expect(h.deferred).toHaveLength(1);
        expect(h.contents.at(-1)).toBe(before);
        expect(h.pending.at(-1)).toBe("hold");
        await h.flush();
        expect(h.builds).toHaveLength(2);
        expect(h.contents).toHaveLength(count + 1);
        const after = h.contents.at(-1)!;
        expect(after.tilemap).toEqual(fresh(h.project));
        expect(after.tilemap.layers.find((layer) => layer.name === "Far")!.opacity).toBe(99);
        expect(after.texturesKey).toBe(before.texturesKey);
        expect(h.pending.at(-1)).toBeNull();
    });

    it("makes one build of the newest project for changes in a row", async () => {
        const h = await harness();
        const count = h.contents.length;
        h.history.execute(opacity(h.project, 99));
        h.history.execute(opacity(h.project, 42));
        h.history.undo();
        h.history.execute(opacity(h.project, 7));
        expect(h.deferred).toHaveLength(1);
        await h.flush();
        expect(h.builds).toHaveLength(2);
        expect(h.contents).toHaveLength(count + 1);
        expect(h.contents.at(-1)!.tilemap.layers.find((l) => l.name === "Far")!.opacity).toBe(7);
    });

    it("drops the result of a build the project changed under, and builds once more", async () => {
        const h = await harness();
        const before = h.contents.at(-1)!;
        const count = h.contents.length;
        h.auto = false;
        h.history.execute(opacity(h.project, 99));
        h.start();
        expect(h.builds).toHaveLength(2);
        // Two changes while the build is in flight: one build waits, whatever their number.
        h.history.execute(opacity(h.project, 42));
        h.history.execute(opacity(h.project, 7));
        expect(h.builds).toHaveLength(2);
        expect(h.deferred).toHaveLength(0);
        h.gates.shift()!();
        await settle();
        // The first result is older than the project: not drawn. The next build has started.
        expect(h.contents).toHaveLength(count);
        expect(h.contents.at(-1)).toBe(before);
        expect(h.pending.at(-1)).toBe("hold");
        expect(h.builds).toHaveLength(3);
        h.gates.shift()!();
        await settle();
        expect(h.builds).toHaveLength(3);
        expect(h.contents).toHaveLength(count + 1);
        expect(h.contents.at(-1)!.tilemap).toEqual(fresh(h.project));
        expect(h.contents.at(-1)!.tilemap.layers.find((l) => l.name === "Far")!.opacity).toBe(7);
        expect(h.pending.at(-1)).toBeNull();
    });

    it("drops the result of a map that is no longer shown", async () => {
        const h = await harness();
        const count = h.contents.length;
        const other = otherOf(h.project);
        h.auto = false;
        h.source.show(h.project, other.id);
        h.start();
        expect(h.builds).toEqual([LAYERS_MAP, other.exportName]);
        h.source.show(h.project, mapOf(h.project).id);
        h.gates.shift()!();
        await settle();
        expect(h.contents).toHaveLength(count);
        expect(h.builds).toEqual([LAYERS_MAP, other.exportName, LAYERS_MAP]);
        h.gates.shift()!();
        await settle();
        expect(h.contents).toHaveLength(count + 1);
        expect(h.contents.at(-1)!.tilemap.name).toBe(LAYERS_MAP);
        expect(h.contents.every((content) => content?.tilemap.name !== other.exportName)).toBe(
            true,
        );
    });

    it("writes the cells painted during a build into its result", async () => {
        const h = await harness();
        const before = h.contents.at(-1)!;
        const count = h.contents.length;
        h.auto = false;
        h.history.execute(opacity(h.project, 99));
        h.start();
        const value = cellValue(1, 3, 5);
        h.history.execute(paint(h.project, 2, 1, value));
        // Not written into the tilemap that is being replaced, and no build of its own.
        expect(h.cells).toBe(0);
        expect(h.contents.at(-1)).toBe(before);
        expect(h.deferred).toHaveLength(0);
        h.gates.shift()!();
        await settle();
        expect(h.builds).toHaveLength(2);
        expect(h.contents).toHaveLength(count + 1);
        const after = h.contents.at(-1)!;
        expect(after.tilemap).toEqual(fresh(h.project));
        // Later cells are written in place again.
        h.history.undo();
        expect(h.cells).toBe(1);
        expect(h.contents.at(-1)).toBe(after);
        expect(after.tilemap).toEqual(fresh(h.project));
    });

    it("builds once for a step and the cells painted before its build starts", async () => {
        const h = await harness();
        const count = h.contents.length;
        h.history.execute(opacity(h.project, 99));
        h.history.execute(paint(h.project, 2, 1, cellValue(1, 3, 5)));
        expect(h.cells).toBe(0);
        expect(h.deferred).toHaveLength(1);
        await h.flush();
        expect(h.builds).toHaveLength(2);
        expect(h.contents).toHaveLength(count + 1);
        expect(h.contents.at(-1)!.tilemap).toEqual(fresh(h.project));
    });

    it("builds again when a cell painted during a build names a tileset the result lacks", async () => {
        const h = await harness();
        const count = h.contents.length;
        h.auto = false;
        h.history.execute(opacity(h.project, 99));
        h.start();
        h.history.execute(paint(h.project, 1, 1, cellValue(4, 0, 0)));
        h.gates.shift()!();
        await settle();
        // The result cannot take the cell: it is not drawn, and the tilemap is built again.
        expect(h.contents).toHaveLength(count);
        expect(h.builds).toHaveLength(3);
        h.gates.shift()!();
        await settle();
        expect(h.contents).toHaveLength(count + 1);
        const after = h.contents.at(-1)!;
        expect(after.tilemap.tilesets.map((tileset) => tileset.name)).toContain("offset");
        expect(after.tilemap).toEqual(fresh(h.project));
        expect(h.errors).toEqual([]);
    });

    it("keeps the tilemap when a build changes nothing of it but cells", async () => {
        const h = await harness();
        const before = h.contents.at(-1)!;
        const map = mapOf(h.project);
        // A step that names no cells, as a selection's: nothing of the tilemap changed.
        h.source.touched(touchedNothing(map.id));
        expect(h.pending.at(-1)).toBe("hold");
        await h.flush();
        expect(h.builds).toHaveLength(2);
        const same = h.contents.at(-1)!;
        expect(same.tilemap).toBe(before.tilemap);
        expect(same.texturesKey).toBe(before.texturesKey);
        expect(same.tilemap).toEqual(fresh(h.project));
        expect(h.pending.at(-1)).toBeNull();
        // Cells nobody described: the build reads them and they are written into the tilemap.
        groundOf(h.project).cells.set(3, 2, cellValue(1, 3, 5));
        h.source.touched(touchedNothing(map.id));
        await h.flush();
        expect(h.builds).toHaveLength(3);
        expect(h.contents.at(-1)!.tilemap).toBe(before.tilemap);
        expect(before.tilemap).toEqual(fresh(h.project));
        // Later cells are written in place, into the same tilemap.
        h.history.execute(paint(h.project, 0, 0, cellValue(1, 2, 0)));
        expect(h.cells).toBe(1);
        expect(before.tilemap).toEqual(fresh(h.project));
    });

    it("reads a new tilemap when a tileset of an unchanged map is packed again", async () => {
        const h = await harness();
        const before = h.contents.at(-1)!;
        const even = h.project.tilesets.find((tileset) => tileset.exportName === "even")!;
        // The tilemap's text is the same; its atlas, and so what it draws with, is not.
        h.source.touched({ ...touchedNothing(), tilesetIds: [even.id] });
        await h.flush();
        const after = h.contents.at(-1)!;
        expect(after.tilemap).not.toBe(before.tilemap);
        expect(after.tilemap).toEqual(fresh(h.project));
        expect(after.texturesKey).not.toBe(before.texturesKey);
    });

    it("reports a build that fails and draws nothing", async () => {
        const project = createConformanceProject();
        const contents: (PreviewContent | null)[] = [];
        const pending: (string | null)[] = [];
        const errors: string[] = [];
        let fail = false;
        const source = new PreviewSource({
            pack: async (tileset) => packTileset(tileset),
            build: async (from, map, atlases) => {
                if (fail) throw new Error("The worker stopped.");
                return tilemapParts(from, map, atlases);
            },
            onContent: (content) => contents.push(content),
            onCells: () => undefined,
            onPending: (state) => pending.push(state),
            onError: (message) => errors.push(message),
        });
        source.show(project, mapOf(project).id);
        await settle();
        expect(contents.at(-1)).not.toBeNull();
        fail = true;
        source.show(project, otherOf(project).id);
        await settle();
        expect(errors).toEqual(["The worker stopped."]);
        expect(contents.at(-1)).toBeNull();
        expect(pending.at(-1)).toBeNull();
    });
});

describe("the parts of a tilemap (SPEC §12)", () => {
    it("make the tilemap `readTilemap` returns for the map's text", () => {
        const project = createConformanceProject();
        const atlases = atlasesOf(project);
        for (const map of project.maps) {
            const parts = tilemapParts(project, map, atlases);
            const expected = fresh(project, map.exportName);
            const tileLayers = expected.layers.filter((layer) => layer.type === "tile");
            expect(parts.cells).toHaveLength(tileLayers.length);
            // The cells travel as typed arrays alone.
            const json = JSON.parse(parts.text) as { layers: { type: string; data?: unknown }[] };
            for (const layer of json.layers) {
                if (layer.type === "tile") expect(layer.data).toEqual([]);
            }
            const tilemap = tilemapFromParts(parts, atlases);
            expect(tilemap).toEqual(expected);
            // New arrays: the parts stay as they were.
            const first = tilemap.layers.find((layer) => layer.type === "tile");
            if (first?.type === "tile") expect(first.data).not.toBe(parts.cells[0]);
        }
    });

    it("list the animated tiles and those the visible layers place", () => {
        const project = createConformanceProject();
        const even = project.tilesets.find((tileset) => tileset.exportName === "even")!;
        even.tiles[0]!.animation = [
            { tile: 0, ms: 100 },
            { tile: 1, ms: 250 },
        ];
        const map = mapOf(project);
        const parts = tilemapParts(project, map, atlasesOf(project));
        const firstGid = fresh(project).tilesets.find((each) => each.name === "even")!.firstGid;
        expect(parts.animated).toEqual([[firstGid + even.tiles[0]!.id, [100, 250]]]);
        expect(parts.placed).toEqual([firstGid + even.tiles[0]!.id]);
    });

    it("are the same from the one map and no pixels the worker is sent", () => {
        const project = createConformanceProject();
        const map = mapOf(project);
        const wire = previewWire(project, map);
        expect(wire.maps.map((each) => each.id)).toEqual([map.id]);
        for (const [index, tileset] of wire.tilesets.entries()) {
            expect(tileset.pixels.data).toHaveLength(0);
            expect(tileset.pixels.width).toBe(project.tilesets[index]!.pixels.width);
        }
        for (const image of wire.images) expect(image.pixels.data).toHaveLength(0);
        expect(project.tilesets[0]!.pixels.data.length).toBeGreaterThan(0);
        const sent = projectFromWire(structuredClone(wire));
        const atlases = atlasesOf(project);
        expect(tilemapParts(sent, sent.maps[0]!, atlases)).toEqual(
            tilemapParts(project, map, atlases),
        );
    });
});

describe("frames on demand, held (SPEC §12)", () => {
    /** A clock whose animation frames the test runs. */
    class TestClock implements FrameClock {
        time = 1000;
        frames = new Map<number, FrameRequestCallback>();
        #next = 1;
        requestAnimationFrame(callback: FrameRequestCallback): number {
            const id = this.#next++;
            this.frames.set(id, callback);
            return id;
        }
        cancelAnimationFrame(id: number): void {
            this.frames.delete(id);
        }
        setTimeout(): ReturnType<typeof setTimeout> {
            throw new Error("no timer is expected");
        }
        clearTimeout(): void {}
        now(): number {
            return this.time;
        }
        advance(ms: number): void {
            this.time += ms;
            const frames = [...this.frames];
            this.frames.clear();
            for (const [, callback] of frames) callback(this.time);
        }
    }

    it("runs no frame while held, and the frame asked for once released", () => {
        const clock = new TestClock();
        const scheduler = new DemandScheduler(() => Infinity, clock);
        const run: number[] = [];
        const ask = () => scheduler.request((time) => run.push(time));
        ask();
        clock.advance(16);
        expect(run).toHaveLength(1);
        ask();
        scheduler.hold(true);
        scheduler.wake();
        clock.advance(16);
        clock.advance(16);
        expect(run).toHaveLength(1);
        expect(clock.frames.size).toBe(0);
        scheduler.hold(false);
        clock.advance(16);
        expect(run).toHaveLength(2);
        // Held with a frame already asked of the browser: it is taken back.
        ask();
        scheduler.wake();
        scheduler.hold(true);
        clock.advance(16);
        expect(run).toHaveLength(2);
        // The change it was woken for is drawn once it is released.
        scheduler.hold(false);
        clock.advance(16);
        expect(run).toHaveLength(3);
    });
});
