import { describe, expect, it } from "vitest";
import { createExportDialogs } from "../../src/app/export/dialogs";
import { createExportPipeline, workerExportMaker } from "../../src/app/export/exportProject";
import type { ExportMaker } from "../../src/app/export/exportProject";
import type { ExportFolderHandle, ExportPlatform } from "../../src/app/platform/exportFiles";
import { PreviewSource } from "../../src/app/preview/previewSource";
import { createSessionStore } from "../../src/app/state/session";
import type { WorkerClient } from "../../src/app/worker/client";
import { cellSlot, cellTileId, cellValue } from "../../src/core/cells";
import { writeZip } from "../../src/core/codec";
import { exportFiles, exportPreview } from "../../src/core/export";
import type { ExportFile, ExportPreview } from "../../src/core/export";
import { History, cellPatchCommand } from "../../src/core/history";
import { createProjectSession, walkLayers } from "../../src/core/model";
import type { Project, ProjectMap, TileLayer, Tileset } from "../../src/core/model";
import { packTileset } from "../../src/core/pack";
import { projectFromWire, projectToWire } from "../../src/core/project";
import type { ProjectWire } from "../../src/core/project";
import type { PreviewContent } from "../../src/engine/preview";
import { createConformanceProject } from "../support/conformanceProject";
import { createExportProject } from "../support/exportProject";

// The M7 review findings (cleanup): the preview plays only the animations its map places
// (ENGINE §4, redraw on demand); Export Again exports the project as of the moment it starts
// (SPEC §10.2); the Export dialog's Export writes the files its preview made.

/** Lets pending promises and timers of zero delay run. */
async function settle(): Promise<void> {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** A promise and the function that resolves it. */
function gate(): { promise: Promise<void>; open(): void } {
    let open = () => {};
    const promise = new Promise<void>((resolve) => {
        open = resolve;
    });
    return { promise, open };
}

describe("the preview's animations (ENGINE §4, redraw on demand)", () => {
    const MAP = "layers";

    /** The tile IDs of `tileset` that the visible tile layers of `map` place. */
    function placed(map: ProjectMap, tileset: Tileset): Set<number> {
        const ids = new Set<number>();
        for (const { layer, ancestors } of walkLayers(map.layers)) {
            if (layer.type !== "tile") continue;
            if (!layer.visible || ancestors.some((group) => !group.visible)) continue;
            for (let y = 0; y < map.height; y += 1) {
                for (let x = 0; x < map.width; x += 1) {
                    const value = layer.cells.get(x, y);
                    if (value !== 0 && cellSlot(value) === tileset.slot) {
                        ids.add(cellTileId(value));
                    }
                }
            }
        }
        return ids;
    }

    async function source(project: Project) {
        const map = project.maps.find((each) => each.exportName === MAP)!;
        const history = new History(createProjectSession(project));
        const contents: (PreviewContent | null)[] = [];
        let cells = 0;
        const preview = new PreviewSource({
            pack: async (tileset) => packTileset(tileset),
            onContent: (content) => contents.push(content),
            onCells: () => (cells += 1),
            onError: (message) => {
                throw new Error(message);
            },
        });
        history.subscribe(({ touched }) => preview.touched(touched));
        preview.show(project, map.id);
        await settle();
        return { map, history, contents, cells: () => cells };
    }

    it("leaves out an animated tile no visible layer places", async () => {
        const project = createConformanceProject();
        const map = project.maps.find((each) => each.exportName === MAP)!;
        const even = project.tilesets.find((tileset) => tileset.exportName === "even")!;
        const used = placed(map, even);
        const unused = even.tiles.find((tile) => !used.has(tile.id))!;
        expect(unused).toBeDefined();
        unused.animation = [
            { tile: 0, ms: 150 },
            { tile: 1, ms: 150 },
        ];
        const { contents } = await source(project);
        // The tileset is listed (its other tiles are placed), its unplaced animation is not.
        expect(contents.at(-1)!.tilemap.tilesets.map((each) => each.name)).toContain("even");
        expect(contents.at(-1)!.animations).toEqual([]);
    });

    it("adds the animation of a tile a command places, with the cells written in place", async () => {
        const project = createConformanceProject();
        const map = project.maps.find((each) => each.exportName === MAP)!;
        const even = project.tilesets.find((tileset) => tileset.exportName === "even")!;
        const used = placed(map, even);
        const unused = even.tiles.find((tile) => !used.has(tile.id))!;
        unused.animation = [
            { tile: 0, ms: 100 },
            { tile: 1, ms: 250 },
        ];
        const h = await source(project);
        const content = h.contents.at(-1)!;
        expect(content.animations).toEqual([]);

        const ground = map.layers.find((layer) => layer.name === "Ground") as TileLayer;
        const words = new Uint32Array([0, ground.cells.get(0, 0), cellValue(even.slot, unused.id)]);
        h.history.execute(
            cellPatchCommand({
                label: "Stamp Brush",
                mapId: map.id,
                layerId: ground.id,
                width: map.width,
                words,
                cellRect: { x: 0, y: 0, width: 1, height: 1 },
            }),
        );
        // Written in place: the same content, now with the tile's animation.
        expect(h.cells()).toBe(1);
        expect(h.contents.at(-1)).toBe(content);
        expect(content.animations).toEqual([[100, 250]]);
    });
});

/** A folder in memory whose `exists` waits for `checked` when it is set. */
function memoryFolder() {
    const files = new Map<string, Uint8Array>();
    const writes: string[] = [];
    const folder = {
        files,
        writes,
        checked: null as Promise<void> | null,
        handle: {
            name: "game",
            stored: { memory: "game" },
            canWrite: async () => true,
            requestWrite: async () => true,
            existing: async (names: readonly string[]) => names.filter((each) => files.has(each)),
            read: async (file: string) => files.get(file) ?? null,
            async write(file: string, bytes: Uint8Array<ArrayBuffer>) {
                writes.push(file);
                files.set(file, bytes.slice());
            },
            async exists() {
                await folder.checked;
                return true;
            },
        } satisfies ExportFolderHandle,
    };
    return folder;
}

/** A copy of `project` that shares nothing with it, as the worker maker's snapshot. */
function copyOf(project: Project): Project {
    return projectFromWire(structuredClone(projectToWire(project)));
}

function pipelineSetup(previewer?: (project: Project) => Promise<ExportPreview>) {
    const sessions = createSessionStore(createProjectSession(createExportProject()));
    const folder = memoryFolder();
    const platform: ExportPlatform = {
        canChooseFolder: () => true,
        chooseFolder: async () => folder.handle,
        folderFrom: () => folder.handle,
        download: () => {},
        hasUserActivation: () => true,
    };
    let runs = 0;
    const maker: ExportMaker = {
        snapshot(project) {
            const copy = copyOf(project);
            return async () => {
                runs += 1;
                return exportFiles(copy);
            };
        },
        zip: async (all) =>
            writeZip(all.map(({ name, bytes }) => ({ name, data: bytes, stored: false }))),
    };
    const dialogs = createExportDialogs();
    dialogs.attachHost();
    const errors: string[] = [];
    const pipeline = createExportPipeline({
        sessions,
        platform,
        storage: { load: async () => null, save: async () => {} },
        dialogs,
        notices: { info: () => {}, error: (message) => errors.push(message) },
        files: { run: (task) => task(), canSave: () => true },
        maker,
        previewer: previewer ?? (async (project) => exportPreview(project)),
        stroking: () => sessions.getState().history.transaction !== null,
    });
    return { sessions, folder, dialogs, pipeline, errors, runs: () => runs };
}

/** Paints one cell of the second map: an edit with a history step. */
function paint(sessions: ReturnType<typeof pipelineSetup>["sessions"]): void {
    const { history, session } = sessions.getState();
    const map = session.project.maps[1]!;
    const transaction = history.begin({ mapId: map.id, layerId: map.layers[0]!.id });
    transaction.set(1, 0, cellValue(2, 0));
    transaction.commit("Paint");
}

describe("Export Again (SPEC §10.2: the project as of the moment it starts)", () => {
    it("does not export an edit made while it looks for its folder", async () => {
        const { sessions, folder, pipeline, errors } = pipelineSetup();
        expect(await pipeline.exportProject()).toBe(true);
        const before = exportFiles(copyOf(sessions.getState().session.project));
        folder.writes.length = 0;

        const checked = gate();
        folder.checked = checked.promise;
        const exporting = pipeline.exportAgain();
        await settle();
        // Edited after Export Again started, before the folder is settled.
        paint(sessions);
        checked.open();
        expect(await exporting).toBe(true);
        expect(errors).toEqual([]);
        for (const file of before) expect(folder.files.get(file.name)).toEqual(file.bytes);
    });

    it("takes the worker's snapshot when the export starts, and runs it later", async () => {
        const project = createExportProject();
        const expected = exportFiles(createExportProject());
        let sent: ProjectWire | null = null;
        const worker = {
            workersStarted: 0,
            dispose: () => {},
            async run(task: string, input: { project: ProjectWire }) {
                expect(task).toBe("export.files");
                sent = input.project;
                return [] as ExportFile[];
            },
        } as unknown as WorkerClient;
        const run = workerExportMaker(worker).snapshot(project);
        // A change after the snapshot, before the worker runs, does not reach it.
        (project.maps[0]!.layers[1] as TileLayer).cells.set(0, 0, 0);
        project.name = "Renamed";
        expect(sent).toBeNull();
        await run();
        const files = exportFiles(projectFromWire(structuredClone(sent!)));
        expect(files.map((file) => file.bytes)).toEqual(expected.map((file) => file.bytes));
    });
});

describe("Export dialog: Export writes the files its preview made", () => {
    it("makes no files again when the project did not change since the preview", async () => {
        let previews = 0;
        const { sessions, folder, dialogs, pipeline, runs } = pipelineSetup(async (project) => {
            previews += 1;
            return exportPreview(project);
        });
        dialogs.exportStore.subscribe(({ request }) => {
            // Export at once, while the preview is still being made.
            if (request) request.answer(true);
        });
        expect(await pipeline.exportWithDialog()).toBe(true);
        expect(previews).toBe(1);
        expect(runs()).toBe(0);
        const expected = exportFiles(copyOf(sessions.getState().session.project));
        expect(folder.writes).toEqual(expected.map((file) => file.name));
        for (const file of expected) expect(folder.files.get(file.name)).toEqual(file.bytes);
    });

    it("writes the preview of the newest change", async () => {
        let previews = 0;
        const { sessions, folder, dialogs, pipeline, runs } = pipelineSetup(async (project) => {
            previews += 1;
            return exportPreview(project);
        });
        dialogs.exportStore.subscribe(({ request }) => {
            if (!request) return;
            expect(request.setExportName("renamed-game")).toBeNull();
            request.answer(true);
        });
        expect(await pipeline.exportWithDialog()).toBe(true);
        expect(previews).toBe(2);
        expect(runs()).toBe(0);
        expect(sessions.getState().session.project.exportName).toBe("renamed-game");
        const expected = exportFiles(copyOf(sessions.getState().session.project));
        for (const file of expected) expect(folder.files.get(file.name)).toEqual(file.bytes);
    });
});
