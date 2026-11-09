import { CHUNK_BITS, CELL_INDEX_MASK, assignFirstGids, cellSlot, cellsToGids } from "../cells";
import type { GidTable } from "../cells";
import { GENERATOR } from "../generator";
import { effectiveValues, walkLayers } from "../model";
import type {
    EffectiveLayerValues,
    GroupLayer,
    Layer,
    Marker,
    Project,
    ProjectMap,
    Tile,
    Tileset,
} from "../model";
import { CellRows, colourText, encodeJson } from "../project/json";
import { propertiesJson, shapeJson } from "../project/values";
import { TILEMAP_FORMAT, TILEMAP_VERSION } from "../runtime/runtime";

// The writer of `ngne-tilemap` version 1 (FORMAT §3.7): one map as the JSON text a game loads.
// Members in the order of the tables; groups parents first; layers flattened in draw order
// with their effective values (§3.4); tilesets and cells as in the project file (§1.2).

/** Slots of the tilesets the cells of `map` use, inside the map. */
function usedSlots(map: ProjectMap): Set<number> {
    const slots = new Set<number>();
    const rect = { x: 0, y: 0, width: map.width, height: map.height };
    for (const { layer } of walkLayers(map.layers)) {
        if (layer.type !== "tile") continue;
        for (const chunk of layer.cells.chunksIn(rect)) {
            const ox = chunk.cx << CHUNK_BITS;
            const oy = chunk.cy << CHUNK_BITS;
            for (let index = 0; index < chunk.cells.length; index += 1) {
                const value = chunk.cells[index]!;
                if (value === 0) continue;
                const x = ox + (index & CELL_INDEX_MASK);
                const y = oy + (index >> CHUNK_BITS);
                if (x < map.width && y < map.height) slots.add(cellSlot(value));
            }
        }
    }
    return slots;
}

/** A tile with a class, properties or collision: the tiles a tilemap lists (FORMAT §3.3). */
function hasData(tile: Tile): boolean {
    return tile.class !== "" || tile.collision.length > 0 || tile.properties.length > 0;
}

function tilesetJson(tileset: Tileset, firstGid: number): unknown {
    return {
        name: tileset.exportName,
        atlas: `${tileset.exportName}.atlas.json`,
        class: tileset.class,
        firstGid,
        nextTileId: tileset.nextTileId,
        tileWidth: tileset.tileWidth,
        tileHeight: tileset.tileHeight,
        offsetX: tileset.offsetX,
        offsetY: tileset.offsetY,
        tiles: tileset.tiles
            .filter(hasData)
            .sort((a, b) => a.id - b.id)
            .map((tile) => ({
                id: tile.id,
                class: tile.class,
                collision: tile.collision.map(shapeJson),
                properties: propertiesJson(tile.properties),
            })),
        properties: propertiesJson(tileset.properties),
    };
}

/** A marker: its shape kind first, then the marker members, as FORMAT §3.10 writes it. */
function markerJson(marker: Marker): unknown {
    const { shape, ...geometry } = shapeJson(marker);
    return {
        shape,
        id: marker.id,
        name: marker.name,
        class: marker.class,
        ...geometry,
        properties: propertiesJson(marker.properties),
    };
}

type LeafLayer = Exclude<Layer, GroupLayer>;

/** A tile, marker or image layer with its effective values (FORMAT §3.4). */
function layerJson(
    project: Project,
    map: ProjectMap,
    table: GidTable,
    layer: LeafLayer,
    groupId: number | null,
    values: EffectiveLayerValues,
): unknown {
    const base = {
        id: layer.id,
        type: layer.type,
        name: layer.name,
        class: layer.class,
        groupId,
        visible: values.visible,
        opacity: Math.round(values.opacity),
        offsetX: values.offsetX,
        offsetY: values.offsetY,
        parallaxX: values.parallaxX,
        parallaxY: values.parallaxY,
        properties: propertiesJson(layer.properties),
    };
    switch (layer.type) {
        case "tile": {
            const data = cellsToGids(layer.cells, map.width, map.height, table);
            return { ...base, data: new CellRows(data, map.width) };
        }
        case "marker":
            return { ...base, markers: layer.markers.map(markerJson) };
        case "image": {
            const image = project.images.find(({ id }) => id === layer.imageId);
            if (image === undefined) {
                throw new Error(
                    `Layer ${layer.id} names the image ${layer.imageId}, which is missing.`,
                );
            }
            return {
                ...base,
                image: `${image.exportName}.png`,
                imageWidth: image.pixels.width,
                imageHeight: image.pixels.height,
                repeatX: layer.repeatX,
                repeatY: layer.repeatY,
            };
        }
    }
}

/** The ASCII form of a JSON text: every other character as a `\uXXXX` escape. */
function ascii(text: string): string {
    // Characters above U+007F stand only inside strings, where an escape means the same.
    return text.replace(
        /[\u0080-￿]/g,
        (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
}

/**
 * The `<exportName>.tilemap.json` text of one map of `project` (FORMAT §3): the tilesets its
 * cells use in project order with `firstGid` from 1 (§1.2), its groups parents first, its tile,
 * marker and image layers flattened bottom to top with the effective values of §3.4, property
 * lists sorted by name. Laid out as §3.7 says: four-space indent, each `data` one map row per
 * line, ASCII, a line feed at the end. The same project gives the same text.
 *
 * `generator` is written as is; it defaults to this editor's name and version.
 *
 * Throws `CellConversionError` when a cell has no GID (the project breaks its invariants).
 */
export function tilemapFor(project: Project, map: ProjectMap, generator = GENERATOR): string {
    const slots = usedSlots(map);
    const listed = project.tilesets.filter((tileset) => slots.has(tileset.slot));
    const table = assignFirstGids(listed);

    const groups: unknown[] = [];
    const layers: unknown[] = [];
    for (const { layer, ancestors } of walkLayers(map.layers)) {
        const parent = ancestors.at(-1);
        const groupId = parent === undefined ? null : parent.id;
        if (layer.type === "group") {
            groups.push({
                id: layer.id,
                name: layer.name,
                class: layer.class,
                parentId: groupId,
                properties: propertiesJson(layer.properties),
            });
            continue;
        }
        layers.push(
            layerJson(project, map, table, layer, groupId, effectiveValues(layer, ancestors)),
        );
    }

    const value = {
        format: TILEMAP_FORMAT,
        version: TILEMAP_VERSION,
        generator,
        project: project.exportName,
        name: map.exportName,
        title: map.name,
        class: map.class,
        orientation: map.orientation,
        width: map.width,
        height: map.height,
        tileWidth: map.tileWidth,
        tileHeight: map.tileHeight,
        backgroundColor: map.backgroundColor === null ? null : colourText(map.backgroundColor),
        parallaxOriginX: map.parallaxOriginX,
        parallaxOriginY: map.parallaxOriginY,
        tilesets: table.entries.map(({ slot, firstGid }) =>
            tilesetJson(
                listed.find((tileset) => tileset.slot === slot)!,
                firstGid,
            ),
        ),
        groups,
        layers,
        properties: propertiesJson(map.properties),
    };
    return ascii(new TextDecoder().decode(encodeJson(value)));
}
