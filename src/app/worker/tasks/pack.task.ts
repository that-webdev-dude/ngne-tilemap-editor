import type { Tileset } from "../../../core/model";
import { TilesetPackError, packTileset } from "../../../core/pack";
import type { PackedTileset } from "../../../core/pack";
import { buffersOf, defineTask } from "../task";

// Tileset packing (`core/pack`, SPEC §10.2) off the main thread.

export interface PackTilesetInput {
    tileset: Tileset;
}

declare module "../protocol" {
    interface WorkerTaskTypes {
        /** `packTileset`; the image and the UV table's arrays are transferred. */
        "pack.tileset": TaskType<PackTilesetInput, PackedTileset, TilesetPackError>;
    }
}

export const tasks = [
    defineTask("pack.tileset", {
        run: ({ tileset }) => packTileset(tileset),
        transfer: ({ image, uvTable }) => buffersOf(image.data, uvTable.rects, uvTable.uv),
        failures: [TilesetPackError],
    }),
];
