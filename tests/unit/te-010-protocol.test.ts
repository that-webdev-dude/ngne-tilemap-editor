import { afterEach, describe, expect, it } from "vitest";
import { createWorkerClient, taskFailure } from "../../src/app/worker/client";
import type { WorkerClient } from "../../src/app/worker/client";
import { WorkerError } from "../../src/app/worker/protocol";
import type { TaskModule } from "../../src/app/worker/task";
import { workerTasks } from "../../src/app/worker/taskTable";
// Declares `import.meta.glob` wherever this module is compiled.
import type {} from "../../src/import-meta";
import { decodePng, encodePng, openZip, writeZip } from "../../src/core/codec";
import type { PixelBuffer, ZipInput } from "../../src/core/codec";
import { packTileset } from "../../src/core/pack";
// Also declares the task types (te-010-support.ts).
import { inProcessWorkers, noiseTileset } from "./te-010-support";

// TE-010: every task of the background worker gives, through the protocol, what the direct
// `core/` call gives, and its errors arrive as typed data (run in-process: te-010-support.ts).

let client: WorkerClient;

function start(): WorkerClient {
    client = createWorkerClient(inProcessWorkers().factory);
    return client;
}

afterEach(() => client?.dispose());

/** `width × height` straight RGBA with some transparent pixels whose RGB is not 0. */
function pixels(width: number, height: number): PixelBuffer {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let at = 0; at < data.length; at += 4) {
        const index = at / 4;
        data.set([index & 255, (index * 7) & 255, (index * 13) & 255, index % 5 ? 255 : 0], at);
    }
    return { width, height, data };
}

/** What `promise` rejects with; fails when it resolves. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error("expected a rejection");
}

/** What `call` throws; fails when it returns. */
async function thrown(call: () => unknown): Promise<unknown> {
    return rejection(Promise.resolve().then(call));
}

/** The error as the page receives it: name, message and own fields. */
function asData(error: unknown): Record<string, unknown> {
    const fields = Object.fromEntries(
        Object.entries(error as Error).filter(([key]) => key !== "cause"),
    );
    return { ...fields, name: (error as Error).name, message: (error as Error).message };
}

const ZIP_ENTRIES: ZipInput[] = [
    { name: "manifest.json", data: new TextEncoder().encode('{"a":1}'.repeat(40)), stored: false },
    { name: "images/a.png", data: encodePng(pixels(5, 3)), stored: true },
];

describe("task table", () => {
    it("holds the tasks of TE-010, each once", () => {
        // Later tickets add tasks of their own (`*.task.ts`, RULES 6); TE-010's must stay.
        expect([...workerTasks.keys()]).toEqual(
            expect.arrayContaining([
                "pack.tileset",
                "png.decode",
                "png.encode",
                "zip.read",
                "zip.write",
            ]),
        );
        // Every task of every module is in the table once: none is lost to a name taken twice.
        const modules = import.meta.glob<TaskModule>("../../src/app/worker/**/*.task.ts", {
            eager: true,
        });
        const defined = Object.values(modules).flatMap((module) => module.tasks ?? []);
        expect(defined.map((task) => task.name).sort()).toEqual([...workerTasks.keys()].sort());
    });
});

describe("tasks through the protocol equal the direct core call", () => {
    it("png.encode", async () => {
        const image = pixels(17, 9);
        for (const options of [undefined, { zeroTransparentRgb: true }]) {
            const bytes = await start().run("png.encode", { pixels: image, options });
            expect(bytes).toEqual(encodePng(image, options));
            client.dispose();
        }
    });

    it("png.decode", async () => {
        const file = encodePng(pixels(17, 9));
        for (const options of [undefined, { zeroTransparentRgb: true }]) {
            const decoded = await start().run("png.decode", { bytes: file, options });
            expect(decoded).toEqual(await decodePng(file, options));
            client.dispose();
        }
    });

    it("zip.write", async () => {
        const archive = await start().run("zip.write", { entries: ZIP_ENTRIES });
        expect(archive).toEqual(writeZip(ZIP_ENTRIES));
    });

    it("zip.read", async () => {
        const bytes = writeZip(ZIP_ENTRIES);
        const entries = [
            { name: "images/a.png", maxBytes: 1 << 20 },
            { name: "missing.json", maxBytes: 1 << 20 },
            { name: "manifest.json", maxBytes: 1 << 20 },
        ];
        const read = await start().run("zip.read", { bytes, maxTotalBytes: 1 << 20, entries });
        const archive = openZip(bytes, 1 << 20);
        expect(read).toEqual(entries.map(({ name, maxBytes }) => archive.read(name, maxBytes)));
        expect(read[0]).toEqual(ZIP_ENTRIES[1]!.data);
        expect(read[1]).toBeUndefined();
    });

    it("pack.tileset", async () => {
        const tileset = noiseTileset(6, 5, 12);
        const packed = await start().run("pack.tileset", { tileset });
        expect(packed).toEqual(packTileset(tileset));
        expect(packed.uvTable.index).toBeInstanceOf(Map);
    });
});

describe("errors", () => {
    it("png.decode of bytes that are not a PNG fails with the PngError as data", async () => {
        const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        const error = await rejection(start().run("png.decode", { bytes }));
        expect(error).toBeInstanceOf(WorkerError);
        expect(error).toMatchObject({ code: "failed", task: "png.decode" });
        const expected = asData(await thrown(() => decodePng(bytes)));
        expect(expected).toMatchObject({ name: "PngError", code: "signature" });
        expect((error as WorkerError).remote).toEqual(expected);
        expect((error as WorkerError).message).toBe(expected.message);
        expect(taskFailure("png.decode", error)?.code).toBe("signature");
    });

    it("png.encode of a buffer of the wrong length fails with the PngError as data", async () => {
        const image = { width: 4, height: 4, data: new Uint8ClampedArray(10) };
        const error = await rejection(start().run("png.encode", { pixels: image }));
        const expected = asData(await thrown(() => encodePng(image)));
        expect(taskFailure("png.encode", error)).toEqual(expected);
        expect(expected).toMatchObject({ name: "PngError", code: "buffer" });
    });

    it("zip.read fails with the ProjectError as data, with its entry", async () => {
        const bytes = writeZip(ZIP_ENTRIES);
        const entries = [{ name: "manifest.json", maxBytes: 10 }];
        const error = await rejection(
            start().run("zip.read", { bytes, maxTotalBytes: 1 << 20, entries }),
        );
        const expected = asData(
            await thrown(() => openZip(bytes, 1 << 20).read("manifest.json", 10)),
        );
        expect(expected).toMatchObject({
            name: "ProjectError",
            code: "too-large",
            entry: "manifest.json",
        });
        expect(taskFailure("zip.read", error)).toEqual(expected);

        const notZip = new Uint8Array(40);
        const second = await rejection(
            client.run("zip.read", { bytes: notZip, maxTotalBytes: 1 << 20, entries }),
        );
        expect(taskFailure("zip.read", second)).toMatchObject({
            name: "ProjectError",
            code: "not-a-zip",
            entry: undefined,
        });
    });

    it("pack.tileset fails with the TilesetPackError as data", async () => {
        // One tile 8191 px wide: with its extrusion ring the atlas would be wider than 8192.
        const tileset = noiseTileset(8191, 1, 1);
        const error = await rejection(start().run("pack.tileset", { tileset }));
        const expected = asData(await thrown(() => packTileset(tileset)));
        expect(expected).toMatchObject({ name: "TilesetPackError", code: "atlas-size" });
        expect(taskFailure("pack.tileset", error)).toEqual(expected);
        expect(Object.keys(expected).sort()).toEqual(
            ["code", "message", "name", "required", "tilesetId", "tilesetName"].sort(),
        );
    });

    it("an error the task does not name is internal, without data", async () => {
        const error = await rejection(start().run("png.decode", null as never));
        expect(error).toMatchObject({ code: "internal", task: "png.decode", remote: null });
        expect((error as WorkerError).message).toContain("TypeError");
        expect(taskFailure("png.decode", error)).toBeNull();
    });

    it("an unknown task is internal", async () => {
        const error = await rejection(start().run("no.such.task" as never, {} as never));
        expect(error).toMatchObject({ code: "internal", task: "no.such.task" });
        expect((error as WorkerError).message).toContain('no task "no.such.task"');
    });
});

describe("buffers", () => {
    it("transfers the buffers named in `transfer` and the result's buffers", async () => {
        const file = encodePng(pixels(8, 8));
        const sent = file.slice();
        const decoded = await start().run(
            "png.decode",
            { bytes: sent },
            { transfer: [sent.buffer] },
        );
        expect(sent.byteLength).toBe(0);
        expect(decoded.data.byteLength).toBe(8 * 8 * 4);
        expect(decoded).toEqual(await decodePng(file));
    });

    it("copies the input without `transfer`", async () => {
        const file = encodePng(pixels(8, 8));
        await start().run("png.decode", { bytes: file });
        expect(file.byteLength).toBeGreaterThan(0);
    });
});
