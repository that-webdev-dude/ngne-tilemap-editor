import type { PixelBuffer, Project, ProjectMap } from "../../core/model";
import { projectToWire, wireBuffers } from "../../core/project";
import type { ProjectWire } from "../../core/project";
import type { TilemapParts } from "../../core/tilemap";
import { backgroundWorker } from "../worker/client";
// The task type, so that `run("preview.tilemap")` is typed outside the worker's own glob.
import type {} from "../worker/tasks/preview.task";

/**
 * Makes the parts of the tilemap of `map` (`tilemapParts`). It reads `project` before it
 * returns: a change made afterwards is not in the parts.
 */
export type BuildTilemapFn = (
    project: Project,
    map: ProjectMap,
    atlases: Readonly<Record<string, unknown>>,
) => Promise<TilemapParts>;

const NO_PIXELS = new Uint8ClampedArray(0);

/** `item` with the size of its pixels and none of them. */
function withoutPixels<Item extends { pixels: PixelBuffer }>(item: Item): Item {
    const { width, height } = item.pixels;
    return { ...item, pixels: { width, height, data: NO_PIXELS } };
}

/**
 * What the build of one map's tilemap reads of `project`, as plain data: that map alone, and
 * the tilesets and images without their pixels (`tilemapFor` reads their sizes). It shares its
 * cells with `project`.
 */
export function previewWire(project: Project, map: ProjectMap): ProjectWire {
    return projectToWire({
        ...project,
        maps: [map],
        tilesets: project.tilesets.map(withoutPixels),
        images: project.images.map(withoutPixels),
    });
}

/**
 * Builds in the background worker. The page only hands the map over: a snapshot of
 * `previewWire` (`structuredClone`), whose buffers are then transferred, as Save hands the
 * project over (`workerProjectCodec`).
 */
export const buildInWorker: BuildTilemapFn = (project, map, atlases) => {
    const snapshot = structuredClone(previewWire(project, map));
    return backgroundWorker.run(
        "preview.tilemap",
        { project: snapshot, mapId: map.id, atlases: { ...atlases } },
        { transfer: wireBuffers(snapshot) },
    );
};
