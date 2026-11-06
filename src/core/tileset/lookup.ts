import type { Project, Tileset } from "../model";
import { TilesetEditError } from "./errors";

/** The tileset of `project` with ID `id`; throws `TilesetEditError` ("not-found") without one. */
export function tilesetOf(project: Project, id: string): Tileset {
    const tileset = project.tilesets.find((each) => each.id === id);
    if (!tileset) throw new TilesetEditError("not-found", `No tileset has the ID ${id}.`);
    return tileset;
}
