import { createProject } from "../../../core/model";
import type { Project, ProjectImage, Tileset } from "../../../core/model";
import { projectFromWire, projectToWire } from "../../../core/project";
import type { WireMap } from "../../../core/project";
import { TmjError, importTmj, tmjRequiredFiles } from "../../../core/tmj";
import type { TmjFiles, TmjImport, TmjImportReport, TmjRequiredFile } from "../../../core/tmj";
import { buffersOf, defineTask } from "../task";

// Import Tiled Map (`core/tmj`, SPEC §13; TE-061) off the main thread: reading the map for the
// files it needs, and its decompression and conversion with its tilesets and images. The page
// sends the files it has read, by their path from the map's folder; of its project only the
// tilesets that may be reused (SPEC §13: of the name an external tileset of the map takes) and
// the export names in use, so a project's pixels are not copied for nothing. The page checks
// the project again when it adds the import (`importTmjCommand`).

export interface TmjFilesInput {
    mapText: string;
    /** Tilesets' texts read so far, by path: their images are needed too. */
    texts: Record<string, string>;
}

export interface TmjImportInput {
    mapText: string;
    fileName: string;
    texts: Record<string, string>;
    bytes: Record<string, Uint8Array>;
    /** The project's tilesets that may be reused. */
    candidates: Tileset[];
    /** Every export name of the project. */
    takenExportNames: string[];
}

/** `TmjImport` as it crosses to the page: the map's cell stores as chunks. */
export interface TmjImportOutput {
    map: WireMap;
    slots: (string | null)[];
    tilesets: Tileset[];
    images: ProjectImage[];
    report: TmjImportReport;
}

declare module "../protocol" {
    interface WorkerTaskTypes {
        /** `tmjRequiredFiles`. */
        "tmj.files": TaskType<TmjFilesInput, TmjRequiredFile[]>;
        /** `importTmj`; the cells and pixels are transferred. */
        "tmj.import": TaskType<TmjImportInput, TmjImportOutput, TmjError>;
    }
}

function filesOf(input: Pick<TmjImportInput, "texts" | "bytes">): TmjFiles {
    return {
        text: (path) => input.texts[path],
        bytes: (path) => input.bytes[path],
    };
}

/** A project holding `map` alone, to carry it as wire data. */
function carrier(): Project {
    return { ...createProject(), maps: [] };
}

/** The import as the worker sends it. */
export function importToWire(imported: TmjImport): TmjImportOutput {
    const [map] = projectToWire({ ...carrier(), maps: [imported.map] }).maps;
    return {
        map: map!,
        slots: [...imported.slots],
        tilesets: [...imported.tilesets],
        images: [...imported.images],
        report: imported.report,
    };
}

/** The import the page receives. */
export function importFromWire(output: TmjImportOutput): TmjImport {
    const [map] = projectFromWire({ ...carrier(), maps: [output.map] }).maps;
    return { ...output, map: map! };
}

async function runImport(input: TmjImportInput): Promise<TmjImportOutput> {
    const project: Project = { ...carrier(), tilesets: input.candidates };
    const imported = await importTmj(project, input.mapText, {
        fileName: input.fileName,
        files: filesOf(input),
        takenExportNames: input.takenExportNames,
    });
    return importToWire(imported);
}

export const tasks = [
    defineTask("tmj.files", {
        run: ({ mapText, texts }) => tmjRequiredFiles(mapText, { text: (path) => texts[path] }),
    }),
    defineTask("tmj.import", {
        run: runImport,
        transfer: (output) => {
            const views: ArrayBufferView[] = [
                ...output.tilesets.map((tileset) => tileset.pixels.data),
                ...output.images.map((image) => image.pixels.data),
            ];
            const walk = (layers: WireMap["layers"]) => {
                for (const layer of layers) {
                    if (layer.type === "tile")
                        views.push(...layer.cells.map((chunk) => chunk.cells));
                    else if (layer.type === "group") walk(layer.layers);
                }
            };
            walk(output.map.layers);
            return buffersOf(...views);
        },
        failures: [TmjError],
    }),
];
