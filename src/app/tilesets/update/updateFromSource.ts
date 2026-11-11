import type { Command } from "../../../core/history";
import type { TilesetSourceKind } from "../../../core/model";
import type { UpdateSourceFiles, UpdateSummary } from "../../../core/tileset";
import { matchTiles, updateFromSourceCommand } from "../../../core/tileset";
import { commandDialogs } from "../../dialogs/dialogRequests";
import { notices } from "../../notices/notices";
import { sessionStore } from "../../state/session";
import { backgroundWorker } from "../../worker/client";
import type { WorkerClient } from "../../worker/client";
// The task type, so that `run("tileset.updateSource")` is typed outside the worker's own glob.
import type {
    CollectionSourceFiles,
    UpdateTilesetInput,
} from "../../worker/tasks/tilesetUpdate.task";
import { fileSetOf } from "../../tmj/tmjFiles";
import type { TmjFileSet } from "../../tmj/tmjFiles";
import { currentTileset, historyIdle } from "../edit/tilesetEdit";
import { reason } from "../../worker/errorReason";
import { readImportSource } from "../import/importSources";
import type { PickedFile } from "../import/importSources";
import { pickedFile } from "../import/pickTilesetFiles";
import { runTilesetWorkflow, tilesetWorkflowBusy } from "../tilesetWorkflow";
import { collectionSourceFiles, pickCollectionSource } from "./collectionSource";
import { createUpdateSession } from "./updateSession";
import type { UpdateSession } from "./updateSession";

// Tileset → Update Tileset from Source… (SPEC §6.3, DESIGN §5 and §9; TE-028). The source file
// is picked, or dropped on the tileset's tab in the Tilesets panel; the worker reads it with
// the tileset's recorded parameters and matches it. With nothing ambiguous or missing the
// update applies at once, one history entry, and a toast gives the counts; otherwise the
// dialog asks for a choice per ambiguous and missing tile, and its Apply makes the entry. A
// browser's open picker cannot be given a file name, so the picker takes only files of the
// source's kind and a toast names the recorded file as it opens. An update runs as a tileset file
// operation (`tilesetWorkflow.ts`): one at a time, with the drops, the file commands and the
// tileset dialogs unavailable meanwhile. One given up after it started, because another dialog
// is open when it needs its own, is reported by a toast; one the user cancels is not. A
// `"collection"` tileset (TE-062) asks for its TSJ, TSX or TMJ and the tile images as Import
// Tiled Map picks files (`collectionSource.ts`); the worker converts them as the import does.

export interface UpdateTilesetRequest {
    kind: "update-tileset";
    session: UpdateSession;
    /** True once the update is applied, null when cancelled. Closes the dialog. */
    answer(values: true | null): void;
}

/** The types the picker offers for a source of `kind` (SUITE §7). */
export function updatePickerAccept(kind: Exclude<TilesetSourceKind, "collection">): string {
    switch (kind) {
        case "image":
            return "image/png,.png";
        case "sprite":
            return ".ngsprite,application/zip";
        case "atlas":
            return ".atlas.json,image/png,.png";
    }
}

/** "10 unchanged, 1 moved, 1 changed, 0 new, 1 ambiguous, 3 missing" (DESIGN §9). */
export function summaryText(summary: UpdateSummary): string {
    const { unchanged, moved, changed, ambiguous, missing } = summary;
    return [
        `${unchanged} unchanged`,
        `${moved} moved`,
        `${changed} changed`,
        `${summary.new} new`,
        `${ambiguous} ambiguous`,
        `${missing} missing`,
    ].join(", ");
}

/** Whether a tileset file operation, an update or an import, is in progress. */
export function updatingTileset(): boolean {
    return tilesetWorkflowBusy();
}

/** Picked or dropped files, or (a collection's source) the set of a folder or of files. */
export type UpdateFiles = readonly PickedFile[] | TmjFileSet;

/** The files of the source as the update reads them, or why there are none. */
async function sourceFiles(files: UpdateFiles): Promise<UpdateSourceFiles | string> {
    const picked = isFileSet(files)
        ? [...files.byPath.values(), ...files.byName.values()].map((entry) => entry.file)
        : files;
    const source = await readImportSource(picked);
    if (!source) return "The source is a .png, an .ngsprite, or an .atlas.json with its PNG.";
    switch (source.kind) {
        case "image":
            return { kind: "image", png: source.bytes };
        case "sprite":
            return { kind: "sprite", bytes: source.bytes };
        case "atlas":
            return { kind: "atlas", json: source.json, png: source.png.bytes };
        case "refused":
            return source.message;
    }
}

function isFileSet(files: UpdateFiles): files is TmjFileSet {
    return !Array.isArray(files);
}

/**
 * Updates tileset `tilesetId` from `files`. Resolves true once the update is applied; false
 * when it is cancelled, changes nothing, is refused (reported by a toast), or a tileset file
 * operation is in progress.
 */
export async function updateTilesetFromFiles(
    tilesetId: string,
    files: UpdateFiles,
    worker: Pick<WorkerClient, "run"> = backgroundWorker,
): Promise<boolean> {
    const project = () => sessionStore.getState().session.project;
    const tileset = project().tilesets.find((each) => each.id === tilesetId);
    if (!tileset) return false;
    const { name } = tileset;
    const fail = (message: string) => {
        notices.error(`Could not update tileset “${name}”. ${message}`);
        return false;
    };
    return runTilesetWorkflow(async () => {
        let read: UpdateSourceFiles | CollectionSourceFiles | string;
        try {
            read =
                tileset.source.kind === "collection"
                    ? await collectionSourceFiles(
                          { name, fileName: tileset.source.fileName },
                          isFileSet(files) ? files : fileSetOf(files),
                          worker,
                      )
                    : await sourceFiles(files);
        } catch (error) {
            return fail(reason(error));
        }
        if (typeof read === "string") return fail(read);
        const input: UpdateTilesetInput = {
            tileset: {
                id: tileset.id,
                name,
                tileWidth: tileset.tileWidth,
                tileHeight: tileset.tileHeight,
                source: { ...tileset.source },
                tiles: tileset.tiles.map(({ id, sourceKey, fingerprint }) => ({
                    id,
                    sourceKey,
                    fingerprint,
                })),
            },
            files: read,
        };
        let result;
        try {
            result = await worker.run("tileset.updateSource", input);
        } catch (error) {
            return fail(reason(error));
        }
        const { source } = result;
        // The project may have changed while the worker read: the tileset removed (an undo
        // of its import), or its tiles changed (an undo of an earlier update). The rows are
        // the matching of the tiles as they are now.
        const current = project().tilesets.find((each) => each.id === tilesetId);
        if (!current) return fail("The tileset was removed while its source was read.");
        const match =
            current.tiles === tileset.tiles
                ? result.match
                : matchTiles(current.tiles, source.entries);
        const execute = (command: Command) => sessionStore.getState().history.execute(command);
        const busy = () => (historyIdle() ? null : "Finish the stroke on the map first.");

        if (match.ambiguous.length === 0 && match.missing.length === 0) {
            const problem = busy();
            if (problem) return fail(problem);
            let command;
            try {
                command = updateFromSourceCommand(project(), tilesetId, source);
            } catch (error) {
                return fail(reason(error));
            }
            if (!command) {
                notices.info(`Tileset “${name}” is up to date with its source.`);
                return false;
            }
            execute(command);
            notices.info(`Updated tileset “${name}”: ${summaryText(match.summary)}.`);
            return true;
        }

        const session = createUpdateSession(
            { tilesetId, tilesetName: name, source, match },
            { project, execute, busy },
        );
        if (commandDialogs.store.getState().request !== null) {
            return fail("Another dialog is open.");
        }
        const answer = await commandDialogs.open<true>((answer): UpdateTilesetRequest => ({
            kind: "update-tileset",
            session,
            answer,
        }));
        if (answer !== true) return false;
        if (session.store.getState().outcome !== "applied") {
            notices.info(`Tileset “${name}” is up to date with its source.`);
            return false;
        }
        notices.info(`Updated tileset “${name}”.`);
        return true;
    });
}

/** Asks for the source files of a source of `kind`; resolves null when the user cancels. */
export function pickUpdateFiles(
    kind: Exclude<TilesetSourceKind, "collection">,
): Promise<PickedFile[] | null> {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = updatePickerAccept(kind);
        // An atlas is picked with its PNG.
        input.multiple = kind === "atlas";
        input.hidden = true;
        input.dataset.updateTilesetInput = "";
        const finish = (files: readonly File[] | null) => {
            input.remove();
            resolve(files && files.length > 0 ? files.map(pickedFile) : null);
        };
        input.addEventListener("change", () => finish(Array.from(input.files ?? [])), {
            once: true,
        });
        input.addEventListener("cancel", () => finish(null), { once: true });
        document.body.append(input);
        input.click();
    });
}

/** Whether the shown tileset can be updated now. */
export function canUpdateCurrentTileset(): boolean {
    return currentTileset() !== null && historyIdle() && !tilesetWorkflowBusy();
}

/** Tileset → Update Tileset from Source…: asks for the source, then updates the shown tileset. */
export async function updateCurrentTileset(): Promise<boolean> {
    const tileset = currentTileset();
    if (!tileset || tilesetWorkflowBusy()) return false;
    const { kind, fileName } = tileset.source;
    if (kind === "collection") {
        notices.info(`Pick “${fileName}” and its images, the source of tileset “${tileset.name}”.`);
        let set: TmjFileSet | null;
        try {
            set = await pickCollectionSource();
        } catch (error) {
            notices.error(`Could not read the files. ${reason(error)}`);
            return false;
        }
        return set ? updateTilesetFromFiles(tileset.id, set) : false;
    }
    notices.info(`Pick “${fileName}”, the source of tileset “${tileset.name}”.`);
    const files = await pickUpdateFiles(kind);
    return files ? updateTilesetFromFiles(tileset.id, files) : false;
}
