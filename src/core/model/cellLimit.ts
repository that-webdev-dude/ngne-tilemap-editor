import { walkLayers } from "./layers";
import { MAX_CELLS_PER_MAP } from "./limits";
import type { Project, ProjectMap } from "./types";

// The cells-per-map limit of FORMAT §2.8: all tile layers of a map together hold at most
// 4 194 304 non-empty cells. The history checks it after every step (SPEC §3), so a stroke or
// a command that would pass it is refused with the project unchanged.

/** Thrown by `assertCellsWithin`. */
export class CellLimitError extends Error {
    override readonly name = "CellLimitError";
    /** ID of the map past the limit. */
    readonly mapId: string;
    /** Non-empty cells of its tile layers. */
    readonly cells: number;

    constructor(map: ProjectMap, cells: number) {
        super(
            `A map's tile layers hold at most ${MAX_CELLS_PER_MAP.toLocaleString("en")} cells; ` +
                `“${map.name}” would hold ${cells.toLocaleString("en")}.`,
        );
        this.mapId = map.id;
        this.cells = cells;
    }
}

/** Non-empty cells of every tile layer of `map`. */
export function mapCellCount(map: ProjectMap): number {
    let cells = 0;
    for (const { layer } of walkLayers(map.layers)) {
        if (layer.type === "tile") cells += layer.cells.count;
    }
    return cells;
}

/** Throws `CellLimitError` for the first map of `project` past the limit. */
export function assertCellsWithin(project: Project): void {
    for (const map of project.maps) {
        const cells = mapCellCount(map);
        if (cells > MAX_CELLS_PER_MAP) throw new CellLimitError(map, cells);
    }
}
