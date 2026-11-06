import { CHUNK_SIZE } from "../../core/cells";
import type { CellRect } from "../../core/cells";
import { walkLayers } from "../../core/model";
import type { Project, ProjectMap, ProjectSession, Tileset } from "../../core/model";

// Which tilesets the open maps use (ENGINE §3): a tileset's texture exists while some open map
// has a cell of it. A map is scanned once when it first shows, and the cells a command touched
// are added after that; the set shrinks when the map closes, not when a cell is erased.

/**
 * The maps the viewport keeps textures for: the maps of the open tabs (`open`, TE-031) that the
 * project has, and the active map.
 */
export function openMapIds(session: ProjectSession, open: readonly string[]): string[] {
    const ids = new Set(session.project.maps.map((map) => map.id));
    const kept = open.filter((id) => ids.has(id));
    if (ids.has(session.activeMapId) && !kept.includes(session.activeMapId)) {
        kept.push(session.activeMapId);
    }
    return kept;
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
            // The rectangle inside the map, read from the chunks it touches: absent chunks are
            // empty, and a chunk's cells are read from its array.
            const x0 = Math.max(rect.x, 0);
            const y0 = Math.max(rect.y, 0);
            const x1 = Math.min(rect.x + rect.width, map.width);
            const y1 = Math.min(rect.y + rect.height, map.height);
            if (x1 <= x0 || y1 <= y0) continue;
            const inside = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
            for (const chunk of layer.cells.chunksIn(inside)) {
                const left = chunk.cx * CHUNK_SIZE;
                const top = chunk.cy * CHUNK_SIZE;
                const xEnd = Math.min(x1 - left, CHUNK_SIZE);
                const yEnd = Math.min(y1 - top, CHUNK_SIZE);
                for (let y = Math.max(y0 - top, 0); y < yEnd; y += 1) {
                    for (let x = Math.max(x0 - left, 0); x < xEnd; x += 1) {
                        addSlot(slots, chunk.cells[x + y * CHUNK_SIZE]!);
                    }
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
