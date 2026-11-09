import { describe, expect, it } from "vitest";
import { cellOrientation, cellSlot, cellTileId, cellValue } from "../../src/core/cells";
import type { Orientation } from "../../src/core/cells";
import {
    createGroupLayer,
    createMarkerLayer,
    createTileLayer,
    walkLayers,
} from "../../src/core/model";
import type { Marker, Project, Shape } from "../../src/core/model";
import { packTileset } from "../../src/core/pack";
import { tilemapFor, validateTilemap } from "../../src/core/tilemap";
import type { Tilemap } from "../../src/core/tilemap";
import { grassTileset, meadowProject } from "./te-049-support";

// TE-049: `tilemapFor` then `validateTilemap` gives back the project's cells, flags,
// properties, collision and markers. Atlases come from `core/pack`, as the export makes them.

/** The meadow project grown to two tilesets, every orientation, shape and property type. */
function richProject(): Project {
    const project = meadowProject();
    const moss = {
        ...grassTileset(2),
        id: "moss-id",
        exportName: "moss",
        class: "plants",
        offsetX: -2,
        offsetY: 3,
        properties: [
            { name: "z", type: "string" as const, value: "last" },
            { name: "a", type: "bool" as const, value: false },
        ],
    };
    moss.tiles = moss.tiles.map((tile) =>
        tile.id === 1
            ? {
                  ...tile,
                  class: "slope",
                  collision: [
                      { shape: "ellipse", x: 1, y: 2, width: 3, height: 4 },
                      {
                          shape: "polygon",
                          x: 0,
                          y: 16,
                          points: [
                              [0, 0],
                              [16, -16],
                              [16, 0],
                          ],
                      },
                  ] satisfies Shape[],
                  properties: [
                      { name: "i", type: "int", value: -9_007_199_254_740_991 },
                      { name: "c", type: "color", value: "#01020304" },
                      { name: "f", type: "file", value: "a/b.ogg" },
                  ],
              }
            : tile,
    );
    project.tilesets.push(moss);

    const map = project.maps[0]!;
    const flags = createTileLayer(5, "Flags");
    for (let orientation = 0; orientation < 8; orientation += 1) {
        flags.cells.set(
            orientation % 4,
            Math.floor(orientation / 4),
            cellValue(2, orientation % 4, orientation as Orientation),
        );
    }
    flags.cells.set(0, 2, cellValue(1, 3, 7));
    flags.properties = [{ name: "depth", type: "float", value: -0.25 }];
    const shapes: Marker[] = [
        { shape: "point", x: -1.5, y: 2, id: 3, name: "p", class: "", properties: [] },
        {
            shape: "ellipse",
            x: 0,
            y: 0,
            width: 8,
            height: 4,
            id: 4,
            name: "e",
            class: "c",
            properties: [],
        },
        {
            shape: "polyline",
            x: 4,
            y: 4,
            points: [
                [0, 0],
                [10, 2.5],
            ],
            id: 5,
            name: "ü",
            class: "",
            properties: [{ name: "on", type: "bool", value: true }],
        },
        {
            shape: "polygon",
            x: 1,
            y: 1,
            points: [
                [0, 0],
                [4, 0],
                [0, 4],
            ],
            id: 6,
            name: "",
            class: "",
            properties: [],
        },
    ];
    const zones = { ...createMarkerLayer(6, "Zones"), markers: shapes };
    const nested = { ...createGroupLayer(7, "Nested"), layers: [flags, zones] };
    map.layers = [...map.layers, nested];
    map.nextLayerId = 8;
    map.nextMarkerId = 7;
    return project;
}

function roundTrip(project: Project): Tilemap {
    const map = project.maps[0]!;
    const atlases = Object.fromEntries(
        project.tilesets.map((tileset) => [tileset.exportName, packTileset(tileset).atlas]),
    );
    return validateTilemap(JSON.parse(tilemapFor(project, map)), atlases);
}

describe("tilemapFor → validateTilemap", () => {
    it("gives the project's cells and flags", () => {
        const project = richProject();
        const tilemap = roundTrip(project);
        const map = project.maps[0]!;
        const tileLayers = [...walkLayers(map.layers)].filter(({ layer }) => layer.type === "tile");
        const read = tilemap.layers.filter((layer) => layer.type === "tile");
        expect(read.map((layer) => layer.id)).toEqual(tileLayers.map(({ layer }) => layer.id));

        tileLayers.forEach(({ layer }, index) => {
            if (layer.type !== "tile") return;
            const { data } = read[index]!;
            for (let y = 0; y < map.height; y += 1) {
                for (let x = 0; x < map.width; x += 1) {
                    const value = layer.cells.get(x, y);
                    const cell = data[y * map.width + x]!;
                    if (value === 0) {
                        expect(cell).toBe(0);
                        continue;
                    }
                    const gid = cell & 0x0fffffff;
                    const tileset = [...tilemap.tilesets].reverse().find((t) => t.firstGid <= gid)!;
                    const source = project.tilesets.find((t) => t.slot === cellSlot(value))!;
                    expect(tileset.name).toBe(source.exportName);
                    expect(gid - tileset.firstGid).toBe(cellTileId(value));
                    expect(cell >>> 29).toBe(cellOrientation(value));
                }
            }
        });
    });

    it("gives the project's properties, tile classes and collision", () => {
        const project = richProject();
        const tilemap = roundTrip(project);
        const map = project.maps[0]!;
        const byName = <T extends { name: string }>(list: readonly T[]) =>
            [...list].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        expect(tilemap.properties).toEqual(byName(map.properties));
        project.tilesets.forEach((source, index) => {
            const tileset = tilemap.tilesets[index]!;
            expect(tileset.properties).toEqual(byName(source.properties));
            const withData = source.tiles.filter(
                (tile) =>
                    tile.class !== "" || tile.collision.length > 0 || tile.properties.length > 0,
            );
            expect(tileset.tiles).toEqual(
                withData.map((tile) => ({
                    id: tile.id,
                    class: tile.class,
                    collision: tile.collision,
                    properties: byName(tile.properties),
                })),
            );
        });
        const flags = tilemap.layers.find((layer) => layer.id === 5)!;
        expect(flags.properties).toEqual([{ name: "depth", type: "float", value: -0.25 }]);
    });

    it("gives the project's markers, in order, with their shapes", () => {
        const project = richProject();
        const tilemap = roundTrip(project);
        for (const { layer } of walkLayers(project.maps[0]!.layers)) {
            if (layer.type !== "marker") continue;
            const read = tilemap.layers.find((item) => item.id === layer.id)!;
            expect(read.type).toBe("marker");
            if (read.type !== "marker") continue;
            expect(read.markers).toEqual(layer.markers);
        }
    });
});
