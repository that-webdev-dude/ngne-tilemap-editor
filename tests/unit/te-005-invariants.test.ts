import { describe, expect, it } from "vitest";
import { CellStore, RESERVED_BIT, cellValue } from "../../src/core/cells";
import {
    INVARIANTS,
    InvariantError,
    MAX_ANIMATION_FRAMES,
    MAX_ANIMATION_FRAMES_PER_TILESET,
    MAX_GROUP_DEPTH,
    MAX_IMAGES,
    MAX_LAYERS,
    MAX_MAPS,
    MAX_MARKERS,
    MAX_PROPERTIES,
    MAX_TERRAIN_SETS,
    MAX_TILESETS,
    assertInvariants,
    createGroupLayer,
    createImageLayer,
    createMap,
    createMarkerLayer,
    createProject,
    createProjectSession,
    createTileLayer,
    sequentialIds,
} from "../../src/core/model";
import type {
    GroupLayer,
    InvariantName,
    Marker,
    MarkerLayer,
    Project,
    ProjectImage,
    TileLayer,
    Tileset,
} from "../../src/core/model";

// Every invariant of SPEC §2.1 (the rules and limits of FORMAT §1 and §2) fails
// `assertInvariants` naming itself; a fresh project and a full one pass.

const FINGERPRINT = "0".repeat(64);

function tileset(id: string, slot: number, exportName: string): Tileset {
    return {
        id,
        name: `Tileset ${slot}`,
        exportName,
        class: "",
        slot,
        tileWidth: 8,
        tileHeight: 8,
        offsetX: 0,
        offsetY: 0,
        columns: 2,
        pixels: { width: 16, height: 8, data: new Uint8ClampedArray(16 * 8 * 4) },
        nextTileId: 2,
        source: { kind: "image", fileName: "tiles.png", margin: 0, spacing: 0 },
        tiles: [
            {
                id: 0,
                sourceKey: [0, 0],
                fingerprint: FINGERPRINT,
                class: "",
                collision: [{ shape: "rectangle", x: 0, y: 0, width: 8, height: 8 }],
                animation: [
                    { tile: 0, ms: 100 },
                    { tile: 1, ms: 100 },
                ],
                properties: [{ name: "solid", type: "bool", value: true }],
            },
            {
                id: 1,
                sourceKey: [1, 0],
                fingerprint: FINGERPRINT,
                class: "water",
                collision: [],
                animation: [],
                properties: [],
            },
        ],
        terrainSets: [
            {
                name: "Ground",
                type: "corner",
                colors: [{ name: "Grass", color: "#00ff00ff", tile: 0 }],
                tiles: [{ tile: 1, wangId: [0, 1, 0, 1, 0, 1, 0, 1] }],
            },
        ],
        properties: [],
    };
}

function image(id: string, exportName: string): ProjectImage {
    return {
        id,
        name: "Backdrop",
        exportName,
        pixels: { width: 2, height: 2, data: new Uint8ClampedArray(16) },
    };
}

function marker(id: number): Marker {
    return {
        shape: "polygon",
        x: 10,
        y: 20,
        points: [
            [0, 0],
            [10, 0],
            [0, 10],
        ],
        id,
        name: "Spawn",
        class: "",
        properties: [],
    };
}

/** A project with every kind of thing: two tilesets, an image, four layer types, a group. */
function fullProject(): Project {
    const project = createProject({ name: "Full", newId: sequentialIds("id-") });
    project.tilesets = [tileset("ts-1", 1, "tiles-1"), tileset("ts-2", 2, "tiles-2")];
    project.images = [image("img-1", "backdrop")];
    const map = project.maps[0]!;
    const tiles = map.layers[0] as TileLayer;
    tiles.cells.set(0, 0, cellValue(1, 0));
    tiles.cells.set(63, 63, cellValue(2, 1, 5));
    const markers = createMarkerLayer(2, "Markers");
    markers.markers.push(marker(1));
    const images = createImageLayer(3, "Backdrop", "img-1");
    const group = createGroupLayer(4, "Group");
    group.layers.push(markers, images);
    map.layers.push(group);
    map.nextLayerId = 5;
    map.nextMarkerId = 2;
    map.properties.push({ name: "level", type: "int", value: 3 });
    return project;
}

const first = (project: Project) => project.maps[0]!;
const tileLayer = (project: Project) => first(project).layers[0] as TileLayer;
const groupLayer = (project: Project) => first(project).layers[1] as GroupLayer;
const markerLayer = (project: Project) => groupLayer(project).layers[0] as MarkerLayer;
const tile0 = (project: Project) => project.tilesets[0]!.tiles[0]!;

/** One way to break each invariant, keyed by its name. */
const BREAKERS: Record<InvariantName, (project: Project) => void> = {
    "project-id": (p) => (p.id = "bad id!"),
    "project-name": (p) => (p.name = "   "),
    "project-export-name": (p) => (p.exportName = "Full"),
    "export-settings": (p) =>
        ((p as { exportSettings: unknown }).exportSettings = { exportOnSave: "yes" }),
    "map-required": (p) => (p.maps = []),
    "tileset-count": (p) =>
        (p.tilesets = Array.from({ length: MAX_TILESETS + 1 }, (_, i) =>
            tileset(`ts-${i}`, i + 1, `tiles-${i}`),
        )),
    "image-count": (p) =>
        (p.images = Array.from({ length: MAX_IMAGES + 1 }, (_, i) => image(`img-${i}`, `i${i}`))),
    "unique-ids": (p) => (p.tilesets[1]!.id = "TS-1"),
    "unique-export-names": (p) => (p.images[0]!.exportName = "tiles-1"),
    "unique-slots": (p) => (p.tilesets[1]!.slot = 1),
    "property-list": (p) => p.properties.push({ name: "x", type: "int", value: 1.5 }),
    "text-length": (p) => (p.tilesets[0]!.class = "c".repeat(256)),
    "tileset-name": (p) => (p.tilesets[0]!.exportName = "ngne-tilemap"),
    "tileset-tile-size": (p) => (p.tilesets[0]!.tileWidth = 257),
    "tileset-columns": (p) => (p.tilesets[0]!.columns = 0),
    "tileset-offset": (p) => (p.tilesets[0]!.offsetY = -4097),
    "tileset-source": (p) => (p.tilesets[0]!.source.margin = 5000),
    "tileset-tile-count": (p) => (p.tilesets[0]!.tiles = []),
    "tileset-pixels": (p) => (p.tilesets[0]!.pixels.width = 8),
    "tile-id": (p) => (p.tilesets[0]!.tiles[1]!.id = 0),
    "next-tile-id": (p) => (p.tilesets[0]!.nextTileId = 1),
    "tile-source-key": (p) => (p.tilesets[0]!.tiles[1]!.sourceKey = [0, 0]),
    "tile-fingerprint": (p) => (tile0(p).fingerprint = "ABC"),
    "tile-collision": (p) => (tile0(p).collision = [{ shape: "point", x: 0, y: 0 }]),
    "tile-animation": (p) => (tile0(p).animation = [{ tile: 7, ms: 100 }]),
    "tileset-animation-count": (p) => {
        const frame = { tile: 0, ms: 1 };
        const perTile = MAX_ANIMATION_FRAMES;
        const tiles = Math.ceil((MAX_ANIMATION_FRAMES_PER_TILESET + 1) / perTile);
        const ts = p.tilesets[0]!;
        ts.tiles = Array.from({ length: tiles }, (_, id) => ({
            ...tile0(p),
            id,
            sourceKey: [id % 2, Math.floor(id / 2)] as [number, number],
            collision: [],
            animation: Array.from({ length: perTile }, () => frame),
        }));
        ts.nextTileId = tiles;
        ts.terrainSets = [];
        const rows = Math.ceil(tiles / ts.columns);
        ts.pixels = {
            width: 16,
            height: rows * 8,
            data: new Uint8ClampedArray(16 * rows * 8 * 4),
        };
    },
    "terrain-set-count": (p) =>
        (p.tilesets[0]!.terrainSets = Array.from(
            { length: MAX_TERRAIN_SETS + 1 },
            () => p.tilesets[0]!.terrainSets[0]!,
        )),
    "terrain-set": (p) => (p.tilesets[0]!.terrainSets[0]!.colors = []),
    "terrain-tile": (p) => (p.tilesets[0]!.terrainSets[0]!.tiles[0]!.wangId[0] = 1),
    "tiles-per-project": (p) => {
        // Four tilesets of 65 536 one-pixel tiles: 262 144 tiles, one more and it fails.
        const big = (id: string, slot: number): Tileset => ({
            ...tileset(id, slot, id),
            tileWidth: 1,
            tileHeight: 1,
            columns: 256,
            pixels: { width: 256, height: 256, data: new Uint8ClampedArray(256 * 256 * 4) },
            nextTileId: 65_536,
            terrainSets: [],
            tiles: Array.from({ length: 65_536 }, (_, i) => ({
                id: i,
                sourceKey: [i % 256, Math.floor(i / 256)] as [number, number],
                fingerprint: FINGERPRINT,
                class: "",
                collision: [],
                animation: [],
                properties: [],
            })),
        });
        p.tilesets = [big("a", 1), big("b", 2), big("c", 3), big("d", 4), tileset("e", 5, "e")];
        tileLayer(p).cells.clear();
    },
    "tileset-pixel-budget": (p) => {
        // One 8192 × 8192 tileset image is the whole 64 MP budget; two exceed it.
        const huge = (id: string, slot: number): Tileset => ({
            ...tileset(id, slot, id),
            tileWidth: 256,
            tileHeight: 256,
            columns: 32,
            pixels: { width: 8192, height: 8192, data: new Uint8ClampedArray(8192 * 8192 * 4) },
            nextTileId: 1024,
            terrainSets: [],
            tiles: Array.from({ length: 1024 }, (_, i) => ({
                id: i,
                sourceKey: [i % 32, Math.floor(i / 32)] as [number, number],
                fingerprint: FINGERPRINT,
                class: "",
                collision: [],
                animation: [],
                properties: [],
            })),
        });
        p.tilesets = [huge("a", 1), huge("b", 2)];
        tileLayer(p).cells.clear();
    },
    "image-name": (p) => (p.images[0]!.name = ""),
    "image-pixels": (p) => (p.images[0]!.pixels.data = new Uint8ClampedArray(15)),
    "image-pixel-budget": (p) => {
        const huge = (id: string): ProjectImage => ({
            ...image(id, id),
            pixels: { width: 8192, height: 8192, data: new Uint8ClampedArray(8192 * 8192 * 4) },
        });
        p.images = [huge("a"), huge("b")];
        groupLayer(p).layers = [markerLayer(p)];
    },
    "map-name": (p) => (first(p).exportName = "Map 1"),
    "map-orientation": (p) => ((first(p) as { orientation: string }).orientation = "isometric"),
    "map-size": (p) => (first(p).width = 4097),
    "map-tile-size": (p) => (first(p).tileHeight = 0),
    "map-background": (p) => (first(p).backgroundColor = 0x1_0000_0000),
    "map-parallax-origin": (p) => (first(p).parallaxOriginX = 2_000_000),
    "map-layer-count": (p) => {
        let group = createGroupLayer(100, "Deep");
        for (let depth = 1; depth < MAX_GROUP_DEPTH + 1; depth += 1) {
            const outer = createGroupLayer(100 + depth, "Deep");
            outer.layers = [group];
            group = outer;
        }
        first(p).layers.push(group);
        first(p).nextLayerId = 200;
    },
    "layer-id": (p) => (markerLayer(p).id = 1),
    "next-layer-id": (p) => (first(p).nextLayerId = 4),
    "layer-values": (p) => (tileLayer(p).opacity = 256),
    "layer-effective-values": (p) => {
        groupLayer(p).offsetX = 1_000_000;
        markerLayer(p).offsetX = 1_000_000;
    },
    "cell-count": (p) => {
        // A 1024 × 1024 map with five full layers: 5 242 880 cells, over the 4 194 304 of a map.
        const map = first(p);
        map.width = 1024;
        map.height = 1024;
        map.layers = [];
        for (let index = 0; index < 5; index += 1) {
            const layer = createTileLayer(index + 1, `L${index}`);
            layer.cells = fullStore(1024, 1024);
            map.layers.push(layer);
        }
        map.nextLayerId = 6;
    },
    "cell-in-map": (p) => tileLayer(p).cells.set(64, 0, cellValue(1, 0)),
    "cell-tile-exists": (p) => tileLayer(p).cells.set(1, 1, cellValue(3, 0)),
    "marker-layer-color": (p) => (markerLayer(p).color = -1),
    "marker-id": (p) => (markerLayer(p).markers[0]!.id = 0),
    "next-marker-id": (p) => (first(p).nextMarkerId = 1),
    "marker-shape": (p) => (markerLayer(p).markers[0]!.x = 2_000_000),
    "marker-count": (p) =>
        (markerLayer(p).markers = Array.from({ length: MAX_MARKERS + 1 }, (_, i) => marker(i + 1))),
    "image-layer-image": (p) => (p.images[0]!.id = "IMG-1"),
};

function fullStore(width: number, height: number): CellStore {
    const store = new CellStore();
    const value = cellValue(1, 0);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) store.set(x, y, value);
    }
    return store;
}

describe("createProject and createMap", () => {
    it("default to 64 × 64 cells of 16 × 16 px with one tile layer", () => {
        const project = createProject({ newId: sequentialIds("p-") });
        expect(project.id).toBe("p-1");
        expect(project.name).toBe("Untitled");
        expect(project.exportName).toBe("untitled");
        expect(project.tilesets).toEqual([]);
        expect(project.images).toEqual([]);
        expect(project.exportSettings).toEqual({ exportOnSave: false });
        const map = project.maps[0]!;
        expect(project.maps).toHaveLength(1);
        expect([map.width, map.height, map.tileWidth, map.tileHeight]).toEqual([64, 64, 16, 16]);
        expect(map.orientation).toBe("orthogonal");
        expect(map.layers).toHaveLength(1);
        const layer = map.layers[0] as TileLayer;
        expect([layer.type, layer.id, layer.name]).toEqual(["tile", 1, "Tile Layer 1"]);
        expect(layer.cells.count).toBe(0);
        expect([layer.visible, layer.locked, layer.opacity]).toEqual([true, false, 255]);
        expect([map.nextLayerId, map.nextMarkerId]).toEqual([2, 1]);
    });

    it("takes a map's size and name, and keeps the export name unique", () => {
        const map = createMap({
            name: "Cave",
            width: 10,
            height: 5,
            tileWidth: 8,
            tileHeight: 32,
            takenExportNames: ["cave"],
            newId: () => "m",
        });
        expect([map.id, map.name, map.exportName]).toEqual(["m", "Cave", "cave-2"]);
        expect([map.width, map.height, map.tileWidth, map.tileHeight]).toEqual([10, 5, 8, 32]);
    });
});

describe("assertInvariants", () => {
    it("passes createProject() and a project of every kind of thing", () => {
        expect(() => assertInvariants(createProject())).not.toThrow();
        expect(() => assertInvariants(fullProject())).not.toThrow();
    });

    it("has a breaking case for every invariant", () => {
        expect(Object.keys(BREAKERS).sort()).toEqual(Object.keys(INVARIANTS).sort());
    });

    it.each(Object.keys(INVARIANTS) as InvariantName[])("names %s when it fails", (name) => {
        const project = fullProject();
        BREAKERS[name](project);
        let error: unknown;
        try {
            assertInvariants(project);
        } catch (thrown) {
            error = thrown;
        }
        expect(error).toBeInstanceOf(InvariantError);
        const invariant = error as InvariantError;
        expect(invariant.invariant).toBe(name);
        expect(invariant.message).toContain(`"${name}"`);
        expect(invariant.message).toContain(INVARIANTS[name]);
    });

    it("rejects a reserved bit, a bad property count and a layer count over 256", () => {
        const reserved = fullProject();
        const store = tileLayer(reserved).cells;
        // The store refuses the reserved bit itself; the invariant is the project's backstop.
        expect(() => store.set(2, 2, (cellValue(1, 0) | RESERVED_BIT) >>> 0)).toThrow(RangeError);

        const properties = fullProject();
        properties.properties = Array.from({ length: MAX_PROPERTIES + 1 }, (_, i) => ({
            name: `p${i}`,
            type: "int" as const,
            value: i,
        }));
        expect(() => assertInvariants(properties)).toThrow(/"property-list"/);

        const layers = fullProject();
        const map = first(layers);
        map.layers = Array.from({ length: MAX_LAYERS + 1 }, (_, i) =>
            createTileLayer(i + 1, `L${i}`),
        );
        map.nextLayerId = MAX_LAYERS + 2;
        expect(() => assertInvariants(layers)).toThrow(/"map-layer-count"/);

        const maps = fullProject();
        maps.maps = Array.from({ length: MAX_MAPS + 1 }, (_, i) =>
            createMap({ name: `M${i}`, newId: () => `m-${i}` }),
        );
        expect(() => assertInvariants(maps)).toThrow(/"map-required"/);
    });

    it("checks a session's project the same way", () => {
        const session = createProjectSession(createProject());
        expect(session.activeMapId).toBe(session.project.maps[0]!.id);
        expect(session.perMap.get(session.activeMapId)?.activeLayerId).toBe(1);
        expect(() => assertInvariants(session.project)).not.toThrow();
    });
});
