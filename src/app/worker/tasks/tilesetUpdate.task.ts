import { PngError } from "../../../core/codec";
import { createProject } from "../../../core/model";
import type { Tile, Tileset } from "../../../core/model";
import {
    TilesetImportError,
    TilesetUpdateError,
    matchTiles,
    readUpdateSource,
} from "../../../core/tileset";
import type { SourceTiles, UpdateMatch, UpdateSourceFiles } from "../../../core/tileset";
import { buffersOf, defineTask } from "../task";

// Update tileset from source (SPEC §6.3; TE-028) off the main thread: the source re-read with
// the tileset's recorded parameters (decoding, compositing, slicing, fingerprints) and its
// entries matched to the tiles. The page sends the tileset without its pixels or maps; the
// source is read against a project of that tileset alone, so its limits hold for the tileset,
// and the apply on the page checks the project again (`updateFromSourceCommand`).

/** What the worker needs of the tileset: its recorded parameters and its tiles' keys. */
export interface UpdateTilesetInput {
    tileset: Pick<Tileset, "id" | "name" | "tileWidth" | "tileHeight" | "source"> & {
        tiles: Pick<Tile, "id" | "sourceKey" | "fingerprint">[];
    };
    files: UpdateSourceFiles;
}

export interface UpdateTilesetOutput {
    source: SourceTiles;
    match: UpdateMatch;
}

declare module "../protocol" {
    interface WorkerTaskTypes {
        /** The source re-read and matched; the entries' pixels are transferred. */
        "tileset.updateSource": TaskType<
            UpdateTilesetInput,
            UpdateTilesetOutput,
            TilesetUpdateError | TilesetImportError | PngError
        >;
    }
}

async function runUpdate({ tileset, files }: UpdateTilesetInput): Promise<UpdateTilesetOutput> {
    const project = createProject();
    const { id, name, tileWidth, tileHeight, source } = tileset;
    project.tilesets.push({
        id,
        name,
        exportName: "",
        class: "",
        slot: 1,
        tileWidth,
        tileHeight,
        offsetX: 0,
        offsetY: 0,
        columns: 1,
        pixels: { width: 0, height: 0, data: new Uint8ClampedArray(0) },
        nextTileId: 0,
        source,
        tiles: [],
        terrainSets: [],
        properties: [],
    });
    const read = await readUpdateSource(project, id, files);
    return { source: read, match: matchTiles(tileset.tiles, read.entries) };
}

export const tasks = [
    defineTask("tileset.updateSource", {
        run: runUpdate,
        transfer: ({ source }) => buffersOf(...source.entries.map((entry) => entry.pixels)),
        failures: [TilesetUpdateError, TilesetImportError, PngError],
    }),
];
