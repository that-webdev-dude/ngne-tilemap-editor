import { cellSlot } from "../cells";
import type { Command, Touched } from "../history";
import {
    MAX_TEXT_LENGTH,
    MAX_TILE_OFFSET,
    exportNames,
    isSlug,
    pixelBytes,
    walkLayers,
} from "../model";
import type { Project, ProjectMap, Tileset } from "../model";
import { TilesetEditError } from "./errors";

// The tileset commands of SPEC §6.2: rename, export name, class, tile offset, move left or right
// in the list, delete. Each `do` checks its values against the project as it is then and throws
// `TilesetEditError` before changing anything. Moving a tileset changes only the list order,
// which assigns `firstGid` when the project is written (FORMAT §1.2); cells hold slots, so maps
// are unaffected in memory. Delete is refused while any map has a cell of the tileset (Later:
// delete with replacement); removing it takes its tiles away, so the app empties the current
// stamp's and the clipboard's cells on it (SPEC §4.2), told by `touched`.

/** The fields of a tileset the Tileset Properties dialog edits (DESIGN §9). */
export interface TilesetFields {
    name: string;
    exportName: string;
    class: string;
    offsetX: number;
    offsetY: number;
}

export const TILESET_FIELD_KEYS: readonly (keyof TilesetFields)[] = [
    "name",
    "exportName",
    "class",
    "offsetX",
    "offsetY",
];

/** Labels of the history entries. */
export const TILESET_LABELS = {
    rename: "Rename Tileset",
    exportName: "Change Tileset Export Name",
    class: "Change Tileset Class",
    offset: "Change Tile Offset",
    properties: "Tileset Properties",
    moveLeft: "Move Tileset Left",
    moveRight: "Move Tileset Right",
    delete: "Delete Tileset",
} as const;

/** Bytes a command claims besides the pixels it holds. */
const OVERHEAD_BYTES = 256;

/**
 * A project-wide `touched` (no map). Written out rather than taken from `core/history`, whose
 * module reads `import.meta.env`: `core/tileset` is also loaded by Node-side test support.
 */
function touched(parts: Partial<Touched> = {}): Touched {
    return { mapId: null, layerIds: [], cellRects: [], tilesetIds: [], structure: false, ...parts };
}

function tilesetOf(project: Project, id: string): Tileset {
    const tileset = project.tilesets.find((each) => each.id === id);
    if (!tileset) throw new TilesetEditError("not-found", `No tileset has the ID ${id}.`);
    return tileset;
}

function quoted(text: string): string {
    return `“${text}”`;
}

/**
 * Why `fields` cannot be the values of tileset `id` of `project`, by field; empty when they
 * can. Only the fields given are checked.
 */
export function tilesetFieldProblems(
    project: Project,
    id: string,
    fields: Partial<TilesetFields>,
): Partial<Record<keyof TilesetFields, string>> {
    const problems: Partial<Record<keyof TilesetFields, string>> = {};
    const { name, exportName, offsetX, offsetY } = fields;
    if (name !== undefined) {
        if (name.trim() === "") problems.name = "Enter a name.";
        else if (name.length > MAX_TEXT_LENGTH) {
            problems.name = `A name has at most ${MAX_TEXT_LENGTH} characters.`;
        }
    }
    if (exportName !== undefined) {
        if (!isSlug(exportName)) {
            problems.exportName =
                "An export name is 1 to 64 of a–z, 0–9, _ and -, starting with a letter or digit, and not “ngne-tilemap”.";
        } else {
            const others = {
                ...project,
                tilesets: project.tilesets.filter((each) => each.id !== id),
            };
            if (exportNames(others).includes(exportName)) {
                problems.exportName = `The export name ${quoted(exportName)} is taken.`;
            }
        }
    }
    if (fields.class !== undefined && fields.class.length > MAX_TEXT_LENGTH) {
        problems.class = `A class has at most ${MAX_TEXT_LENGTH} characters.`;
    }
    const offsetOk = (value: number | undefined) =>
        value === undefined || (Number.isInteger(value) && Math.abs(value) <= MAX_TILE_OFFSET);
    if (!offsetOk(offsetX))
        problems.offsetX = `The offset is a whole number in −${MAX_TILE_OFFSET}..${MAX_TILE_OFFSET}.`;
    if (!offsetOk(offsetY))
        problems.offsetY = `The offset is a whole number in −${MAX_TILE_OFFSET}..${MAX_TILE_OFFSET}.`;
    return problems;
}

const PROBLEM_CODES = {
    name: "name",
    exportName: "export-name",
    class: "class",
    offsetX: "offset",
    offsetY: "offset",
} as const;

/** The fields of `tileset` in `fields` that differ from it. */
function changedFields(tileset: Tileset, fields: Partial<TilesetFields>): Partial<TilesetFields> {
    const changed: Partial<TilesetFields> = {};
    for (const key of TILESET_FIELD_KEYS) {
        const value = fields[key];
        if (value !== undefined && value !== tileset[key]) {
            (changed as Record<string, unknown>)[key] = value;
        }
    }
    return changed;
}

/** The label of an edit of `keys`: the one field's own, else Tileset Properties. */
function fieldsLabel(keys: readonly (keyof TilesetFields)[]): string {
    const offset = keys.every((key) => key === "offsetX" || key === "offsetY");
    if (offset) return TILESET_LABELS.offset;
    if (keys.length !== 1) return TILESET_LABELS.properties;
    const [key] = keys;
    return key === "name"
        ? TILESET_LABELS.rename
        : key === "exportName"
          ? TILESET_LABELS.exportName
          : TILESET_LABELS.class;
}

/**
 * The command that sets `fields` of tileset `id`, one history entry: the fields the dialog
 * edits. Its `do` throws `TilesetEditError` when a value is refused (`tilesetFieldProblems`).
 * A tile offset changes how the tiles are drawn, so the command names the tileset in
 * `touched.tilesetIds`; the other fields are not drawn.
 */
export function setTilesetFieldsCommand(
    id: string,
    fields: Partial<TilesetFields>,
    label?: string,
): Command {
    const keys = TILESET_FIELD_KEYS.filter((key) => fields[key] !== undefined);
    const offset = keys.includes("offsetX") || keys.includes("offsetY");
    const changes = offset ? touched({ tilesetIds: [id] }) : touched();
    let before: Partial<TilesetFields> = {};
    return {
        label: label ?? fieldsLabel(keys),
        bytes: OVERHEAD_BYTES,
        touched: changes,
        do(session) {
            const tileset = tilesetOf(session.project, id);
            const problems = tilesetFieldProblems(session.project, id, fields);
            const [key] = TILESET_FIELD_KEYS.filter((each) => problems[each] !== undefined);
            if (key) throw new TilesetEditError(PROBLEM_CODES[key], problems[key]!);
            before = {};
            for (const each of keys) {
                (before as Record<string, unknown>)[each] = tileset[each];
            }
            for (const each of keys) {
                (tileset as unknown as Record<string, unknown>)[each] = fields[each];
            }
        },
        undo(session) {
            Object.assign(tilesetOf(session.project, id), before);
        },
    };
}

/** Rename (SPEC §6.2; F2 in the Tilesets panel). */
export function renameTilesetCommand(id: string, name: string): Command {
    return setTilesetFieldsCommand(id, { name }, TILESET_LABELS.rename);
}

/** Export name: a slug no other map, tileset or image of the project has (FORMAT §2.4). */
export function setTilesetExportNameCommand(id: string, exportName: string): Command {
    return setTilesetFieldsCommand(id, { exportName }, TILESET_LABELS.exportName);
}

/** Class: free text, empty for none. */
export function setTilesetClassCommand(id: string, className: string): Command {
    return setTilesetFieldsCommand(id, { class: className }, TILESET_LABELS.class);
}

/** Tile offset (FORMAT §1.3): integers in −4096..4096, +x right, +y down. */
export function setTileOffsetCommand(id: string, offsetX: number, offsetY: number): Command {
    return setTilesetFieldsCommand(id, { offsetX, offsetY }, TILESET_LABELS.offset);
}

/**
 * Tileset Properties (DESIGN §9): the fields of `values` that differ from tileset `id` of
 * `project`, as one history entry; null when none does. Throws `TilesetEditError` when the
 * tileset does not exist.
 */
export function tilesetPropertiesCommand(
    project: Project,
    id: string,
    values: Partial<TilesetFields>,
): Command | null {
    const changed = changedFields(tilesetOf(project, id), values);
    const keys = TILESET_FIELD_KEYS.filter((key) => changed[key] !== undefined);
    return keys.length === 0 ? null : setTilesetFieldsCommand(id, changed);
}

/**
 * The command that moves tileset `id` one place left (`-1`) or right (`1`) in the list (the
 * Tilesets panel's tabs). Its `do` throws `TilesetEditError` past either end.
 */
export function moveTilesetCommand(id: string, delta: -1 | 1): Command {
    const swap = (project: Project, step: number) => {
        const { tilesets } = project;
        const from = tilesets.indexOf(tilesetOf(project, id));
        const to = from + step;
        if (to < 0 || to >= tilesets.length) {
            throw new TilesetEditError(
                "move",
                `${quoted(tilesets[from]!.name)} is already the ${step < 0 ? "first" : "last"} tileset.`,
            );
        }
        [tilesets[from], tilesets[to]] = [tilesets[to]!, tilesets[from]!];
    };
    return {
        label: delta < 0 ? TILESET_LABELS.moveLeft : TILESET_LABELS.moveRight,
        bytes: OVERHEAD_BYTES,
        touched: touched({ structure: true }),
        do: (session) => swap(session.project, delta),
        undo: (session) => swap(session.project, -delta),
    };
}

/** Whether `map` has a cell of the tileset in `slot`. */
function mapUses(map: ProjectMap, slot: number): boolean {
    const bounds = { x: 0, y: 0, width: map.width, height: map.height };
    for (const { layer } of walkLayers(map.layers)) {
        if (layer.type !== "tile") continue;
        for (const chunk of layer.cells.chunksIn(bounds)) {
            if (chunk.cells.some((value) => value !== 0 && cellSlot(value) === slot)) return true;
        }
    }
    return false;
}

/** The maps of `project` that have a cell of `tileset`, in project order. */
export function mapsUsingTileset(project: Project, tileset: Tileset): ProjectMap[] {
    return project.maps.filter((map) => mapUses(map, tileset.slot));
}

/** The message of a refused delete: the tileset and the maps that use it. */
function inUseMessage(tileset: Tileset, maps: readonly ProjectMap[]): string {
    const names = maps.map((map) => quoted(map.name));
    const list =
        names.length === 1
            ? `the map ${names[0]}`
            : `the maps ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
    return `${quoted(tileset.name)} is used by ${list}.`;
}

/**
 * The command that deletes tileset `id`. Its `do` throws `TilesetEditError` ("in-use", naming
 * the maps) while any map has a cell of it. Undo puts it back at its place in the list, in the
 * slot it had.
 */
export function deleteTilesetCommand(project: Project, id: string): Command {
    const bytes = pixelBytes(tilesetOf(project, id).pixels) + OVERHEAD_BYTES;
    let removed: { index: number; tileset: Tileset } | null = null;
    return {
        label: TILESET_LABELS.delete,
        bytes,
        touched: touched({ tilesetIds: [id], structure: true }),
        do(session) {
            const { tilesets } = session.project;
            const at = tilesets.indexOf(tilesetOf(session.project, id));
            const users = mapsUsingTileset(session.project, tilesets[at]!);
            if (users.length > 0) {
                throw new TilesetEditError(
                    "in-use",
                    inUseMessage(tilesets[at]!, users),
                    users.map((map) => map.name),
                );
            }
            removed = { index: at, tileset: tilesets.splice(at, 1)[0]! };
        },
        undo(session) {
            if (removed) session.project.tilesets.splice(removed.index, 0, removed.tileset);
        },
    };
}
