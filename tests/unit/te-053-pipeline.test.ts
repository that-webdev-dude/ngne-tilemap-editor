import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createExportDialogs } from "../../src/app/export/dialogs";
import type { ExportOverwriteRequest } from "../../src/app/export/dialogs";
import { createExportPipeline, workerExportMaker } from "../../src/app/export/exportProject";
import type { ExportMaker } from "../../src/app/export/exportProject";
import type { StoredExportFolder } from "../../src/app/export/exportFolders";
import type { ExportFolderHandle, ExportPlatform } from "../../src/app/platform/exportFiles";
import { createSessionStore } from "../../src/app/state/session";
import type { WorkerClient } from "../../src/app/worker/client";
import { writeZip } from "../../src/core/codec";
import { exportFiles, exportMarkerBytes } from "../../src/core/export";
import type { ExportFile } from "../../src/core/export";
import { cellValue } from "../../src/core/cells";
import { createProjectSession } from "../../src/core/model";
import { projectFromWire } from "../../src/core/project";
import type { ProjectWire } from "../../src/core/project";
import type { TileLayer } from "../../src/core/model";
import { createExportProject } from "../support/exportProject";

// TE-053: the export pipeline of SPEC §10.2 (`app/export/exportProject.ts`) with a folder in
// memory: write order, unchanged files not written again, nothing removed, the question before
// another project's folder, one toast for a failed write, the zip without File System Access,
// a stroke in progress.

/** A folder in memory that logs every write and can be told to fail one. */
function memoryFolder(name = "game") {
    const files = new Map<string, Uint8Array>();
    const writes: string[] = [];
    const folder = {
        failOn: null as string | null,
        files,
        writes,
        handle: {
            name,
            stored: { memory: name },
            canWrite: async () => true,
            requestWrite: async () => true,
            existing: async (names: readonly string[]) => names.filter((each) => files.has(each)),
            read: async (file: string) => files.get(file) ?? null,
            async write(file: string, bytes: Uint8Array<ArrayBuffer>) {
                if (folder.failOn === file) throw new Error("The disk is full.");
                writes.push(file);
                files.set(file, bytes.slice());
            },
            exists: async () => true,
        } satisfies ExportFolderHandle,
    };
    return folder;
}

interface Setup {
    folderApi?: boolean;
    answer?: true | null;
    stroking?: boolean;
}

function setup(options: Setup = {}) {
    const project = createExportProject();
    const sessions = createSessionStore(createProjectSession(project));
    const folder = memoryFolder();
    const downloads: { name: string; bytes: Uint8Array }[] = [];
    let picks = 0;
    const platform: ExportPlatform = {
        canChooseFolder: () => options.folderApi ?? true,
        chooseFolder: async () => {
            picks += 1;
            return folder.handle;
        },
        folderFrom: (stored) =>
            (stored as { memory?: string }).memory === folder.handle.name ? folder.handle : null,
        download: (name, bytes) => downloads.push({ name, bytes }),
        hasUserActivation: () => true,
    };
    const stored = new Map<string, StoredExportFolder>();
    const dialogs = createExportDialogs();
    dialogs.attachHost();
    const asked: ExportOverwriteRequest[] = [];
    dialogs.store.subscribe(({ request }) => {
        if (!request) return;
        asked.push(request);
        request.answer(options.answer ?? null);
    });
    const errors: string[] = [];
    const infos: string[] = [];
    const maker: ExportMaker = {
        snapshot: (project) => async () => exportFiles(project),
        zip: async (all) =>
            writeZip(all.map(({ name, bytes }) => ({ name, data: bytes, stored: false }))),
    };
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
        maker,
        stroking: () => options.stroking ?? false,
    });
    return {
        project,
        sessions,
        folder,
        downloads,
        stored,
        asked,
        errors,
        infos,
        pipeline,
        picks: () => picks,
    };
}

const NAMES = exportFiles(createExportProject()).map((file) => file.name);

describe("export pipeline", () => {
    it("writes every file in order on the first export and keeps the folder per project", async () => {
        const { folder, pipeline, errors, infos, stored, picks, asked } = setup();
        expect(await pipeline.exportProject()).toBe(true);
        expect(folder.writes).toEqual(NAMES);
        expect(errors).toEqual([]);
        expect(asked).toEqual([]);
        expect(infos).toEqual([`Exported “Export test” to “game”: 9 files written, 0 unchanged`]);
        expect(stored.get("export-project")).toEqual({ folder: { memory: "game" } });
        expect(pipeline.folderOf("export-project")).toBe("game");
        expect(picks()).toBe(1);
    });

    it("rewrites only the edited map's JSON after one cell edit, and removes nothing", async () => {
        const { folder, pipeline, sessions, infos, picks } = setup();
        await pipeline.exportProject();
        folder.files.set("old-map.tilemap.json", new Uint8Array([1]));
        folder.writes.length = 0;
        const { session, history } = sessions.getState();
        const map = session.project.maps[1]!;
        const transaction = history.begin({ mapId: map.id, layerId: map.layers[0]!.id });
        transaction.set(1, 0, cellValue(2, 0, 0));
        transaction.commit("Paint");
        expect(await pipeline.exportProject()).toBe(true);
        expect(folder.writes).toEqual(["level-2.tilemap.json"]);
        expect(folder.files.has("old-map.tilemap.json")).toBe(true);
        expect(infos.at(-1)).toBe(`Exported “Export test” to “game”: 1 file written, 8 unchanged`);
        // The folder is known: no picker the second time.
        expect(picks()).toBe(1);
    });

    it("exports the project as it was when the export started", async () => {
        const { folder, pipeline, sessions } = setup();
        const expected = exportFiles(createExportProject());
        const running = pipeline.exportProject();
        // A change after the start does not reach this export.
        const { session } = sessions.getState();
        (session.project.maps[0]!.layers[1] as TileLayer).cells.set(0, 0, 0);
        session.project.name = "Renamed";
        expect(await running).toBe(true);
        for (const file of expected) expect(folder.files.get(file.name)).toEqual(file.bytes);
    });

    it("asks Replace / Cancel naming the project whose marker the folder holds; Cancel writes nothing", async () => {
        const { folder, pipeline, asked, errors } = setup({ answer: null });
        folder.files.set(
            "ngne-tilemap.export.json",
            exportMarkerBytes({ id: "other", name: "Other game" }),
        );
        expect(await pipeline.exportProject()).toBe(false);
        expect(asked).toHaveLength(1);
        expect(asked[0]).toMatchObject({
            project: "Export test",
            folder: "game",
            owner: "Other game",
            files: ["ngne-tilemap.export.json"],
        });
        expect(folder.writes).toEqual([]);
        expect(errors).toEqual([]);
    });

    it("replaces another project's folder on Replace, then asks no more", async () => {
        const { folder, pipeline, asked } = setup({ answer: true });
        folder.files.set(
            "ngne-tilemap.export.json",
            exportMarkerBytes({ id: "other", name: "Other game" }),
        );
        folder.files.set("grass.png", new Uint8Array([9]));
        expect(await pipeline.exportProject()).toBe(true);
        expect(asked[0]!.files).toEqual(["ngne-tilemap.export.json", "grass.png"]);
        expect(folder.writes).toEqual(NAMES);
        expect(await pipeline.exportProject()).toBe(true);
        expect(asked).toHaveLength(1);
    });

    it("asks about files of the export's names without a marker, naming no project", async () => {
        const { folder, pipeline, asked } = setup({ answer: null });
        folder.files.set("level-1.tilemap.json", new Uint8Array([1]));
        folder.files.set("unrelated.txt", new Uint8Array([1]));
        expect(await pipeline.exportProject()).toBe(false);
        expect(asked[0]).toMatchObject({ owner: null, files: ["level-1.tilemap.json"] });
    });

    it("asks nothing for a folder with only other files", async () => {
        const { folder, pipeline, asked } = setup();
        folder.files.set("readme.txt", new Uint8Array([1]));
        expect(await pipeline.exportProject()).toBe(true);
        expect(asked).toEqual([]);
        expect(folder.files.get("readme.txt")).toEqual(new Uint8Array([1]));
    });

    it("stops at a failed write with one toast naming the file and those written before it", async () => {
        const { folder, pipeline, errors, infos } = setup();
        folder.failOn = "grass.atlas.json";
        expect(await pipeline.exportProject()).toBe(false);
        expect(folder.writes).toEqual(NAMES.slice(0, 4));
        expect(errors).toEqual([
            "Could not export “Export test”: writing “grass.atlas.json” to “game” failed: " +
                "The disk is full. Written before it: ngne-tilemap.export.json, grass.png, " +
                "rocks.png, sky.png.",
        ]);
        expect(infos).toEqual([]);
    });

    it("names no file before a first file that fails", async () => {
        const { folder, pipeline, errors } = setup();
        folder.failOn = "ngne-tilemap.export.json";
        expect(await pipeline.exportProject()).toBe(false);
        expect(errors[0]).toMatch(/Nothing was written before it\.$/);
    });

    it("downloads <exportName>.zip with the same files without File System Access", async () => {
        const { downloads, pipeline, infos, picks } = setup({ folderApi: false });
        expect(await pipeline.exportProject()).toBe(true);
        expect(downloads.map((each) => each.name)).toEqual(["export-test.zip"]);
        const entries = unzipSync(downloads[0]!.bytes);
        const expected = exportFiles(createExportProject());
        expect(Object.keys(entries)).toEqual(expected.map((file) => file.name));
        for (const file of expected) expect(entries[file.name]).toEqual(file.bytes);
        expect(infos).toEqual(["Exported 9 files to “export-test.zip”"]);
        expect(picks()).toBe(0);
    });

    it("does not start during a stroke", async () => {
        const { folder, pipeline, errors, picks } = setup({ stroking: true });
        expect(pipeline.canExport()).toBe(false);
        expect(await pipeline.exportProject()).toBe(false);
        expect(errors).toEqual(["Could not export “Export test”. A stroke is in progress."]);
        expect(folder.writes).toEqual([]);
        expect(picks()).toBe(0);
    });

    it("fails naming the tileset that cannot be packed, writing nothing", async () => {
        const { folder, errors, sessions } = setup();
        const grass = sessions.getState().session.project.tilesets[0]!;
        const maker: ExportMaker = {
            snapshot: () => async () => {
                throw new Error(`Tileset "${grass.name}" cannot be packed: too large.`);
            },
            zip: async () => new Uint8Array(),
        };
        const failing = createExportPipeline({
            sessions,
            platform: {
                canChooseFolder: () => true,
                chooseFolder: async () => folder.handle,
                folderFrom: () => null,
                download: () => {},
                hasUserActivation: () => true,
            },
            storage: { load: async () => null, save: async () => {} },
            dialogs: createExportDialogs(),
            notices: { info: () => {}, error: (message) => errors.push(message) },
            files: { run: (task) => task(), canSave: () => true },
            maker,
            stroking: () => false,
        });
        expect(await failing.exportProject()).toBe(false);
        expect(errors).toEqual([
            'Could not export “Export test”. Tileset "Grass" cannot be packed: too large.',
        ]);
        expect(folder.writes).toEqual([]);
    });

    it("writes nothing when the folder picker is cancelled", async () => {
        const errors: string[] = [];
        const infos: string[] = [];
        const cancelled = createExportPipeline({
            sessions: createSessionStore(createProjectSession(createExportProject())),
            platform: {
                canChooseFolder: () => true,
                chooseFolder: async () => null,
                folderFrom: () => null,
                download: () => {},
                hasUserActivation: () => true,
            },
            storage: { load: async () => null, save: async () => {} },
            dialogs: createExportDialogs(),
            notices: {
                info: (message) => infos.push(message),
                error: (message) => errors.push(message),
            },
            files: { run: (task) => task(), canSave: () => true },
            maker: {
                snapshot: (project) => async () => exportFiles(project),
                zip: async () => new Uint8Array(),
            },
            stroking: () => false,
        });
        expect(await cancelled.exportProject()).toBe(false);
        expect(errors).toEqual([]);
        expect(infos).toEqual([]);
    });

    it("stops for an open transaction of the project's history by default", async () => {
        const sessions = createSessionStore(createProjectSession(createExportProject()));
        const errors: string[] = [];
        let made = 0;
        const pipeline = createExportPipeline({
            sessions,
            platform: {
                canChooseFolder: () => false,
                chooseFolder: async () => null,
                folderFrom: () => null,
                download: () => {},
                hasUserActivation: () => true,
            },
            storage: { load: async () => null, save: async () => {} },
            dialogs: createExportDialogs(),
            notices: { info: () => {}, error: (message) => errors.push(message) },
            files: { run: (task) => task(), canSave: () => true },
            maker: {
                snapshot: (project) => async () => {
                    made += 1;
                    return exportFiles(project);
                },
                zip: async () => new Uint8Array(),
            },
        });
        expect(pipeline.canExport()).toBe(true);
        const { session, history } = sessions.getState();
        const map = session.project.maps[1]!;
        const transaction = history.begin({ mapId: map.id, layerId: map.layers[0]!.id });
        expect(pipeline.canExport()).toBe(false);
        expect(await pipeline.exportProject()).toBe(false);
        expect(errors).toEqual(["Could not export “Export test”. A stroke is in progress."]);
        expect(made).toBe(0);
        transaction.abort();
        expect(await pipeline.exportProject()).toBe(true);
        expect(made).toBe(1);
    });
});

describe("worker export maker", () => {
    it("hands the worker a snapshot taken at the call, leaving the project's buffers in place", async () => {
        const project = createExportProject();
        const expected = exportFiles(createExportProject());
        let sent: { input: ProjectWire; transfer: Transferable[] } | null = null;
        const worker = {
            workersStarted: 0,
            dispose: () => {},
            async run(
                task: string,
                input: { project: ProjectWire },
                options?: { transfer?: Transferable[] },
            ) {
                expect(task).toBe("export.files");
                sent = { input: input.project, transfer: options?.transfer ?? [] };
                return [] as ExportFile[];
            },
        } as unknown as WorkerClient;
        await workerExportMaker(worker).snapshot(project)();
        const { input, transfer } = sent!;
        // A change after the call does not reach the snapshot.
        const ground = project.maps[0]!.layers[1] as TileLayer;
        ground.cells.set(0, 0, 0);
        project.tilesets[0]!.pixels.data.fill(0);
        project.name = "Renamed";
        const snapshot = projectFromWire(structuredClone(input));
        expect(exportFiles(snapshot).map((file) => file.bytes)).toEqual(
            expected.map((file) => file.bytes),
        );
        // What is transferred is the snapshot's, never the live project's.
        const live = new Set<ArrayBufferLike>([
            ...project.tilesets.map((tileset) => tileset.pixels.data.buffer),
            ...project.images.map((image) => image.pixels.data.buffer),
        ]);
        expect(transfer.length).toBeGreaterThan(0);
        for (const buffer of transfer) expect(live.has(buffer as ArrayBuffer)).toBe(false);
    });
});
