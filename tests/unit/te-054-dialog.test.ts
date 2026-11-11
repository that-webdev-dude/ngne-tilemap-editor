import { describe, expect, it } from "vitest";
import { createExportDialogs } from "../../src/app/export/dialogs";
import type { ExportDialogRequest, ExportPreviewState } from "../../src/app/export/dialogs";
import { createExportPipeline } from "../../src/app/export/exportProject";
import type { ExportFolderHandle, ExportPlatform } from "../../src/app/platform/exportFiles";
import { createSessionStore } from "../../src/app/state/session";
import {
    EXPORT_FILE_GROUPS,
    exportFileGroup,
    exportFiles,
    exportPreview,
} from "../../src/core/export";
import type { ExportPreview } from "../../src/core/export";
import { createProjectSession } from "../../src/core/model";
import type { Project } from "../../src/core/model";
import { createExportProject } from "../support/exportProject";

// TE-054: what the Export dialog shows (`core/export` `exportPreview`) and what its request
// does (`app/export/exportProject.ts`): the files of the plan with their sizes by group, each
// packed tileset, the failure that keeps a project from being exported, the export name as an
// undo step, Export on save as a setting with no history entry, the folder picker.

/** Waits until `check` holds, a microtask at a time. */
async function until(check: () => boolean): Promise<void> {
    for (let turn = 0; turn < 1000 && !check(); turn += 1) await Promise.resolve();
    expect(check()).toBe(true);
}

describe("export preview", () => {
    it("lists every file of the plan in write order with its size, each in its group", () => {
        const project = createExportProject();
        const files = exportFiles(project);
        const preview = exportPreview(project);
        expect(preview.files).toEqual(
            files.map((file) => ({ name: file.name, kind: file.kind, size: file.bytes.length })),
        );
        const grouped = Object.fromEntries(
            EXPORT_FILE_GROUPS.map((group) => [
                group,
                preview.files
                    .filter((file) => exportFileGroup(file.kind) === group)
                    .map((file) => file.name),
            ]),
        );
        expect(grouped).toEqual({
            tilemaps: ["level-1.tilemap.json", "level-2.tilemap.json"],
            tilesets: ["grass.png", "rocks.png", "grass.atlas.json", "rocks.atlas.json"],
            images: ["sky.png"],
            runtime: ["ngne-tilemap.export.json", "ngne-tilemap.ts"],
        });
    });

    it("has each packed tileset: its PNG as written, its size and one rectangle per distinct tile", () => {
        const project = createExportProject();
        const files = new Map(exportFiles(project).map((file) => [file.name, file.bytes]));
        const preview = exportPreview(project);
        expect(preview.atlases.map((atlas) => atlas.name)).toEqual(
            project.tilesets.map((tileset) => tileset.exportName),
        );
        for (const atlas of preview.atlases) {
            expect(atlas.png).toEqual(files.get(`${atlas.name}.png`));
            const json = JSON.parse(
                new TextDecoder().decode(files.get(`${atlas.name}.atlas.json`)),
            ) as { width: number; height: number; frames: Record<string, object> };
            expect([atlas.width, atlas.height]).toEqual([json.width, json.height]);
            const distinct = new Set(
                Object.values(json.frames).map((frame) => {
                    const { x, y, w, h } = frame as { x: number; y: number; w: number; h: number };
                    return `${x},${y},${w},${h}`;
                }),
            );
            expect(atlas.rects).toHaveLength(distinct.size);
        }
        // "Grass" has two tiles with the same pixels: they share one rectangle.
        const grass = project.tilesets[0]!;
        expect(preview.atlases[0]!.rects.length).toBe(grass.tiles.length - 1);
    });
});

interface Dialog {
    request: ExportDialogRequest;
    preview: () => ExportPreviewState;
}

/** The pipeline on the TE-053 project with the Export dialog held open for the test. */
function setup(options: { previewer?: (project: Project) => Promise<ExportPreview> } = {}) {
    const sessions = createSessionStore(createProjectSession(createExportProject()));
    let picks = 0;
    const folder: ExportFolderHandle = {
        name: "game",
        stored: {},
        canWrite: async () => true,
        requestWrite: async () => true,
        existing: async () => [],
        read: async () => null,
        write: async () => {},
        exists: async () => true,
    };
    const platform: ExportPlatform = {
        canChooseFolder: () => true,
        chooseFolder: async () => {
            picks += 1;
            return folder;
        },
        folderFrom: () => null,
        download: () => {},
        hasUserActivation: () => true,
    };
    const dialogs = createExportDialogs();
    dialogs.attachHost();
    let open: ExportDialogRequest | null = null;
    dialogs.exportStore.subscribe(({ request }) => {
        open = request;
    });
    const previews: number[] = [];
    const pipeline = createExportPipeline({
        sessions,
        platform,
        storage: { load: async () => null, save: async () => {} },
        dialogs,
        notices: { info: () => {}, error: () => {} },
        files: { run: (task) => task(), canSave: () => true },
        maker: {
            snapshot: (project) => async () => exportFiles(project),
            zip: async () => new Uint8Array(),
        },
        previewer:
            options.previewer ??
            (async (project) => {
                previews.push(sessions.getState().history.position);
                return exportPreview(project);
            }),
        stroking: () => false,
    });
    const shown = async (): Promise<Dialog> => {
        await until(() => open !== null);
        const request = open!;
        return { request, preview: () => request.preview.getState() };
    };
    return { sessions, pipeline, shown, previews, picks: () => picks };
}

describe("Export dialog request", () => {
    it("shows the preview of the project as it is, and makes it again after each change", async () => {
        const { sessions, pipeline, shown, previews } = setup();
        const result = pipeline.exportWithDialog();
        const { request, preview } = await shown();
        expect(request.projectId).toBe("export-project");
        await until(() => preview().status === "ready");
        const ready = preview() as Extract<ExportPreviewState, { status: "ready" }>;
        expect(ready.preview).toEqual(exportPreview(sessions.getState().session.project));

        // A view change makes nothing; the export name, an undo step, makes it again.
        sessions.getState().touch();
        expect(previews).toHaveLength(1);
        expect(request.setExportName("my-game")).toBeNull();
        const { history, session } = sessions.getState();
        expect(session.project.exportName).toBe("my-game");
        expect(history.canUndo).toBe(true);
        expect(previews).toHaveLength(2);
        await until(() => preview().status === "ready");

        request.answer(null);
        expect(await result).toBe(false);
    });

    it("refuses an export name that is no slug, leaving the project as it was", async () => {
        const { sessions, pipeline, shown } = setup();
        const result = pipeline.exportWithDialog();
        const { request } = await shown();
        expect(request.setExportName("Not a slug")).toMatch(/^An export name is 1 to 64/);
        expect(request.setExportName("ngne-tilemap")).toMatch(/^An export name is 1 to 64/);
        expect(sessions.getState().session.project.exportName).toBe("export-test");
        expect(sessions.getState().history.canUndo).toBe(false);
        // Unchanged: no entry.
        expect(request.setExportName("export-test")).toBeNull();
        expect(sessions.getState().history.canUndo).toBe(false);
        request.answer(null);
        await result;
    });

    it("sets Export on save without a history entry; the project becomes dirty", async () => {
        const { sessions, pipeline, shown } = setup();
        const result = pipeline.exportWithDialog();
        const { request } = await shown();
        request.setExportOnSave(true);
        const { history, session } = sessions.getState();
        expect(session.project.exportSettings.exportOnSave).toBe(true);
        expect(history.dirty).toBe(true);
        expect(history.canUndo).toBe(false);
        request.answer(null);
        // Close keeps it.
        expect(await result).toBe(false);
        expect(sessions.getState().session.project.exportSettings.exportOnSave).toBe(true);
    });

    it("chooses the folder with the picker and shows its name", async () => {
        const { pipeline, shown, picks } = setup();
        const result = pipeline.exportWithDialog();
        const { request } = await shown();
        expect(request.destination.getState()).toEqual({
            mode: "folder",
            folder: null,
            choosing: false,
        });
        request.chooseFolder();
        await until(() => request.destination.getState().folder === "game");
        expect(request.destination.getState().choosing).toBe(false);
        expect(picks()).toBe(1);
        expect(pipeline.folderOf("export-project")).toBe("game");
        // Export writes into it without asking for another.
        request.answer(true);
        expect(await result).toBe(true);
        expect(picks()).toBe(1);
    });

    it("shows the failure that keeps the project from being exported", async () => {
        const { pipeline, shown } = setup({
            previewer: async () => {
                throw new Error("Tileset “Grass” does not fit in 8192 × 8192 px.");
            },
        });
        const result = pipeline.exportWithDialog();
        const { request, preview } = await shown();
        await until(() => preview().status === "failed");
        expect(preview()).toEqual({
            status: "failed",
            error: "Tileset “Grass” does not fit in 8192 × 8192 px.",
        });
        request.answer(null);
        await result;
    });
});
