import type { Command, Touched } from "../history";
import { MAX_TEXT_LENGTH, isSlug } from "../model";
import type { Project, Tile } from "../model";
import { PropertyEditError, propertyOwners } from "./propertyCommands";

// Built-in fields the Properties panel edits that no other module's command sets (SPEC §9,
// DESIGN §8.3): the project's name and export name (FORMAT §2.4), and the class of tiles
// (SPEC §6.2: tile class is edited in the Properties panel). The other kinds' fields use their
// own modules' commands (maps, layers, markers, tilesets).

/** Labels of the history entries. */
export const BUILTIN_LABELS = {
    projectName: "Rename Project",
    projectExportName: "Change Project Export Name",
    tileClass: "Change Tile Class",
} as const;

/** The fields of the project the panel edits. */
export interface ProjectFields {
    name: string;
    exportName: string;
}

const OVERHEAD_BYTES = 256;

/** Tiles `tileIds` of tileset `tilesetId`, each once; throws `PropertyEditError` ("missing"). */
function tilesOf(project: Project, tilesetId: string, tileIds: readonly number[]): Tile[] {
    // The checks are `propertyOwners`'s; the owners of a tiles target are the tiles.
    return propertyOwners(project, { kind: "tiles", tilesetId, tileIds }) as Tile[];
}

function touchedNothing(): Touched {
    return { mapId: null, layerIds: [], cellRects: [], tilesetIds: [], structure: false };
}

/** Why `fields` cannot be the project's (FORMAT §2.4), by field; empty when they can. */
export function projectFieldProblems(
    fields: Partial<ProjectFields>,
): Partial<Record<keyof ProjectFields, string>> {
    const problems: Partial<Record<keyof ProjectFields, string>> = {};
    const { name, exportName } = fields;
    if (name !== undefined) {
        if (name.trim() === "") problems.name = "A project name is not blank.";
        else if (name.length > MAX_TEXT_LENGTH) {
            problems.name = `A project name has at most ${MAX_TEXT_LENGTH} characters.`;
        }
    }
    if (exportName !== undefined && !isSlug(exportName)) {
        problems.exportName =
            "An export name is 1 to 64 of a–z, 0–9, _ and -, starting with a letter or digit, and not “ngne-tilemap”.";
    }
    return problems;
}

/**
 * The command that sets `fields` of the project, one entry. Throws `PropertyEditError`
 * ("values"), now or at `do`, for a refused value.
 */
export function setProjectFieldsCommand(fields: Partial<ProjectFields>): Command {
    const check = () => {
        const problem = Object.values(projectFieldProblems(fields))[0];
        if (problem) throw new PropertyEditError("values", problem);
    };
    check();
    const keys = (["name", "exportName"] as const).filter((key) => fields[key] !== undefined);
    let before: Partial<ProjectFields> = {};
    return {
        label:
            keys.length === 1 && keys[0] === "exportName"
                ? BUILTIN_LABELS.projectExportName
                : BUILTIN_LABELS.projectName,
        bytes: OVERHEAD_BYTES,
        touched: touchedNothing(),
        do(session) {
            check();
            const { project } = session;
            before = Object.fromEntries(keys.map((key) => [key, project[key]]));
            for (const key of keys) project[key] = fields[key]!;
        },
        undo(session) {
            Object.assign(session.project, before);
        },
    };
}

/**
 * The command that sets the class of tiles `tileIds` of tileset `tilesetId` to `className`
 * ("" for none), one entry however many. Throws `PropertyEditError` for a class over 255 code
 * units ("values") or an unknown tileset or tile ("missing").
 */
export function setTilesClassCommand(
    project: Project,
    tilesetId: string,
    tileIds: readonly number[],
    className: string,
): Command {
    if (className.length > MAX_TEXT_LENGTH) {
        throw new PropertyEditError("values", `A class has at most ${MAX_TEXT_LENGTH} characters.`);
    }
    const count = tilesOf(project, tilesetId, tileIds).length;
    let before: string[] = [];
    return {
        label: BUILTIN_LABELS.tileClass,
        bytes: OVERHEAD_BYTES + count * 2 * MAX_TEXT_LENGTH,
        touched: touchedNothing(),
        do(session) {
            const tiles = tilesOf(session.project, tilesetId, tileIds);
            before = tiles.map((tile) => tile.class);
            for (const tile of tiles) tile.class = className;
        },
        undo(session) {
            const tiles = tilesOf(session.project, tilesetId, tileIds);
            tiles.forEach((tile, k) => (tile.class = before[k]!));
        },
    };
}
