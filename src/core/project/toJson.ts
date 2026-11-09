import {
    CHUNK_BITS,
    CELL_INDEX_MASK,
    CellConversionError,
    assignFirstGids,
    cellSlot,
    cellsToGids,
} from "../cells";
import type { Layer, Marker, Project, ProjectImage, ProjectMap, Tile, Tileset } from "../model";
import { ProjectError, quoted } from "./errors";
import { mapEntry } from "./format";
import { CellRows, colourText } from "./json";
import { propertiesJson, shapeJson } from "./values";

// The JSON values of the writer (FORMAT §2.4, §2.5): members in the order of the tables, every
// property list sorted by name, colours in lowercase, cells as GIDs of the map's own table.

function tileJson(tile: Tile): unknown {
    return {
        id: tile.id,
        source: tile.sourceKey === null ? null : structuredClone(tile.sourceKey),
        fingerprint: tile.fingerprint,
        class: tile.class,
        collision: tile.collision.map(shapeJson),
        animation: tile.animation.map(({ tile: frameTile, ms }) => ({ tile: frameTile, ms })),
        properties: propertiesJson(tile.properties),
    };
}

function tilesetJson(tileset: Tileset): unknown {
    const { source } = tileset;
    return {
        id: tileset.id,
        name: tileset.name,
        exportName: tileset.exportName,
        class: tileset.class,
        tileWidth: tileset.tileWidth,
        tileHeight: tileset.tileHeight,
        columns: tileset.columns,
        offsetX: tileset.offsetX,
        offsetY: tileset.offsetY,
        nextTileId: tileset.nextTileId,
        source: {
            kind: source.kind,
            fileName: source.fileName,
            margin: source.margin,
            spacing: source.spacing,
        },
        tiles: tileset.tiles.map(tileJson),
        terrainSets: tileset.terrainSets.map((set) => ({
            name: set.name,
            type: set.type,
            colors: set.colors.map((colour) => ({
                name: colour.name,
                color: colour.color.toLowerCase(),
                tile: colour.tile,
            })),
            tiles: set.tiles.map(({ tile, wangId }) => ({ tile, wangId: [...wangId] })),
        })),
        properties: propertiesJson(tileset.properties),
    };
}

function imageJson(image: ProjectImage): unknown {
    return {
        id: image.id,
        name: image.name,
        exportName: image.exportName,
        width: image.pixels.width,
        height: image.pixels.height,
    };
}

/** `project.json` of a project. */
export function projectJson(project: Project): unknown {
    return {
        id: project.id,
        name: project.name,
        exportName: project.exportName,
        maps: project.maps.map(({ id }) => ({ id })),
        tilesets: project.tilesets.map(tilesetJson),
        images: project.images.map(imageJson),
        exportSettings: { exportOnSave: project.exportSettings.exportOnSave },
        properties: propertiesJson(project.properties),
    };
}

function markerJson(marker: Marker): unknown {
    return {
        id: marker.id,
        name: marker.name,
        class: marker.class,
        ...shapeJson(marker),
        properties: propertiesJson(marker.properties),
    };
}

/** Slots of the tilesets the cells of `map` use, inside the map. */
function usedSlots(map: ProjectMap): Set<number> {
    const slots = new Set<number>();
    const rect = { x: 0, y: 0, width: map.width, height: map.height };
    const visit = (layers: readonly Layer[]) => {
        for (const layer of layers) {
            if (layer.type === "group") visit(layer.layers);
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
    };
    visit(map.layers);
    return slots;
}

/**
 * `maps/<mapId>.json` of a map. Its `tilesets` are exactly those its cells use, in the order of
 * the project's tilesets, from `firstGid` 1, each span starting where the previous ends (FORMAT
 * §1.2). Throws `ProjectError` "invalid-map" when a cell has no GID in that table or lies
 * outside the map.
 */
export function mapJson(project: Project, map: ProjectMap): unknown {
    const entry = mapEntry(map.id);
    const slots = usedSlots(map);
    const listed = project.tilesets.filter((tileset) => slots.has(tileset.slot));
    let table;
    try {
        table = assignFirstGids(listed);
    } catch (cause) {
        if (!(cause instanceof CellConversionError)) throw cause;
        throw new ProjectError("invalid-map", `${entry}: ${cause.message}`, { entry, cause });
    }
    const layerJson = (layer: Layer): unknown => {
        const base = {
            id: layer.id,
            type: layer.type,
            name: layer.name,
            class: layer.class,
            visible: layer.visible,
            locked: layer.locked,
            opacity: layer.opacity,
            offsetX: layer.offsetX,
            offsetY: layer.offsetY,
            parallaxX: layer.parallaxX,
            parallaxY: layer.parallaxY,
            properties: propertiesJson(layer.properties),
        };
        switch (layer.type) {
            case "tile": {
                let data: Uint32Array;
                try {
                    data = cellsToGids(layer.cells, map.width, map.height, table);
                } catch (cause) {
                    if (!(cause instanceof CellConversionError)) throw cause;
                    throw new ProjectError(
                        "invalid-map",
                        `${entry}: layer ${layer.id} (${quoted(layer.name)}): ${cause.message}`,
                        { entry, cause },
                    );
                }
                return { ...base, data: new CellRows(data, map.width) };
            }
            case "marker":
                return {
                    ...base,
                    color: colourText(layer.color),
                    markers: layer.markers.map(markerJson),
                };
            case "image":
                return {
                    ...base,
                    image: layer.imageId,
                    repeatX: layer.repeatX,
                    repeatY: layer.repeatY,
                };
            case "group":
                return { ...base, layers: layer.layers.map(layerJson) };
        }
    };
    return {
        id: map.id,
        name: map.name,
        exportName: map.exportName,
        class: map.class,
        orientation: map.orientation,
        width: map.width,
        height: map.height,
        tileWidth: map.tileWidth,
        tileHeight: map.tileHeight,
        backgroundColor: map.backgroundColor === null ? null : colourText(map.backgroundColor),
        parallaxOriginX: map.parallaxOriginX,
        parallaxOriginY: map.parallaxOriginY,
        nextLayerId: map.nextLayerId,
        nextMarkerId: map.nextMarkerId,
        tilesets: table.entries.map(({ slot, firstGid }) => ({
            tileset: listed.find((tileset) => tileset.slot === slot)!.id,
            firstGid,
        })),
        layers: map.layers.map(layerJson),
        properties: propertiesJson(map.properties),
    };
}
