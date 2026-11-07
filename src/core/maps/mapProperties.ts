import type { Command, Touched } from "../history";
import { MAX_PARALLAX_ORIGIN, MAX_TEXT_LENGTH, MAX_TILE_SIZE, exportNames, isSlug } from "../model";
import type { Project, ProjectMap } from "../model";
import { MapEditError, mapNameProblem, mapOf } from "./mapCommands";

// Map Properties (SPEC §7.1; DESIGN §9): name, export name, class, tile size, background colour
// and parallax origin of a map. As Tileset Properties, the dialog applies every changed field as
// one undo step. Changing the tile size keeps the cells; markers and layer offsets are in map
// pixels and stay where they are (SPEC §7.1), so the map's pixel size follows the new tile size.

/** The fields of a map the Map Properties dialog edits (DESIGN §9). */
export interface MapFields {
    name: string;
    exportName: string;
    class: string;
    tileWidth: number;
    tileHeight: number;
    /** `0xRRGGBBAA`, or null for none. */
    backgroundColor: number | null;
    parallaxOriginX: number;
    parallaxOriginY: number;
}

export const MAP_FIELD_KEYS: readonly (keyof MapFields)[] = [
    "name",
    "exportName",
    "class",
    "tileWidth",
    "tileHeight",
    "backgroundColor",
    "parallaxOriginX",
    "parallaxOriginY",
];

/** Labels of the history entries of a field edit. */
export const MAP_FIELD_LABELS = {
    rename: "Rename Map",
    exportName: "Change Map Export Name",
    class: "Change Map Class",
    tileSize: "Change Tile Size",
    background: "Change Background Colour",
    parallaxOrigin: "Change Parallax Origin",
    properties: "Map Properties",
} as const;

/** Bytes a command claims. */
const OVERHEAD_BYTES = 256;

function quoted(text: string): string {
    return `“${text}”`;
}

/** The fields of map `map`. */
export function mapFields(map: ProjectMap): MapFields {
    const fields = {} as Record<keyof MapFields, unknown>;
    for (const key of MAP_FIELD_KEYS) fields[key] = map[key];
    return fields as unknown as MapFields;
}

/**
 * Why `fields` cannot be the values of map `id` of `project`, by field; empty when they can.
 * Only the fields given are checked (FORMAT §1.1, §2.5).
 */
export function mapFieldProblems(
    project: Project,
    id: string,
    fields: Partial<MapFields>,
): Partial<Record<keyof MapFields, string>> {
    const problems: Partial<Record<keyof MapFields, string>> = {};
    if (fields.name !== undefined) {
        const problem = mapNameProblem(fields.name);
        if (problem) problems.name = problem;
    }
    const { exportName } = fields;
    if (exportName !== undefined) {
        if (!isSlug(exportName)) {
            problems.exportName =
                "An export name is 1 to 64 of a–z, 0–9, _ and -, starting with a letter or digit, and not “ngne-tilemap”.";
        } else {
            const others = { ...project, maps: project.maps.filter((map) => map.id !== id) };
            if (exportNames(others).includes(exportName)) {
                problems.exportName = `The export name ${quoted(exportName)} is taken.`;
            }
        }
    }
    if (fields.class !== undefined && fields.class.length > MAX_TEXT_LENGTH) {
        problems.class = `A class has at most ${MAX_TEXT_LENGTH} characters.`;
    }
    for (const key of ["tileWidth", "tileHeight"] as const) {
        const value = fields[key];
        if (
            value !== undefined &&
            !(Number.isInteger(value) && value >= 1 && value <= MAX_TILE_SIZE)
        ) {
            const side = key === "tileWidth" ? "tile width" : "tile height";
            problems[key] = `The ${side} is a whole number of pixels from 1 to ${MAX_TILE_SIZE}.`;
        }
    }
    const colour = fields.backgroundColor;
    if (colour !== undefined && colour !== null) {
        if (!(Number.isInteger(colour) && colour >= 0 && colour <= 0xffffffff)) {
            problems.backgroundColor = "The background colour is not a colour.";
        }
    }
    for (const key of ["parallaxOriginX", "parallaxOriginY"] as const) {
        const value = fields[key];
        if (
            value !== undefined &&
            !(Number.isFinite(value) && Math.abs(value) <= MAX_PARALLAX_ORIGIN)
        ) {
            problems[key] =
                `The parallax origin is a number of pixels in −${MAX_PARALLAX_ORIGIN.toLocaleString("en")}..${MAX_PARALLAX_ORIGIN.toLocaleString("en")}.`;
        }
    }
    return problems;
}

/** The fields of `map` in `fields` that differ from it. */
function changedFields(map: ProjectMap, fields: Partial<MapFields>): Partial<MapFields> {
    const changed: Partial<MapFields> = {};
    for (const key of MAP_FIELD_KEYS) {
        const value = fields[key];
        if (value !== undefined && value !== map[key]) {
            (changed as Record<string, unknown>)[key] = value;
        }
    }
    return changed;
}

/** The label of an edit of `keys`: the one field's (or axis pair's) own, else Map Properties. */
function fieldsLabel(keys: readonly (keyof MapFields)[]): string {
    const only = (...group: (keyof MapFields)[]) => keys.every((key) => group.includes(key));
    if (only("tileWidth", "tileHeight")) return MAP_FIELD_LABELS.tileSize;
    if (only("parallaxOriginX", "parallaxOriginY")) return MAP_FIELD_LABELS.parallaxOrigin;
    if (keys.length !== 1) return MAP_FIELD_LABELS.properties;
    switch (keys[0]) {
        case "name":
            return MAP_FIELD_LABELS.rename;
        case "exportName":
            return MAP_FIELD_LABELS.exportName;
        case "class":
            return MAP_FIELD_LABELS.class;
        default:
            return MAP_FIELD_LABELS.background;
    }
}

/**
 * What a change of `keys` tells the viewport. A new tile size changes the map's pixel size and
 * every chunk's, so it is a structural change (plan and composite again); the background and
 * the parallax origin are read at every frame, so a frame of the map is enough.
 */
function touchedBy(id: string, keys: readonly (keyof MapFields)[]): Touched {
    const structure = keys.includes("tileWidth") || keys.includes("tileHeight");
    return { mapId: id, layerIds: [], cellRects: [], tilesetIds: [], structure };
}

/**
 * The command that sets `fields` of map `id`, one history entry. Its `do` throws `MapEditError`
 * ("values") when a value is refused (`mapFieldProblems`), or ("missing") for an unknown map.
 */
export function setMapFieldsCommand(id: string, fields: Partial<MapFields>): Command {
    const keys = MAP_FIELD_KEYS.filter((key) => fields[key] !== undefined);
    let before: Partial<MapFields> = {};
    return {
        label: fieldsLabel(keys),
        bytes: OVERHEAD_BYTES,
        touched: touchedBy(id, keys),
        do(session) {
            const map = mapOf(session.project, id);
            const problems = mapFieldProblems(session.project, id, fields);
            const [key] = MAP_FIELD_KEYS.filter((each) => problems[each] !== undefined);
            if (key) throw new MapEditError("values", problems[key]!);
            before = {};
            const target = map as unknown as Record<string, unknown>;
            for (const each of keys) (before as Record<string, unknown>)[each] = target[each];
            for (const each of keys) target[each] = fields[each];
        },
        undo(session) {
            Object.assign(mapOf(session.project, id), before);
        },
    };
}

/**
 * Map Properties (DESIGN §9): the fields of `values` that differ from map `id` of `project`, as
 * one history entry; null when none does. Throws `MapEditError` ("missing") for an unknown map.
 */
export function mapPropertiesCommand(
    project: Project,
    id: string,
    values: Partial<MapFields>,
): Command | null {
    const changed = changedFields(mapOf(project, id), values);
    return MAP_FIELD_KEYS.some((key) => key in changed) ? setMapFieldsCommand(id, changed) : null;
}
