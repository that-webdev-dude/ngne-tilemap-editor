import { CELL_INDEX_MASK, CHUNK_BITS, CHUNK_SIZE, CellStore } from "../cells";
import type { Command, Touched } from "../history";
import {
    BYTES_PER_CHUNK,
    MAX_CELLS_PER_LAYER,
    MAX_MAPS,
    MAX_MAP_SIDE,
    MAX_TEXT_LENGTH,
    MAX_TILE_SIZE,
    createMap,
    createMapSession,
    exportNames,
    randomId,
    uniqueSlug,
    walkLayers,
} from "../model";
import type { IdGenerator, Layer, MapSession, Project, ProjectMap, ProjectSession } from "../model";

// The map commands of SPEC §7.1: New Map, Duplicate, Rename, Delete (refused for the last map,
// no confirmation: undo restores it) and Move up or down in the map list. Each `do` checks its
// values against the project as it is then and throws `MapEditError` before changing anything.
//
// New Map, Duplicate and Delete also change which map is shown, as SPEC §3 asks of commands
// that change session state: New Map and Duplicate make the map they add the active one, and
// undo puts back the map that was active; Delete makes another map active when it removes the
// active one, and its undo shows the map it puts back. The session of an added or removed map
// (`perMap`) goes and comes back with it, so a redo shows it as it was left.

export type MapEditErrorCode =
    /** Delete of the only map of the project. */
    | "last"
    /** A name, size or tile size out of its range (FORMAT §2.5, §2.8). */
    | "values"
    /** Move past either end of the list. */
    | "move"
    /** The project holds `MAX_MAPS` maps already. */
    | "count"
    /** The command names a map the project does not have. */
    | "missing";

export class MapEditError extends Error {
    override readonly name = "MapEditError";
    readonly code: MapEditErrorCode;

    constructor(code: MapEditErrorCode, message: string) {
        super(message);
        this.code = code;
    }
}

/** Labels of the history entries. */
export const MAP_LABELS = {
    new: "New Map",
    duplicate: "Duplicate Map",
    rename: "Rename Map",
    delete: "Delete Map",
    moveUp: "Move Map Up",
    moveDown: "Move Map Down",
} as const;

/** What New Map sets (SPEC §7.1): the name, the size in cells and the tile size in pixels. */
export interface NewMapValues {
    name: string;
    width: number;
    height: number;
    tileWidth: number;
    tileHeight: number;
}

/** Bytes a command claims besides the cells it holds. */
const OVERHEAD_BYTES = 256;

/**
 * A `touched` record. Written out rather than taken from `core/history`, whose module reads
 * `import.meta.env`, as `core/tileset` does.
 */
function touched(mapId: string | null, parts: Partial<Touched> = {}): Touched {
    return { mapId, layerIds: [], cellRects: [], tilesetIds: [], structure: false, ...parts };
}

function quoted(text: string): string {
    return `“${text}”`;
}

function isInt(value: number, min: number, max: number): boolean {
    return Number.isInteger(value) && value >= min && value <= max;
}

/** The map `id` of `project`; throws `MapEditError` ("missing") without one. */
export function mapOf(project: Project, id: string): ProjectMap {
    const map = project.maps.find((each) => each.id === id);
    if (!map) throw new MapEditError("missing", `The project has no map "${id}".`);
    return map;
}

/** Why `name` cannot name a map; null when it can. */
export function mapNameProblem(name: string): string | null {
    if (name.trim() === "") return "A map needs a name.";
    if (name.length > MAX_TEXT_LENGTH)
        return `A map name has at most ${MAX_TEXT_LENGTH} characters.`;
    return null;
}

/** Why `values` cannot be a new map's (FORMAT §2.5, §2.8), by field; empty when they can. */
export function newMapProblems(values: NewMapValues): Partial<Record<keyof NewMapValues, string>> {
    const problems: Partial<Record<keyof NewMapValues, string>> = {};
    const name = mapNameProblem(values.name);
    if (name) problems.name = name;
    for (const key of ["width", "height"] as const) {
        if (!isInt(values[key], 1, MAX_MAP_SIDE)) {
            problems[key] = `The ${key} is a whole number of cells from 1 to ${MAX_MAP_SIDE}.`;
        }
    }
    if (!problems.width && !problems.height && values.width * values.height > MAX_CELLS_PER_LAYER) {
        problems.height = `A map has at most ${MAX_CELLS_PER_LAYER.toLocaleString("en")} cells.`;
    }
    for (const key of ["tileWidth", "tileHeight"] as const) {
        if (!isInt(values[key], 1, MAX_TILE_SIZE)) {
            const side = key === "tileWidth" ? "tile width" : "tile height";
            problems[key] = `The ${side} is a whole number of pixels from 1 to ${MAX_TILE_SIZE}.`;
        }
    }
    return problems;
}

const NUMBERED_NAME = /^Map (\d+)/;

/**
 * The name New Map gives a map, as the sprite editor names a new layer: "Map N", with N one
 * above the highest number among the maps named "Map <number>…" (1 when there is none).
 */
export function nextMapName(project: Project): string {
    const numbers = project.maps.map((map) => Number(NUMBERED_NAME.exec(map.name)?.[1] ?? 0));
    return `Map ${Math.max(0, ...numbers) + 1}`;
}

/** The bytes of the cell chunks of `map`'s tile layers. */
function cellBytes(map: ProjectMap): number {
    let bytes = 0;
    for (const { layer } of walkLayers(map.layers)) {
        if (layer.type === "tile") bytes += layer.cells.chunkCount * BYTES_PER_CHUNK;
    }
    return bytes;
}

function assertRoom(project: Project): void {
    if (project.maps.length >= MAX_MAPS) {
        throw new MapEditError("count", `A project holds at most ${MAX_MAPS} maps.`);
    }
}

/**
 * Adds `map` at `index` with its session `mapSession` and makes it the active map; returns the
 * map that was active. Throws `MapEditError` ("count") when the project is full, or ("values")
 * when the map's export name is taken; the session is then unchanged.
 */
function insertMap(
    session: ProjectSession,
    map: ProjectMap,
    index: number,
    mapSession: MapSession,
): string {
    const { project } = session;
    assertRoom(project);
    if (exportNames(project).includes(map.exportName)) {
        throw new MapEditError(
            "values",
            `The export name ${quoted(map.exportName)} is taken in the project.`,
        );
    }
    const before = session.activeMapId;
    project.maps.splice(Math.min(index, project.maps.length), 0, map);
    session.perMap.set(map.id, mapSession);
    session.activeMapId = map.id;
    return before;
}

/** Takes map `id` out of `session`, then makes `active` the active map. */
function removeMap(session: ProjectSession, id: string, active: string): void {
    const { maps } = session.project;
    maps.splice(maps.indexOf(mapOf(session.project, id)), 1);
    session.perMap.delete(id);
    session.activeMapId = active;
}

/**
 * The command that adds a map with `values` and one tile layer at the end of the map list and
 * shows it (SPEC §7.1). The map's ID and export name are chosen now, so a redo adds the same
 * map. Throws `MapEditError` ("values") when a value is out of range.
 */
export function newMapCommand(
    project: Project,
    values: NewMapValues,
    newId: IdGenerator = randomId,
): Command {
    const problems = Object.values(newMapProblems(values));
    if (problems.length > 0) throw new MapEditError("values", problems[0]!);
    const map = createMap({ ...values, takenExportNames: exportNames(project), newId });
    const mapSession = createMapSession(map);
    let before = "";
    return {
        label: MAP_LABELS.new,
        bytes: OVERHEAD_BYTES,
        touched: touched(map.id, { structure: true }),
        do(session) {
            before = insertMap(session, map, session.project.maps.length, mapSession);
        },
        undo(session) {
            removeMap(session, map.id, before);
        },
    };
}

/** A copy of `store`: the same cells in chunks of its own. */
function copyCells(store: CellStore, map: ProjectMap): CellStore {
    const copy = new CellStore();
    for (const chunk of store.chunksIn({ x: 0, y: 0, width: map.width, height: map.height })) {
        const left = chunk.cx * CHUNK_SIZE;
        const top = chunk.cy * CHUNK_SIZE;
        chunk.cells.forEach((value, index) => {
            if (value === 0) return;
            copy.set(left + (index & CELL_INDEX_MASK), top + (index >> CHUNK_BITS), value);
        });
    }
    return copy;
}

/** A deep copy of `layer`, its IDs and its markers' IDs kept (they are per map). */
function copyLayer(layer: Layer, map: ProjectMap): Layer {
    const properties = structuredClone(layer.properties);
    switch (layer.type) {
        case "tile":
            return { ...layer, properties, cells: copyCells(layer.cells, map) };
        case "marker":
            return { ...layer, properties, markers: structuredClone(layer.markers) };
        case "image":
            return { ...layer, properties };
        case "group":
            return { ...layer, properties, layers: layer.layers.map((l) => copyLayer(l, map)) };
    }
}

/** The name of a copy, as the sprite editor names a duplicated layer: "<name> Copy". */
function copyName(name: string): string {
    const suffix = " Copy";
    return `${name.slice(0, MAX_TEXT_LENGTH - suffix.length)}${suffix}`;
}

/**
 * The command that duplicates map `id`: a copy named "<name> Copy" with an export name of its
 * own, every layer, cell and marker copied, placed right after the map and shown. The copy is
 * made now, so a redo adds the same one. Throws `MapEditError` ("missing") for an unknown map.
 */
export function duplicateMapCommand(
    project: Project,
    id: string,
    newId: IdGenerator = randomId,
): Command {
    const source = mapOf(project, id);
    const name = copyName(source.name);
    const copy: ProjectMap = {
        ...source,
        id: newId(),
        name,
        exportName: uniqueSlug(name, exportNames(project), "map"),
        layers: source.layers.map((layer) => copyLayer(layer, source)),
        properties: structuredClone(source.properties),
    };
    const mapSession = createMapSession(copy);
    const bytes = cellBytes(copy);
    let before = "";
    return {
        label: MAP_LABELS.duplicate,
        bytes: OVERHEAD_BYTES + bytes,
        touched: touched(copy.id, { structure: true }),
        ...(bytes > 0 ? { projectBytes: bytes } : {}),
        do(session) {
            const at = session.project.maps.indexOf(mapOf(session.project, id));
            before = insertMap(session, copy, at + 1, mapSession);
        },
        undo(session) {
            removeMap(session, copy.id, before);
        },
    };
}

/** The command that renames map `id` to `name`; its export name stays (FORMAT §2.4). */
export function renameMapCommand(id: string, name: string): Command {
    let before: string | null = null;
    return {
        label: MAP_LABELS.rename,
        bytes: OVERHEAD_BYTES,
        touched: touched(id),
        do(session) {
            const map = mapOf(session.project, id);
            const problem = mapNameProblem(name);
            if (problem) throw new MapEditError("values", problem);
            before = map.name;
            map.name = name;
        },
        undo(session) {
            if (before !== null) mapOf(session.project, id).name = before;
        },
    };
}

/**
 * The command that deletes map `id` (SPEC §7.1). Its `do` throws `MapEditError` ("last") for
 * the only map. When the map is the active one, `next` becomes active (the app passes the tab
 * that takes its place); without `next`, or when `next` is not another map of the project, the
 * map after it in the list, else the one before. Undo puts the map back at its place, with its
 * session, and shows it; a redo then shows the map the first `do` left active.
 */
export function deleteMapCommand(project: Project, id: string, next?: string): Command {
    const map = mapOf(project, id);
    const bytes = cellBytes(map);
    let removed: { index: number; mapSession: MapSession | undefined } | null = null;
    /** The map the first `do` left active. */
    let after: string | null = null;
    return {
        label: MAP_LABELS.delete,
        bytes: OVERHEAD_BYTES + bytes,
        touched: touched(id, { structure: true }),
        do(session) {
            const { maps } = session.project;
            const index = maps.indexOf(mapOf(session.project, id));
            if (maps.length <= 1) {
                throw new MapEditError(
                    "last",
                    `${quoted(map.name)} is the only map of the project; a project keeps one.`,
                );
            }
            let active = session.activeMapId;
            if (active === id) {
                const other = (candidate: string | null | undefined): candidate is string =>
                    candidate != null && candidate !== id && maps.some((m) => m.id === candidate);
                active = [after, next].find(other) ?? (maps[index + 1] ?? maps[index - 1])!.id;
            }
            after ??= active;
            removed = { index, mapSession: session.perMap.get(id) };
            removeMap(session, id, active);
        },
        undo(session) {
            if (!removed) return;
            session.project.maps.splice(removed.index, 0, map);
            if (removed.mapSession) session.perMap.set(id, removed.mapSession);
            session.activeMapId = id;
        },
    };
}

/**
 * The command that moves map `id` one place up (`-1`, towards the start) or down (`1`) in the
 * map list. Its `do` throws `MapEditError` ("move") past either end. The list is the
 * project's, so the entry names no map (SPEC §3).
 */
export function moveMapCommand(id: string, delta: -1 | 1): Command {
    const swap = (project: Project, step: number) => {
        const { maps } = project;
        const from = maps.indexOf(mapOf(project, id));
        const to = from + step;
        if (to < 0 || to >= maps.length) {
            throw new MapEditError(
                "move",
                `${quoted(maps[from]!.name)} is already the ${step < 0 ? "first" : "last"} map.`,
            );
        }
        [maps[from], maps[to]] = [maps[to]!, maps[from]!];
    };
    return {
        label: delta < 0 ? MAP_LABELS.moveUp : MAP_LABELS.moveDown,
        bytes: OVERHEAD_BYTES,
        touched: touched(null, { structure: true }),
        do: (session) => swap(session.project, delta),
        undo: (session) => swap(session.project, -delta),
    };
}

/**
 * The command that moves map `id` of `project` to place `index` of the map list, as a drag in
 * the Maps panel does (DESIGN §8.1): one entry however far it goes, labelled Move Map Up or Down
 * by its direction. Its `do` throws `MapEditError` ("move") for an index outside the list or the
 * place the map holds already. As Move up/down, the entry names no map (SPEC §3). Throws
 * `MapEditError` ("missing") for an unknown map.
 */
export function reorderMapCommand(project: Project, id: string, index: number): Command {
    const start = project.maps.indexOf(mapOf(project, id));
    let from = -1;
    const move = (target: Project, source: number, place: number) => {
        const [map] = target.maps.splice(source, 1);
        target.maps.splice(place, 0, map!);
    };
    return {
        label: index < start ? MAP_LABELS.moveUp : MAP_LABELS.moveDown,
        bytes: OVERHEAD_BYTES,
        touched: touched(null, { structure: true }),
        do(session) {
            const { project } = session;
            const at = project.maps.indexOf(mapOf(project, id));
            if (!Number.isInteger(index) || index < 0 || index >= project.maps.length) {
                throw new MapEditError("move", `The map list has no place ${index + 1}.`);
            }
            if (index === at) {
                throw new MapEditError(
                    "move",
                    `${quoted(project.maps[at]!.name)} is there already.`,
                );
            }
            from = at;
            move(project, at, index);
        },
        undo(session) {
            if (from >= 0) move(session.project, index, from);
        },
    };
}
