import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionStore } from "../../src/app/state/session";
import { forgetGrid } from "../../src/app/tilesets/import/importForm";
import { createImportSession } from "../../src/app/tilesets/import/importSession";
import { readImportSource } from "../../src/app/tilesets/import/importSources";
import type { ImportSession } from "../../src/app/tilesets/import/importSession";
import type { ImportSource, PickedFile } from "../../src/app/tilesets/import/importSources";
import type { WorkerClient } from "../../src/app/worker/client";
import { WorkerError } from "../../src/app/worker/protocol";
import { workerTasks } from "../../src/app/worker/taskTable";
import type { TilesetImportInput } from "../../src/app/worker/tasks/tileset.task";
import { createProject, createProjectSession } from "../../src/core/model";
import {
    TilesetImportError,
    importAtlas,
    importGridPng,
    planAtlas,
    readAtlasJson,
    readAtlasOutline,
    readPngSize,
    readSpriteOutline,
} from "../../src/core/tileset";
import { decodePng } from "../../src/core/sprite/png";
import { atlasJson, png, pngHeader, positionImage } from "./te-022-support";

// TE-024: the import dialog's session against a fake worker (what it asks of the worker, and
// when: nothing while the plan refuses), the files it reads into a source, and the atlas plan
// the dialog shows before any pixel is decoded.

const FIXTURES = new URL("../fixtures/sprite/", import.meta.url);
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(name, FIXTURES)));

const file = (name: string, bytes: Uint8Array): PickedFile => ({ name, read: async () => bytes });

/** A worker that runs the tasks in this thread and records them. */
function fakeWorker() {
    const tasks: string[] = [];
    const run = vi.fn(async (task: string, input: unknown) => {
        tasks.push(task);
        if (task === "png.decode") return decodePng((input as { bytes: Uint8Array }).bytes);
        if (task === "tileset.import") {
            const request = input as TilesetImportInput;
            if (request.kind !== "image") throw new Error(`unexpected ${request.kind}`);
            return importGridPng(createProject(), request.bytes, request.options);
        }
        throw new Error(`unexpected task ${task}`);
    });
    return { tasks, worker: { run } as unknown as Pick<WorkerClient, "run"> };
}

/** Waits until the session has the pane's pixels, or why not. */
const settle = (session: ImportSession) =>
    vi.waitFor(() => expect(session.store.getState().loadingPixels).toBe(false));

beforeEach(() => {
    sessionStore.getState().replace(createProjectSession(createProject()));
    forgetGrid();
});

describe("the import session", () => {
    it("sends nothing to the worker for a PNG above the pixel limits", async () => {
        const source: ImportSource = {
            kind: "image",
            fileName: "huge.png",
            bytes: pngHeader(9000, 16),
            size: { width: 9000, height: 16 },
        };
        const { tasks, worker } = fakeWorker();
        const session = createImportSession(source, { worker });
        session.change({ tileWidth: 8 });
        await settle(session);
        const state = session.store.getState();
        expect(state.plan).toEqual({
            ok: false,
            problem: "The image is 9000 × 16 px; a source image is at most 8192 px a side.",
            code: "limit",
        });
        expect(session.canImport()).toBe(false);
        expect(await session.confirm()).toBeNull();
        expect(tasks).toEqual([]);
        session.dispose();
    });

    it("decodes a grid PNG for the pane, imports in the worker and adds one history entry", async () => {
        const bytes = png(positionImage(40, 24));
        const { tasks, worker } = fakeWorker();
        const session = createImportSession(
            { kind: "image", fileName: "ground.png", bytes, size: readPngSize(bytes) },
            { worker },
        );
        await settle(session);
        expect(session.store.getState().pixels).toMatchObject({ width: 40, height: 24 });
        session.change({ tileWidth: 8, tileHeight: 8, name: "Ground tiles" });
        const { form, plan } = session.store.getState();
        expect(form.exportName).toBe("ground-tiles");
        expect(plan.ok && plan.shape.tileCount).toBe(15);

        const history = sessionStore.getState().history;
        expect(await session.confirm()).toEqual({ name: "Ground tiles", tiles: 15 });
        expect(tasks).toEqual(["png.decode", "tileset.import"]);
        const { project } = sessionStore.getState().session;
        expect(project.tilesets.map((t) => [t.name, t.exportName])).toEqual([
            ["Ground tiles", "ground-tiles"],
        ]);
        expect(history.undoLabel).toBe("Import Tileset");
        history.undo();
        expect(sessionStore.getState().session.project.tilesets).toEqual([]);
        session.dispose();
    });

    it("starts a grid PNG at the map's tile size and the last import's margin and spacing", async () => {
        const bytes = png(positionImage(40, 40));
        const source: ImportSource = {
            kind: "image",
            fileName: "a.png",
            bytes,
            size: readPngSize(bytes),
        };
        const map = sessionStore.getState().session.project.maps[0]!;
        const grid = (form: {
            tileWidth: number;
            tileHeight: number;
            margin: number;
            spacing: number;
        }) => [form.tileWidth, form.tileHeight, form.margin, form.spacing];
        const first = createImportSession(source, fakeWorker());
        expect(grid(first.store.getState().form)).toEqual([map.tileWidth, map.tileHeight, 0, 0]);
        first.change({ tileWidth: 8, tileHeight: 8, margin: 2, spacing: 1 });
        expect(await first.confirm()).not.toBeNull();
        first.dispose();
        const second = createImportSession({ ...source, fileName: "b.png" }, fakeWorker());
        expect(grid(second.store.getState().form)).toEqual([map.tileWidth, map.tileHeight, 2, 1]);
        second.dispose();
    });

    it("refuses an export name the project has, before anything is imported", async () => {
        const bytes = png(positionImage(16, 16));
        const { tasks, worker } = fakeWorker();
        const session = createImportSession(
            { kind: "image", fileName: "a.png", bytes, size: readPngSize(bytes) },
            { worker },
        );
        const taken = sessionStore.getState().session.project.maps[0]!.exportName;
        session.change({ exportName: taken });
        expect(session.store.getState().nameProblem).toBe(
            `The export name ${JSON.stringify(taken)} is taken.`,
        );
        expect(session.canImport()).toBe(false);
        // The name no longer moves a typed export name.
        session.change({ name: "Other" });
        expect(session.store.getState().form.exportName).toBe(taken);
        await settle(session);
        expect(tasks).toEqual(["png.decode"]);
        session.dispose();
    });

    it("shows a worker failure in the dialog and adds nothing", async () => {
        const bytes = png(positionImage(16, 16));
        const run = vi.fn(async (task: string) => {
            if (task === "png.decode") throw new WorkerError("crashed", task, "It crashed.");
            throw new WorkerError("failed", task, "The file is not a PNG image.");
        });
        const session = createImportSession(
            { kind: "image", fileName: "a.png", bytes, size: readPngSize(bytes) },
            { worker: { run } as unknown as Pick<WorkerClient, "run"> },
        );
        await settle(session);
        expect(session.store.getState().pixelsError).toBe("It crashed.");
        expect(await session.confirm()).toBeNull();
        expect(session.store.getState().failure).toBe("The file is not a PNG image.");
        expect(sessionStore.getState().session.project.tilesets).toEqual([]);
        session.dispose();
    });
});

describe("the worker's tileset tasks", () => {
    it("are in the task table", () => {
        expect([...workerTasks.keys()]).toEqual(
            expect.arrayContaining([
                "tileset.import",
                "tileset.releaseSprite",
                "tileset.spriteFrame",
            ]),
        );
    });
});

describe("the files of an import", () => {
    const atlasBytes = fixture("tiles.atlas.json.golden");
    const atlasPng = fixture("tiles.png");

    it("pairs an atlas with the PNG it names", async () => {
        const source = await readImportSource([
            file("other.png", png(positionImage(4, 4))),
            file("tiles.png", atlasPng),
            file("tiles.atlas.json", atlasBytes),
        ]);
        expect(source).toMatchObject({
            kind: "atlas",
            fileName: "tiles.atlas.json",
            png: { fileName: "tiles.png" },
        });
    });

    it("refuses an atlas without its PNG, naming it", async () => {
        expect(await readImportSource([file("tiles.atlas.json", atlasBytes)])).toEqual({
            kind: "refused",
            fileName: "tiles.atlas.json",
            message:
                'An atlas is imported with its PNG: pick "tiles.atlas.json" and "tiles.png" together.',
        });
    });

    it("takes a PNG by its header and refuses what is not one", async () => {
        expect(await readImportSource([file("a.png", pngHeader(9000, 16))])).toMatchObject({
            kind: "image",
            size: { width: 9000, height: 16 },
        });
        expect(await readImportSource([file("b.png", new Uint8Array(8))])).toEqual({
            kind: "refused",
            fileName: "b.png",
            message: "The file is not a PNG image.",
        });
        expect(await readImportSource([file("notes.txt", new Uint8Array(1))])).toBeNull();
    });
});

describe("the atlas plan", () => {
    it("lists the frames and gives the import's warnings without decoding", async () => {
        const bytes = fixture("tiles.atlas.json.golden");
        const json = readAtlasJson(bytes, "tiles.atlas.json");
        const pngBytes = fixture("tiles.png");
        const size = readPngSize(pngBytes);
        const outline = readAtlasOutline(json, size);
        expect(outline.frames.map((f) => `${f.id} ${f.width}×${f.height}`)).toEqual([
            "tiles-0 16×16",
            "tiles-1 16×16",
            "tiles-2 16×16",
            "tiles-3 16×16",
            "tiles-4 16×16",
        ]);
        const plan = planAtlas(createProject(), json, size, { fileName: "tiles.atlas.json" });
        const imported = await importAtlas(createProject(), json, pngBytes, {
            fileName: "tiles.atlas.json",
        });
        expect(plan.warnings).toEqual(imported.warnings);
        expect(plan.shape.tileCount).toBe(imported.tileset.tiles.length);
    });

    it("refuses frames of mixed sizes naming them", () => {
        const json = atlasJson(32, 16, {
            a: { x: 0, y: 0, w: 16, h: 16, sourceW: 16, sourceH: 16 },
            b: { x: 16, y: 0, w: 8, h: 8, sourceW: 8, sourceH: 8 },
        });
        const plan = () =>
            planAtlas(createProject(), json, { width: 32, height: 16 }, { fileName: "x" });
        expect(plan).toThrow(TilesetImportError);
        expect(plan).toThrow('(16 × 16 px: "a"; 8 × 8 px: "b")');
    });

    it("refuses JSON that is not strict", () => {
        const bytes = new TextEncoder().encode('{"a": 1, "a": 2}');
        expect(() => readAtlasJson(bytes, "x.atlas.json")).toThrow(
            'Entry "x.atlas.json" is damaged: one of its objects has two members of the same name.',
        );
    });
});

/** Fills the project with stand-ins up to the tileset limit (FORMAT §2.8: 255). */
function fillTilesets(count = 255): () => void {
    const { tilesets } = sessionStore.getState().session.project;
    for (let i = 0; i < count; i++) {
        tilesets.push({
            exportName: `full-${i}`,
            tiles: [],
            pixels: { width: 0, height: 0 },
        } as never);
    }
    return () => void tilesets.splice(0);
}

/** A worker whose answers the test gives, request by request. */
function heldWorker() {
    const requests: {
        task: string;
        input: unknown;
        signal?: AbortSignal;
        start(): void;
        resolve(value: unknown): void;
        reject(error: unknown): void;
    }[] = [];
    const run = vi.fn(
        (
            task: string,
            input: unknown,
            options: { signal?: AbortSignal; onStarted?(): void } = {},
        ) =>
            new Promise((resolve, reject) => {
                options.signal?.addEventListener("abort", () =>
                    reject(new WorkerError("cancelled", task, "cancelled")),
                );
                requests.push({
                    task,
                    input,
                    signal: options.signal,
                    start: () => options.onStarted?.(),
                    resolve,
                    reject,
                });
            }),
    );
    const of = (task: string) => requests.filter((request) => request.task === task);
    return { requests, of, worker: { run } as unknown as Pick<WorkerClient, "run"> };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function spriteSource(): ImportSource {
    const bytes = fixture("tiles.ngsprite");
    return {
        kind: "sprite",
        fileName: "tiles.ngsprite",
        bytes,
        key: "sprite-test",
        doc: readSpriteOutline(bytes),
    };
}

describe("the import session and the worker (review fixes)", () => {
    it("decodes no pane for a grid PNG the project has no room for, until it has", async () => {
        const empty = fillTilesets();
        const bytes = png(positionImage(32, 32));
        const { tasks, worker } = fakeWorker();
        const session = createImportSession(
            { kind: "image", fileName: "a.png", bytes, size: readPngSize(bytes) },
            { worker },
        );
        expect(session.store.getState().plan).toMatchObject({ ok: false, code: "limit" });
        session.change({ margin: 1 });
        await tick();
        expect(tasks).toEqual([]);
        // Room again: the next change plans anew and the pane is decoded.
        empty();
        session.change({ margin: 0 });
        await settle(session);
        expect(tasks).toEqual(["png.decode"]);
        session.dispose();
    });

    it("composites no sprite frame and imports nothing while the project has no room", async () => {
        fillTilesets();
        const { requests, worker } = heldWorker();
        const session = createImportSession(spriteSource(), { worker, delayMs: 0 });
        session.change({ frame: 1 });
        await tick();
        expect(session.store.getState().plan).toMatchObject({ ok: false, code: "limit" });
        expect(requests.map((request) => request.task)).toEqual([]);
        session.dispose();
        expect(requests.map((request) => request.task)).toEqual(["tileset.releaseSprite"]);
    });

    it("leaves a started sprite import running and shows no counts of another grid", async () => {
        const { of, worker } = heldWorker();
        const session = createImportSession(spriteSource(), { worker, delayMs: 0 });
        await tick();
        const [first] = of("tileset.import");
        first!.start();
        // The grid changes while the worker imports the first one: it is not ended (that
        // would end the worker and the sprite it holds) …
        session.change({ tileWidth: 16, tileHeight: 16 });
        expect(first!.signal!.aborted).toBe(false);
        // … and its answer, which comes before the next grid's, is not shown for that grid.
        first!.resolve({ tileset: { tiles: [] }, warnings: [] });
        await tick();
        expect(session.store.getState()).toMatchObject({ spriteResult: null, computing: true });
        const [, second] = of("tileset.import");
        expect(first!.signal!.aborted).toBe(false);
        second!.resolve({ tileset: { tiles: [{ animation: [] }] }, warnings: [] });
        await tick();
        expect(session.store.getState().spriteResult).toMatchObject({ key: "16×16+0/0" });
        expect(session.store.getState().computing).toBe(false);
        session.dispose();
    });

    it("drops a sprite import the worker has not started when the grid changes", async () => {
        const { of, worker } = heldWorker();
        const session = createImportSession(spriteSource(), { worker, delayMs: 0 });
        await tick();
        const [first] = of("tileset.import");
        session.change({ tileWidth: 16, tileHeight: 16 });
        // Dropped when the next grid's import is asked for, after the pause.
        await tick();
        expect(first!.signal!.aborted).toBe(true);
        expect(of("tileset.import")).toHaveLength(2);
        session.dispose();
    });

    it("asks again for a grid whose import failed", async () => {
        const { of, worker } = heldWorker();
        const session = createImportSession(spriteSource(), { worker, delayMs: 0 });
        await tick();
        of("tileset.import")[0]!.reject(
            new WorkerError("crashed", "tileset.import", "It crashed."),
        );
        await tick();
        expect(session.store.getState().spriteResult).toMatchObject({ error: "It crashed." });
        // Away and back within the pause: no other grid is imported meanwhile.
        session.change({ margin: 1 });
        session.change({ margin: 0 });
        await tick();
        const asked = of("tileset.import").map(
            (request) => (request.input as { options: { margin: number } }).options.margin,
        );
        expect(asked).toEqual([0, 0]);
        session.dispose();
    });
});
