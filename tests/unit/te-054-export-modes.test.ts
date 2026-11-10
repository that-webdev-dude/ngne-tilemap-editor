import { describe, expect, it } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { createExportDialogs } from "../../src/app/export/dialogs";
import type { ExportDialogRequest, ExportOverwriteRequest } from "../../src/app/export/dialogs";
import { createExportPipeline } from "../../src/app/export/exportProject";
import type { ExportPipeline } from "../../src/app/export/exportProject";
import type { StoredExportFolder } from "../../src/app/export/exportFolders";
import { setExportOnSave } from "../../src/app/export/exportSettings";
import type { ExportFolderHandle, ExportPlatform } from "../../src/app/platform/exportFiles";
import { createSessionStore } from "../../src/app/state/session";
import type { SessionState } from "../../src/app/state/session";
import { writeZip } from "../../src/core/codec";
import { exportFiles, exportMarkerBytes, exportPreview } from "../../src/core/export";
import { cellValue } from "../../src/core/cells";
import { createProjectSession } from "../../src/core/model";
import { createExportProject } from "../support/exportProject";
import { setup as fileSetup } from "./te-047-support";

// TE-054: Export…, Export Again and Export on Save over the export pipeline of TE-053
// (`app/export/exportProject.ts`), with a folder in memory and the dialogs answered by the
// test; and the export settings' setter (SPEC §3).

/** A folder in memory that logs every write and can be told to fail one or to refuse writing. */
function memoryFolder(name = "game") {
    const files = new Map<string, Uint8Array>();
    const writes: string[] = [];
    const folder = {
        failOn: null as string | null,
        writable: true,
        grants: true,
        present: true,
        files,
        writes,
        handle: {
            name,
            stored: { memory: name },
            canWrite: async (): Promise<boolean> => folder.writable,
            requestWrite: async (): Promise<boolean> => {
                folder.writable = folder.grants;
                return folder.grants;
            },
            existing: async (names: readonly string[]) => names.filter((each) => files.has(each)),
            read: async (file: string) => files.get(file) ?? null,
            async write(file: string, bytes: Uint8Array<ArrayBuffer>) {
                if (folder.failOn === file) throw new Error("The disk is full.");
                writes.push(file);
                files.set(file, bytes.slice());
            },
            isSame: async (other: ExportFolderHandle) => other.name === name,
            exists: async (): Promise<boolean> => folder.present,
        } satisfies ExportFolderHandle,
    };
    return folder;
}

interface Options {
    /** What the Export dialog answers: true exports, null closes it. */
    dialogAnswer?: true | null;
    /** What the overwrite question answers. */
    overwriteAnswer?: true | null;
    /** The session store; by default one of its own on the TE-053 project. */
    sessions?: StoreApi<SessionState>;
}

function setup(options: Options = {}) {
    const sessions =
        options.sessions ?? createSessionStore(createProjectSession(createExportProject()));
    const folder = memoryFolder();
    let picks = 0;
    let activation = true;
    const platform: ExportPlatform = {
        canChooseFolder: () => true,
        chooseFolder: async () => {
            picks += 1;
            folder.present = true;
            return folder.handle;
        },
        folderFrom: (stored) =>
            (stored as { memory?: string }).memory === folder.handle.name ? folder.handle : null,
        canChooseFile: () => false,
        chooseFile: async () => null,
        download: () => {},
        hasUserActivation: () => activation,
    };
    const stored = new Map<string, StoredExportFolder>();
    const dialogs = createExportDialogs();
    dialogs.attachHost();
    const shown: ExportDialogRequest[] = [];
    const asked: ExportOverwriteRequest[] = [];
    dialogs.exportStore.subscribe(({ request }) => {
        if (!request) return;
        shown.push(request);
        request.answer(options.dialogAnswer ?? null);
    });
    dialogs.store.subscribe(({ request }) => {
        if (!request) return;
        asked.push(request);
        request.answer(options.overwriteAnswer ?? null);
    });
    const errors: string[] = [];
    const infos: string[] = [];
    let made = 0;
    const pipeline = createExportPipeline({
        sessions,
        platform,
        storage: {
            load: async (id) => stored.get(id) ?? null,
            save: async (id, record) => void stored.set(id, record),
        },
        dialogs,
        notices: {
            info: (message) => infos.push(message),
            error: (message) => errors.push(message),
        },
        files: { run: (task) => task(), canSave: () => true },
        maker: {
            files: async (project) => {
                made += 1;
                return exportFiles(project);
            },
            zip: async (all) =>
                writeZip(all.map(({ name, bytes }) => ({ name, data: bytes, stored: false }))),
        },
        previewer: async (project) => exportPreview(project),
        stroking: () => sessions.getState().history.transaction !== null,
    });
    return {
        sessions,
        folder,
        stored,
        shown,
        asked,
        errors,
        infos,
        pipeline,
        picks: () => picks,
        /** How often the export's files were made. */
        made: () => made,
        setActivation: (value: boolean) => {
            activation = value;
        },
    };
}

const NAMES = exportFiles(createExportProject()).map((file) => file.name);

/** Exports once through the dialog's Export, so the project has a folder. */
async function withFolder(pipeline: ExportPipeline): Promise<void> {
    expect(await pipeline.exportProject()).toBe(true);
}

describe("Export Again", () => {
    it("writes without the dialog when the project's folder is known and writable", async () => {
        const { pipeline, folder, shown, picks, errors } = setup();
        await withFolder(pipeline);
        folder.writes.length = 0;
        folder.files.delete("level-1.tilemap.json");
        expect(await pipeline.exportAgain()).toBe(true);
        expect(shown).toEqual([]);
        expect(folder.writes).toEqual(["level-1.tilemap.json"]);
        expect(picks()).toBe(1);
        expect(errors).toEqual([]);
    });

    it("opens the dialog when no folder is known, and exports when its Export is pressed", async () => {
        const closed = setup({ dialogAnswer: null });
        expect(await closed.pipeline.exportAgain()).toBe(false);
        expect(closed.shown).toHaveLength(1);
        // Nothing was made for the export the dialog replaced.
        expect(closed.made()).toBe(0);
        expect(closed.picks()).toBe(0);
        expect(closed.folder.writes).toEqual([]);
        expect(closed.errors).toEqual([]);

        const exported = setup({ dialogAnswer: true });
        expect(await exported.pipeline.exportAgain()).toBe(true);
        expect(exported.shown).toHaveLength(1);
        // The dialog's Export chooses the folder, then writes it.
        expect(exported.picks()).toBe(1);
        expect(exported.folder.writes).toEqual(NAMES);
    });

    it("opens the dialog when the folder no longer exists or write permission is refused", async () => {
        const gone = setup();
        await withFolder(gone.pipeline);
        gone.folder.present = false;
        gone.folder.writes.length = 0;
        expect(await gone.pipeline.exportAgain()).toBe(false);
        expect(gone.shown).toHaveLength(1);
        expect(gone.folder.writes).toEqual([]);
        expect(gone.errors).toEqual([]);

        const refused = setup();
        await withFolder(refused.pipeline);
        refused.folder.writable = false;
        refused.folder.grants = false;
        refused.folder.writes.length = 0;
        expect(await refused.pipeline.exportAgain()).toBe(false);
        expect(refused.shown).toHaveLength(1);
        expect(refused.folder.writes).toEqual([]);
    });

    it("finds the folder kept in storage after a reload", async () => {
        const first = setup();
        await withFolder(first.pipeline);
        const second = setup();
        for (const [id, record] of first.stored) second.stored.set(id, record);
        expect(await second.pipeline.exportAgain()).toBe(true);
        expect(second.shown).toEqual([]);
        expect(second.picks()).toBe(0);
    });
});

describe("Export on Save", () => {
    it("does nothing while the setting is off; exports into the folder when it is on", async () => {
        const { pipeline, sessions, folder, errors, infos } = setup();
        await withFolder(pipeline);
        folder.writes.length = 0;
        folder.files.delete("ngne-tilemap.ts");
        await pipeline.exportOnSave();
        expect(folder.writes).toEqual([]);

        setExportOnSave(sessions, true);
        sessions.getState().history.markSaved();
        infos.length = 0;
        await pipeline.exportOnSave();
        expect(folder.writes).toEqual(["ngne-tilemap.ts"]);
        expect(infos).toEqual([`Exported “Export test” to “game”: 1 file written, 8 unchanged`]);
        expect(errors).toEqual([]);
    });

    it("never shows a dialog or asks: no folder, a gone folder and another project's folder are one toast each", async () => {
        const none = setup();
        setExportOnSave(none.sessions, true);
        none.sessions.getState().history.markSaved();
        await none.pipeline.exportOnSave();
        expect(none.shown).toEqual([]);
        expect(none.picks()).toBe(0);
        expect(none.errors).toEqual([
            "Could not export “Export test”. No export folder is chosen yet. Use Export….",
        ]);

        const gone = setup();
        await withFolder(gone.pipeline);
        gone.folder.present = false;
        setExportOnSave(gone.sessions, true);
        gone.sessions.getState().history.markSaved();
        await gone.pipeline.exportOnSave();
        expect(gone.shown).toEqual([]);
        expect(gone.errors).toEqual([
            "Could not export “Export test”. The folder “game” no longer exists. Use Export….",
        ]);

        const foreign = setup({ overwriteAnswer: true });
        await withFolder(foreign.pipeline);
        foreign.folder.files.set(
            "ngne-tilemap.export.json",
            exportMarkerBytes({ id: "another", name: "Other game" }),
        );
        foreign.folder.writes.length = 0;
        setExportOnSave(foreign.sessions, true);
        foreign.sessions.getState().history.markSaved();
        await foreign.pipeline.exportOnSave();
        expect(foreign.asked).toEqual([]);
        expect(foreign.folder.writes).toEqual([]);
        expect(foreign.errors).toHaveLength(1);
        expect(foreign.errors[0]).toContain(
            "The folder “game” of “Other game” holds files this export would replace",
        );
        expect(foreign.errors[0]).toContain("Use Export… to confirm replacing them.");
    });

    it("runs inside the save's file operation; a failed export is one toast and the save stands", async () => {
        const files = fileSetup(createExportProject());
        const handle = files.disk.handle("game.ngtilemap");
        files.platform.toSave.push(handle);
        const exported = setup({ sessions: files.sessions });
        // The pipeline's operations are the file workflows'.
        const pipeline = createExportPipelineOver(exported, files.workflows);
        files.workflows.onSaved(() => pipeline.exportOnSave());
        await withFolder(pipeline);
        setExportOnSave(files.sessions, true);
        exported.folder.writes.length = 0;
        exported.folder.files.delete("grass.png");
        exported.folder.files.delete("level-2.tilemap.json");
        exported.folder.failOn = "level-2.tilemap.json";

        let busyDuringExport: boolean | null = null;
        files.workflows.onSaved(async () => {
            busyDuringExport = files.workflows.busy;
        });
        expect(await files.workflows.save()).toBe(true);
        expect(busyDuringExport).toBe(true);
        // The save stands: the file is written and the project is clean.
        expect(handle.writes).toHaveLength(1);
        expect(files.sessions.getState().history.dirty).toBe(false);
        expect(files.infos).toEqual(["Saved game.ngtilemap"]);
        expect(files.errors).toEqual([]);
        // The export ran after it and failed once.
        expect(exported.folder.writes).toEqual(["grass.png"]);
        expect(exported.errors).toHaveLength(1);
        expect(exported.errors[0]).toContain("writing “level-2.tilemap.json” to “game” failed");
        expect(exported.shown).toEqual([]);
    });

    it("does not export a project edited after its save", async () => {
        const { pipeline, sessions, folder, errors, made } = setup();
        await withFolder(pipeline);
        setExportOnSave(sessions, true);
        const { history, session } = sessions.getState();
        history.markSaved();
        // One cell painted after the save.
        const map = session.project.maps[1]!;
        const transaction = history.begin({ mapId: map.id, layerId: map.layers[0]!.id });
        transaction.set(1, 0, cellValue(2, 0, 0));
        transaction.commit("Paint");
        folder.writes.length = 0;
        const before = made();
        await pipeline.exportOnSave();
        expect(folder.writes).toEqual([]);
        expect(made()).toBe(before);
        expect(errors).toEqual([
            "Could not export “Export test”. It changed after it was saved. Use Export Again.",
        ]);
    });

    it("makes no files when it stops for want of a folder", async () => {
        const { pipeline, sessions, made } = setup();
        setExportOnSave(sessions, true);
        sessions.getState().history.markSaved();
        await pipeline.exportOnSave();
        expect(made()).toBe(0);
    });
});

/** A pipeline over the stores and fakes of `context`, whose operations are `files`'. */
function createExportPipelineOver(
    context: ReturnType<typeof setup>,
    files: { run(task: () => Promise<boolean>): Promise<boolean>; canSave(): boolean },
): ExportPipeline {
    const platform: ExportPlatform = {
        canChooseFolder: () => true,
        chooseFolder: async () => context.folder.handle,
        folderFrom: () => context.folder.handle,
        canChooseFile: () => false,
        chooseFile: async () => null,
        download: () => {},
        hasUserActivation: () => true,
    };
    return createExportPipeline({
        sessions: context.sessions,
        platform,
        storage: { load: async () => null, save: async () => {} },
        dialogs: createExportDialogs(),
        notices: {
            info: (message) => context.infos.push(message),
            error: (message) => context.errors.push(message),
        },
        files,
        maker: {
            files: async (project) => exportFiles(project),
            zip: async () => new Uint8Array(),
        },
        previewer: async (project) => exportPreview(project),
        stroking: () => false,
    });
}

describe("export settings", () => {
    it("Export on save makes the project dirty without a history entry, and clean again when set back", () => {
        const sessions = createSessionStore(createProjectSession(createExportProject()));
        const { history } = sessions.getState();
        const revision = sessions.getState().revision;
        const position = history.position;
        expect(history.dirty).toBe(false);

        expect(setExportOnSave(sessions, true)).toBe(true);
        expect(sessions.getState().session.project.exportSettings.exportOnSave).toBe(true);
        expect(history.dirty).toBe(true);
        expect(history.canUndo).toBe(false);
        expect(history.position).toBe(position);
        // Subscribers (the tab's dirty mark, autosave) are told.
        expect(sessions.getState().revision).toBeGreaterThan(revision);

        expect(setExportOnSave(sessions, true)).toBe(false);
        expect(setExportOnSave(sessions, false)).toBe(true);
        expect(history.dirty).toBe(false);
        expect(history.canUndo).toBe(false);
    });

    it("a save records the setting: the project is clean until it changes again", () => {
        const sessions = createSessionStore(createProjectSession(createExportProject()));
        const { history } = sessions.getState();
        setExportOnSave(sessions, true);
        history.markSaved();
        expect(history.dirty).toBe(false);
        setExportOnSave(sessions, false);
        expect(history.dirty).toBe(true);
    });
});
