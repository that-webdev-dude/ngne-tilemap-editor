import { describe, expect, it } from "vitest";
import { PreviewSource, previewTextureId } from "../../src/app/preview/previewSource";
import { cellValue } from "../../src/core/cells";
import { History, cellPatchCommand, touchedNothing } from "../../src/core/history";
import type { Command, Touched } from "../../src/core/history";
import { setLayerValuesCommand } from "../../src/core/layers";
import { setAnimationCommand } from "../../src/core/tileset";
import { createProjectSession } from "../../src/core/model";
import type { Project, TileLayer } from "../../src/core/model";
import { packTileset } from "../../src/core/pack";
import { readTilemap } from "../../src/core/runtime/runtime";
import type { TileLayerData } from "../../src/core/runtime/runtime";
import { tilemapFor } from "../../src/core/tilemap";
import type { PreviewContent } from "../../src/engine/preview";
import { createConformanceProject } from "../support/conformanceProject";

// TE-056: the preview's `Tilemap` (SPEC §12). Built by `tilemapFor` and `readTilemap` with the
// tilesets packed in memory; a command's `touched` writes changed cells into the layer's `data`,
// rebuilds it for any other change of the map, and gives it new textures (a restart of the
// scene) when a tileset changes.

const LAYERS_MAP = "layers";

interface Harness {
    project: Project;
    history: History;
    source: PreviewSource;
    contents: (PreviewContent | null)[];
    cells: number;
    errors: string[];
    packs: string[];
}

/** A source on the conformance project's layers map, with the tilesets packed here. */
async function harness(mapExportName = LAYERS_MAP): Promise<Harness> {
    const project = createConformanceProject();
    const session = createProjectSession(project);
    const history = new History(session);
    const state: Harness = {
        project,
        history,
        source: null as unknown as PreviewSource,
        contents: [],
        cells: 0,
        errors: [],
        packs: [],
    };
    state.source = new PreviewSource({
        pack: async (tileset) => {
            state.packs.push(tileset.exportName);
            return packTileset(tileset);
        },
        onContent: (content) => state.contents.push(content),
        onCells: () => (state.cells += 1),
        onError: (message) => state.errors.push(message),
    });
    history.subscribe(({ touched }) => state.source.touched(touched));
    const map = project.maps.find((each) => each.exportName === mapExportName)!;
    state.source.show(project, map.id);
    await settle();
    return state;
}

/** Lets pending packs resolve and the build that waits for them run. */
async function settle(): Promise<void> {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** The tilemap a game would load from the export of `project`'s map now. */
function fresh(project: Project, mapExportName = LAYERS_MAP) {
    const map = project.maps.find((each) => each.exportName === mapExportName)!;
    const atlases: Record<string, unknown> = {};
    for (const tileset of project.tilesets)
        atlases[tileset.exportName] = packTileset(tileset).atlas;
    return readTilemap(JSON.parse(tilemapFor(project, map)), atlases);
}

function tileData(content: PreviewContent | null | undefined, name: string): Uint32Array {
    const layer = content?.tilemap.layers.find((each) => each.name === name);
    if (layer?.type !== "tile") throw new Error(`no tile layer ${name}`);
    return (layer as TileLayerData).data;
}

const mapOf = (project: Project) => project.maps.find((each) => each.exportName === LAYERS_MAP)!;

function groundOf(project: Project): TileLayer {
    return mapOf(project).layers.find((layer) => layer.name === "Ground") as TileLayer;
}

/** A stroke's patch of cells of Ground: `(x, y, value)` triplets. */
function paint(project: Project, cells: [number, number, number][]): Command {
    const map = mapOf(project);
    const ground = groundOf(project);
    const words = new Uint32Array(cells.length * 3);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    cells.forEach(([x, y, value], i) => {
        words[i * 3] = y * map.width + x;
        words[i * 3 + 1] = ground.cells.get(x, y);
        words[i * 3 + 2] = value;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x + 1);
        y1 = Math.max(y1, y + 1);
    });
    return cellPatchCommand({
        label: "Stamp Brush",
        mapId: map.id,
        layerId: ground.id,
        width: map.width,
        words,
        cellRect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
    });
}

describe("the preview's tilemap (SPEC §12)", () => {
    it("is the export's tilemap of the current map, read with in-memory atlases", async () => {
        const { project, contents, errors } = await harness();
        expect(errors).toEqual([]);
        const content = contents.at(-1)!;
        const expected = fresh(project);
        expect(content.tilemap.layers.map((layer) => layer.name)).toEqual(
            expected.layers.map((layer) => layer.name),
        );
        expect([...tileData(content, "Ground")]).toEqual([
            ...(expected.layers.find((l) => l.name === "Ground") as TileLayerData).data,
        ]);
        // One texture per tileset the map uses and one per image, under `drawTilemap`'s IDs.
        expect(content.textures.map((texture) => texture.id)).toEqual([
            ...expected.tilesets.map((tileset) => previewTextureId(project, tileset.name)),
            previewTextureId(project, "sky"),
        ]);
        const packed = packTileset(project.tilesets[0]!).image;
        expect(content.textures[0]!.pixels.data).toEqual(packed.data);
        // The image as the export writes it: sides rounded up to even.
        const sky = content.textures.at(-1)!.pixels;
        expect([sky.width, sky.height]).toEqual([42, 22]);
    });

    it("writes a command's cells into the layer's data, in place, and invalidates it", async () => {
        const h = await harness();
        const before = h.contents.at(-1)!;
        const data = tileData(before, "Ground");
        const value = cellValue(1, 3, 5);
        h.history.execute(
            paint(h.project, [
                [0, 0, value],
                [4, 2, cellValue(1, 2, 0)],
                [11, 7, 0],
            ]),
        );
        expect(h.cells).toBe(1);
        // No new tilemap: the same object, its cells rewritten.
        expect(h.contents.at(-1)).toBe(before);
        expect(tileData(before, "Ground")).toBe(data);
        const expected = fresh(h.project);
        expect([...data]).toEqual([
            ...(expected.layers.find((l) => l.name === "Ground") as TileLayerData).data,
        ]);
        // Undo writes the old cells back.
        h.history.undo();
        expect(h.cells).toBe(2);
        expect([...data]).toEqual([
            ...(fresh(h.project).layers.find((l) => l.name === "Ground") as TileLayerData).data,
        ]);
    });

    it("writes the cells a stroke reports before it ends", async () => {
        const h = await harness();
        const ground = groundOf(h.project);
        const map = mapOf(h.project);
        ground.cells.set(2, 3, cellValue(1, 0, 7));
        const touched: Touched = {
            mapId: map.id,
            layerIds: [ground.id],
            cellRects: [{ x: 2, y: 3, width: 1, height: 1 }],
            tilesetIds: [],
            structure: false,
        };
        h.source.touched(touched);
        expect(h.cells).toBe(1);
        expect(tileData(h.contents.at(-1), "Ground")[3 * map.width + 2]).toBe(
            (fresh(h.project).layers.find((l) => l.name === "Ground") as TileLayerData).data[
                3 * map.width + 2
            ],
        );
    });

    it("builds the tilemap again for another change of the map, with the same textures", async () => {
        const h = await harness();
        const before = h.contents.at(-1)!;
        const map = mapOf(h.project);
        const far = map.layers.find((layer) => layer.name === "Far")!;
        h.history.execute(setLayerValuesCommand(h.project, map.id, [far.id], { opacity: 99 }));
        const after = h.contents.at(-1)!;
        expect(after).not.toBe(before);
        expect(after.tilemap.layers.find((layer) => layer.name === "Far")!.opacity).toBe(99);
        // Same textures: the scene keeps running with the new tilemap.
        expect(after.texturesKey).toBe(before.texturesKey);
        expect(h.cells).toBe(0);
    });

    it("builds it again when a painted cell's tileset is not in the tilemap yet", async () => {
        const h = await harness();
        const before = h.contents.at(-1)!;
        expect(before.tilemap.tilesets.map((tileset) => tileset.name)).not.toContain("offset");
        h.history.execute(paint(h.project, [[1, 1, cellValue(4, 0, 0)]]));
        await settle();
        const after = h.contents.at(-1)!;
        expect(after).not.toBe(before);
        expect(after.tilemap.tilesets.map((tileset) => tileset.name)).toContain("offset");
        // A texture more: the scene restarts.
        expect(after.texturesKey).not.toBe(before.texturesKey);
        expect(h.errors).toEqual([]);
    });

    it("packs a changed tileset again under a new textures key", async () => {
        const h = await harness();
        const before = h.contents.at(-1)!;
        const even = h.project.tilesets.find((tileset) => tileset.exportName === "even")!;
        const original = even.pixels;
        const changed = {
            ...original,
            data: original.data.map((v, i) => (i % 4 === 0 ? 255 - v : v)),
        };
        const recolour: Command = {
            label: "Recolour",
            bytes: 0,
            touched: { ...touchedNothing(), tilesetIds: [even.id] },
            do: (session) => {
                session.project.tilesets.find((t) => t.id === even.id)!.pixels = changed;
            },
            undo: (session) => {
                session.project.tilesets.find((t) => t.id === even.id)!.pixels = original;
            },
        };
        const packsBefore = h.packs.length;
        h.history.execute(recolour);
        await settle();
        const after = h.contents.at(-1)!;
        expect(h.packs.slice(packsBefore)).toEqual(["even"]);
        expect(after.texturesKey).not.toBe(before.texturesKey);
        const texture = after.textures.find((t) => t.id === previewTextureId(h.project, "even"))!;
        expect(texture.pixels.data).toEqual(packTileset(even).image.data);
        expect(texture.pixels.data).not.toEqual(
            before.textures.find((t) => t.id === texture.id)!.pixels.data,
        );
    });

    it("ignores the cells of another map and follows the map shown", async () => {
        const h = await harness();
        const other = h.project.maps.find((map) => map.exportName !== LAYERS_MAP)!;
        const count = h.contents.length;
        const layer = other.layers[0] as TileLayer;
        h.source.touched({
            mapId: other.id,
            layerIds: [layer.id],
            cellRects: [{ x: 0, y: 0, width: 1, height: 1 }],
            tilesetIds: [],
            structure: false,
        });
        expect(h.contents.length).toBe(count);
        expect(h.cells).toBe(0);
        h.source.show(h.project, other.id);
        await settle();
        expect(h.contents.at(-1)!.tilemap.name).toBe(other.exportName);
        h.source.show(null, null);
        expect(h.contents.at(-1)).toBeNull();
    });

    it("lists the frame durations of the animated tiles", async () => {
        const project = createConformanceProject();
        const even = project.tilesets.find((tileset) => tileset.exportName === "even")!;
        even.tiles[0]!.animation = [
            { tile: 0, ms: 100 },
            { tile: 1, ms: 250 },
        ];
        const map = mapOf(project);
        const contents: (PreviewContent | null)[] = [];
        const source = new PreviewSource({
            pack: async (tileset) => packTileset(tileset),
            onContent: (content) => contents.push(content),
            onCells: () => undefined,
            onError: (message) => {
                throw new Error(message);
            },
        });
        source.show(project, map.id);
        await settle();
        expect(contents.at(-1)!.animations).toEqual([[100, 250]]);
    });

    it("packs a tileset again when a tile's animation changes, keeping its textures", async () => {
        const h = await harness();
        const before = h.contents.at(-1)!;
        const even = h.project.tilesets.find((tileset) => tileset.exportName === "even")!;
        const frames = [
            { tile: 0, ms: 120 },
            { tile: 1, ms: 80 },
        ];
        const packsBefore = h.packs.length;
        h.history.execute(setAnimationCommand(even.id, 0, frames, "add"));
        await settle();
        // The atlas, which holds the animations `drawTilemap` plays, is made again.
        expect(h.packs.slice(packsBefore)).toEqual(["even"]);
        const after = h.contents.at(-1)!;
        expect(after).not.toBe(before);
        expect(after.animations).toEqual([[120, 80]]);
        // Same pixels: no restart of the scene.
        expect(after.texturesKey).toBe(before.texturesKey);
    });

    it("tries a pack that failed again only when its tileset changes", async () => {
        const project = createConformanceProject();
        const map = mapOf(project);
        const errors: string[] = [];
        let packs = 0;
        const source = new PreviewSource({
            pack: async () => {
                packs += 1;
                throw new Error("The worker stopped.");
            },
            onContent: () => undefined,
            onCells: () => undefined,
            onError: (message) => errors.push(message),
        });
        source.show(project, map.id);
        await settle();
        await settle();
        const used = packs;
        expect(used).toBeGreaterThan(0);
        expect(used).toBeLessThanOrEqual(project.tilesets.length);
        expect(new Set(errors)).toEqual(new Set(["The worker stopped."]));
        // A change of another kind builds again without packing again.
        source.touched({ ...touchedNothing(map.id), layerIds: [1] });
        await settle();
        expect(packs).toBe(used);
        // A change of the tileset tries it again.
        const even = project.tilesets.find((tileset) => tileset.exportName === "even")!;
        source.touched({ ...touchedNothing(), tilesetIds: [even.id] });
        await settle();
        expect(packs).toBe(used + 1);
    });
});
