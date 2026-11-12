import { projectFromWire } from "../../../core/project";
import type { ProjectWire } from "../../../core/project";
import { tilemapParts } from "../../../core/tilemap";
import type { TilemapParts } from "../../../core/tilemap";
import { buffersOf, defineTask } from "../task";

// The game preview's tilemap (SPEC §12) off the main thread: the text of `tilemapFor`, parsed and
// checked, is far longer than one frame for a large map. The page makes the `Tilemap` of the
// parts it gets back (`tilemapFromParts`).

export interface PreviewTilemapInput {
    /** The project with the map to build; pixels are not read. */
    project: ProjectWire;
    mapId: string;
    /** The parsed atlas of each tileset the map's cells use, by export name. */
    atlases: Record<string, unknown>;
}

declare module "../protocol" {
    interface WorkerTaskTypes {
        /** `tilemapParts`; the cells are transferred. Every error crosses with its message. */
        "preview.tilemap": TaskType<PreviewTilemapInput, TilemapParts, Error>;
    }
}

export const tasks = [
    defineTask("preview.tilemap", {
        run: ({ project: wire, mapId, atlases }) => {
            const project = projectFromWire(wire);
            const map = project.maps.find((each) => each.id === mapId);
            if (!map) throw new Error(`The project has no map ${mapId}.`);
            return tilemapParts(project, map, atlases);
        },
        transfer: ({ cells }) => buffersOf(...cells),
        failures: [Error],
    }),
];
