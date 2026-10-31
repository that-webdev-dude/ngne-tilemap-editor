import type { WorkerConnection, WorkerEvents, WorkerFactory } from "../../src/app/worker/client";
import type { WorkerResponse } from "../../src/app/worker/protocol";
import { serve } from "../../src/app/worker/serve";
import type { WorkerScope } from "../../src/app/worker/serve";
import { workerTasks } from "../../src/app/worker/taskTable";
import type { WorkerTask } from "../../src/app/worker/task";
import type { Tileset } from "../../src/core/model";
// The task types: the compiler does not follow the glob of taskTable.ts.
import type {} from "../../src/app/worker/tasks/pack.task";
import type {} from "../../src/app/worker/tasks/png.task";
import type {} from "../../src/app/worker/tasks/zip.task";

// Shared by the TE-010 tests: the background worker run in-process in Node. `serve` answers on
// one end of a MessageChannel and the client posts on the other, so requests and results are
// structured-cloned and their buffers transferred exactly as between threads.

/** One in-process worker as a test sees it. */
export interface InProcessWorker {
    readonly terminated: boolean;
    /** The answers it has sent, in order. */
    readonly responses: WorkerResponse[];
    /** Reports a crash to the client, as a worker's `error` event does. */
    crash(reason: string): void;
}

/** A factory of in-process workers over `tasks`, and the workers it started, in order. */
export function inProcessWorkers(tasks: ReadonlyMap<string, WorkerTask> = workerTasks): {
    factory: WorkerFactory;
    workers: InProcessWorker[];
} {
    const workers: InProcessWorker[] = [];
    const factory: WorkerFactory = (events: WorkerEvents): WorkerConnection => {
        const { port1, port2 } = new MessageChannel();
        serve(port2 as unknown as WorkerScope, tasks);
        const worker = {
            terminated: false,
            responses: [] as WorkerResponse[],
            crash: events.crash,
        };
        port1.onmessage = (event: MessageEvent<WorkerResponse>) => {
            worker.responses.push(event.data);
            events.message(event.data);
        };
        workers.push(worker);
        return {
            post: (request, transfer) => port1.postMessage(request, transfer),
            terminate() {
                worker.terminated = true;
                port1.close();
                port2.close();
            },
        };
    };
    return { factory, workers };
}

/** A tileset of `count` tiles of `width × height` opaque noise, one row. */
export function noiseTileset(width: number, height: number, count: number): Tileset {
    const data = new Uint8ClampedArray(width * count * height * 4);
    let seed = 7;
    for (let at = 0; at < data.length; at += 4) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        data.set([seed >>> 24, (seed >>> 16) & 255, (seed >>> 8) & 255, 255], at);
    }
    return {
        id: "ts-1",
        name: "Noise",
        exportName: "noise",
        class: "",
        slot: 1,
        tileWidth: width,
        tileHeight: height,
        offsetX: 0,
        offsetY: 0,
        columns: count,
        pixels: { width: width * count, height, data },
        nextTileId: count,
        source: { kind: "image", fileName: "noise.png", margin: 0, spacing: 0 },
        tiles: Array.from({ length: count }, (_, id) => ({
            id,
            sourceKey: [id, 0] as [number, number],
            fingerprint: "0".repeat(64),
            class: "",
            collision: [],
            animation: id === 0 ? [] : [{ tile: 0, ms: 100 }],
            properties: [],
        })),
        terrainSets: [],
        properties: [],
    };
}
