import type { CellRect } from "../../core/cells";
import { walkLayers } from "../../core/model";
import type { Project, ProjectMap, ProjectSession, Tileset } from "../../core/model";

// Which tilesets the open maps use (ENGINE §3): a tileset's texture exists while some open map
// has a cell of it. A map is scanned once when it first shows, and the cells a command touched
// are added after that; the set shrinks when the map closes, not when a cell is erased.

/** The maps the viewport keeps textures for. Until map tabs exist (TE-031) that is the active map. */
export function openMapIds(session: ProjectSession): string[] {
    return session.activeMapId === "" ? [] : [session.activeMapId];
}

function addSlot(slots: Set<number>, value: number): void {
    if (value !== 0) slots.add((value >>> 20) & 255);
}

/** Tileset slots named by the cells of the map's tile layers, in `rects` or everywhere. */
export function slotsInMap(map: ProjectMap, rects?: readonly CellRect[]): Set<number> {
    const slots = new Set<number>();
    const everywhere: CellRect[] = [{ x: 0, y: 0, width: map.width, height: map.height }];
    for (const { layer } of walkLayers(map.layers)) {
        if (layer.type !== "tile") continue;
        if (rects === undefined) {
            for (const chunk of layer.cells.chunksIn(everywhere[0]!)) {
                for (const value of chunk.cells) addSlot(slots, value);
            }
            continue;
        }
        for (const rect of rects) {
            const x1 = Math.min(rect.x + rect.width, map.width);
            const y1 = Math.min(rect.y + rect.height, map.height);
            for (let y = Math.max(rect.y, 0); y < y1; y += 1) {
                for (let x = Math.max(rect.x, 0); x < x1; x += 1) {
                    addSlot(slots, layer.cells.get(x, y));
                }
            }
        }
    }
    return slots;
}

export class TilesetUsage {
    readonly #slots = new Map<string, Set<number>>();

    /** Forgets everything: another project, or a change nobody described. */
    reset(): void {
        this.#slots.clear();
    }

    /** Forgets one map, to be scanned again: its layers or size changed. */
    forget(mapId: string): void {
        this.#slots.delete(mapId);
    }

    /** Adds the slots of the cells in `rects` of a map that is already known. */
    noteCells(map: ProjectMap, rects: readonly CellRect[]): void {
        const known = this.#slots.get(map.id);
        if (known) for (const slot of slotsInMap(map, rects)) known.add(slot);
    }

    /** The project's tilesets that the maps `mapIds` have cells of, in list order. */
    tilesetsOf(project: Project, mapIds: readonly string[]): Tileset[] {
        const used = new Set<number>();
        for (const id of mapIds) {
            const map = project.maps.find((each) => each.id === id);
            if (!map) continue;
            let slots = this.#slots.get(id);
            if (!slots) {
                slots = slotsInMap(map);
                this.#slots.set(id, slots);
            }
            for (const slot of slots) used.add(slot);
        }
        return project.tilesets.filter((tileset) => used.has(tileset.slot));
    }
}
