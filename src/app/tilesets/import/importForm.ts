import { MAX_TEXT_LENGTH, exportNames, isSlug, uniqueSlug } from "../../../core/model";
import type { Project, ProjectSession } from "../../../core/model";
import {
    TilesetImportError,
    planAtlas,
    planGridPng,
    planSprite,
    spriteGridDefaults,
    tilesetNameOf,
} from "../../../core/tileset";
import type {
    GridOptions,
    TilesetImportErrorCode,
    TilesetImportWarning,
    TilesetShape,
} from "../../../core/tileset";
import type { ImportSource } from "./importSources";

// The form of the Import Tileset dialog (DESIGN §9) and what it plans, without a pixel: the grid
// (tile size, margin, spacing) of a grid PNG or a sprite, the frame of a sprite the dialog shows,
// and the tileset's name and export name. `planOf` runs the import core's plan against the
// project as it is (limits of FORMAT §2.8, packability), so a refusal shows before anything is
// decoded (SPEC §6.1).

export interface ImportForm extends GridOptions {
    name: string;
    exportName: string;
    /** Whether the export name was typed: until then it follows the name. */
    exportNameEdited: boolean;
    /** The frame of a sprite the source pane shows, by index. */
    frame: number;
}

/** The plan of the form: the tileset's shape, or why there is none. */
export type ImportPlan =
    | { ok: true; shape: TilesetShape; warnings: TilesetImportWarning[] }
    | {
          ok: false;
          problem: string;
          /** The import core's reason; null for a file that could not be read. */
          code: TilesetImportErrorCode | null;
      };

/** The grid of the last grid PNG imported in this window (Tiled's session options). */
let lastGrid: GridOptions = { tileWidth: 32, tileHeight: 32, margin: 0, spacing: 0 };

/** Remembers the grid of a grid PNG that was imported, for the next one. */
export function rememberGrid(grid: GridOptions): void {
    lastGrid = gridOf(grid);
}

/** Forgets the remembered grid (tests). */
export function forgetGrid(): void {
    lastGrid = { tileWidth: 32, tileHeight: 32, margin: 0, spacing: 0 };
}

/**
 * The grid of a grid PNG at the start, as Tiled's New Tileset dialog (v1.12.2) starts: the
 * margin and spacing of the last import, the tile size of the active map (the last import's,
 * 32 × 32 at first, without one).
 */
function imageGrid(session: ProjectSession): GridOptions {
    const map = session.project.maps.find((each) => each.id === session.activeMapId);
    return {
        ...lastGrid,
        ...(map && { tileWidth: map.tileWidth, tileHeight: map.tileHeight }),
    };
}

/**
 * The form a source opens with. A sprite takes `spriteGridDefaults` (SPEC §6.1); when there is
 * none, the fields show the canvas size, above 256, and Import stays disabled until a tile
 * size of at most 256 is entered.
 */
export function initialForm(session: ProjectSession, source: ImportSource): ImportForm {
    let grid: GridOptions;
    if (source.kind === "sprite") {
        const { doc } = source;
        grid = spriteGridDefaults(doc) ?? {
            tileWidth: doc.width,
            tileHeight: doc.height,
            margin: 0,
            spacing: 0,
        };
    } else {
        grid = imageGrid(session);
    }
    const name = tilesetNameOf(source.fileName);
    return {
        ...grid,
        name,
        exportName: exportNameFor(session.project, name),
        exportNameEdited: false,
        frame: 0,
    };
}

/** The export name a tileset of `name` takes: its slug, unique in the project (SPEC §6.1). */
export function exportNameFor(project: Project, name: string): string {
    return uniqueSlug(name, exportNames(project), "tileset");
}

/** The form after a change of `patch`; the export name follows the name until it is typed. */
export function changedForm(
    project: Project,
    form: ImportForm,
    patch: Partial<ImportForm>,
): ImportForm {
    const next = { ...form, ...patch };
    if (patch.exportName !== undefined) next.exportNameEdited = true;
    else if (patch.name !== undefined && !next.exportNameEdited) {
        next.exportName = exportNameFor(project, next.name);
    }
    return next;
}

/** Why the name or export name cannot be taken; null when both can. */
export function nameProblem(project: Project, form: ImportForm): string | null {
    if (form.name.trim() === "") return "The tileset needs a name.";
    if (form.name.length > MAX_TEXT_LENGTH) {
        return `A name is at most ${MAX_TEXT_LENGTH} characters.`;
    }
    if (!isSlug(form.exportName)) {
        return (
            "An export name is 1 to 64 characters of a–z, 0–9, _ and -, starting with a " +
            "letter or digit, and not ngne-tilemap."
        );
    }
    const taken = new Set(exportNames(project).map((name) => name.toLowerCase()));
    if (taken.has(form.exportName)) {
        return `The export name ${JSON.stringify(form.exportName)} is taken.`;
    }
    return null;
}

/** The grid of the form, as the import takes it. */
export function gridOf(form: GridOptions): GridOptions {
    const { tileWidth, tileHeight, margin, spacing } = form;
    return { tileWidth, tileHeight, margin, spacing };
}

/** A key of the grid: an import made with one grid is the import of any equal grid. */
export function gridKey(form: GridOptions): string {
    return `${form.tileWidth}×${form.tileHeight}+${form.margin}/${form.spacing}`;
}

/** The plan of `form` for `source` in `project`. */
export function planOf(project: Project, source: ImportSource, form: ImportForm): ImportPlan {
    const options = { fileName: source.fileName, ...gridOf(form) };
    try {
        switch (source.kind) {
            case "image":
                return {
                    ok: true,
                    shape: planGridPng(project, source.size, options),
                    warnings: [],
                };
            case "sprite":
                return { ok: true, shape: planSprite(project, source.doc, options), warnings: [] };
            case "atlas": {
                const plan = planAtlas(project, source.json, source.size, {
                    fileName: source.fileName,
                });
                return { ok: true, ...plan };
            }
            case "refused":
                return { ok: false, problem: source.message, code: null };
        }
    } catch (error) {
        if (error instanceof TilesetImportError) {
            return { ok: false, problem: error.message, code: error.code };
        }
        throw error;
    }
}
