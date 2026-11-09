import type { StoreApi } from "zustand/vanilla";
import type { SnapshotBackend } from "../../src/app/autosave/backend";
import { takeSnapshot, writeSnapshot } from "../../src/app/worker/autosave/snapshotProject";
import type {
    SnapshotRecord,
    SnapshotStorage,
    SnapshotWrite,
    TakeResult,
} from "../../src/app/worker/autosave/snapshotStorage";
import type { SessionState } from "../../src/app/state/session";
import type { Command } from "../../src/core/history";
import { touchedNothing } from "../../src/core/history";
import { walkLayers } from "../../src/core/model";
import type { PixelBuffer, TileLayer } from "../../src/core/model";

// Shared helpers of the TE-048 unit tests: a snapshot storage in memory that records every put
// (the store spy of the acceptance), and commands that change one map's cells or one tileset's
// pixels the way the editor's commands do.

/** A snapshot storage in memory with the contract of the IndexedDB one; records every put. */
export class MemorySnapshots implements SnapshotStorage {
    readonly records = new Map<string, SnapshotRecord>();
    readonly entries = new Map<string, Map<string, Uint8Array>>();
    readonly pixels = new Map<string, Map<string, PixelBuffer>>();
    /** Every entry put, as `key/name`, in order. */
    readonly entryPuts: string[] = [];
    /** Every pixel record put, as `key/name`, in order. */
    readonly pixelPuts: string[] = [];
    readonly removals: string[] = [];
    readonly writes: SnapshotWrite[] = [];
    /** The next write fails with it. */
    fail: Error | null = null;
    /** While set, a write waits for it before it lands (a write on its way). */
    hold: Promise<void> | null = null;
    /** Writes that have started, landed or not. */
    started = 0;

    async write(write: SnapshotWrite): Promise<"written" | "taken"> {
        this.started++;
        await Promise.resolve();
        if (this.hold) await this.hold;
        if (this.fail) {
            const failure = this.fail;
            this.fail = null;
            throw failure;
        }
        const { key } = write.record;
        const stored = this.records.get(key);
        if (stored && stored.owner !== write.record.owner) return "taken";
        this.writes.push(write);
        const entries = new Map(write.replace ? [] : (this.entries.get(key) ?? []));
        const pixels = new Map(write.replace ? [] : (this.pixels.get(key) ?? []));
        for (const name of write.deleteEntries) entries.delete(name);
        for (const name of write.deletePixels) pixels.delete(name);
        for (const [name, bytes] of write.putEntries) {
            entries.set(name, bytes.slice());
            this.entryPuts.push(`${key}/${name}`);
        }
        for (const [name, image] of write.putPixels) {
            pixels.set(name, {
                width: image.width,
                height: image.height,
                data: image.data.slice(),
            });
            this.pixelPuts.push(`${key}/${name}`);
        }
        this.entries.set(key, entries);
        this.pixels.set(key, pixels);
        this.records.set(key, structuredClone(write.record));
        return "written";
    }

    async remove(key: string): Promise<void> {
        this.removals.push(key);
        this.records.delete(key);
        this.entries.delete(key);
        this.pixels.delete(key);
    }

    async list(): Promise<SnapshotRecord[]> {
        return [...this.records.values()].sort((a, b) => b.savedAt - a.savedAt);
    }

    /** Reads and takes in one step, as one IndexedDB transaction does. */
    async take(key: string, expectedOwner: string, owner: string): Promise<TakeResult> {
        await Promise.resolve();
        const stored = this.records.get(key);
        if (!stored) return "gone";
        if (stored.owner !== expectedOwner) return "taken";
        const record = { ...stored, owner };
        this.records.set(key, record);
        const pixels = new Map(
            [...(this.pixels.get(key) ?? [])].map(([name, image]) => [
                name,
                { width: image.width, height: image.height, data: image.data.slice() },
            ]),
        );
        return {
            record: structuredClone(record),
            entries: new Map(this.entries.get(key) ?? []),
            pixels,
        };
    }

    async discard(key: string, expectedOwner: string): Promise<"removed" | "taken" | "gone"> {
        const stored = this.records.get(key);
        if (stored && stored.owner !== expectedOwner) return "taken";
        await this.remove(key);
        return stored ? "removed" : "gone";
    }

    /** Forgets the puts recorded so far. */
    clearPuts(): void {
        this.entryPuts.length = 0;
        this.pixelPuts.length = 0;
        this.writes.length = 0;
    }
}

/**
 * The operations of the worker's tasks on a memory storage, in this thread, with what the page
 * hands over cloned as a message clones it.
 */
export function memoryBackend(storage: MemorySnapshots): SnapshotBackend {
    return {
        write: (input) => writeSnapshot(storage, structuredClone(input)),
        remove: (key) => storage.remove(key),
        list: () => storage.list(),
        take: (key, expectedOwner, owner) => takeSnapshot(storage, key, expectedOwner, owner),
        discard: (key, expectedOwner) => storage.discard(key, expectedOwner),
    };
}

/** The first tile layer of map `mapId` of the store's project. */
export function tileLayerOf(sessions: StoreApi<SessionState>, mapId: string): TileLayer {
    const map = sessions.getState().session.project.maps.find((each) => each.id === mapId)!;
    for (const { layer } of walkLayers(map.layers)) if (layer.type === "tile") return layer;
    throw new Error(`Map ${mapId} has no tile layer.`);
}

/** Sets cell (x, y) of the first tile layer of map `mapId` to `value`: one undoable step. */
export function paintCell(
    sessions: StoreApi<SessionState>,
    mapId: string,
    x: number,
    y: number,
    value: number,
): void {
    const layer = tileLayerOf(sessions, mapId);
    const before = layer.cells.get(x, y);
    const command: Command = {
        label: "Paint",
        do: () => void layer.cells.set(x, y, value),
        undo: () => void layer.cells.set(x, y, before),
        bytes: 0,
        touched: {
            mapId,
            layerIds: [layer.id],
            cellRects: [{ x, y, width: 1, height: 1 }],
            tilesetIds: [],
            structure: false,
        },
    };
    sessions.getState().history.execute(command);
}

/**
 * Replaces the pixels of tileset `id` with a copy whose first byte differs, as the tileset
 * commands replace a buffer: one undoable step of no map.
 */
export function repaintTileset(sessions: StoreApi<SessionState>, id: string): void {
    const tileset = sessions.getState().session.project.tilesets.find((each) => each.id === id)!;
    const before = tileset.pixels;
    const data = before.data.slice();
    data[0] = (data[0]! + 1) & 0xff;
    const after = { ...before, data };
    const command: Command = {
        label: "Repaint",
        do: () => void (tileset.pixels = after),
        undo: () => void (tileset.pixels = before),
        bytes: 0,
        touched: { ...touchedNothing(), tilesetIds: [id] },
    };
    sessions.getState().history.execute(command);
}

/** Renames the project: a step of no map that changes only `project.json`. */
export function renameProject(sessions: StoreApi<SessionState>, name: string): void {
    const { project } = sessions.getState().session;
    const before = project.name;
    sessions.getState().history.execute({
        label: "Rename",
        do: () => void (project.name = name),
        undo: () => void (project.name = before),
        bytes: 0,
        touched: touchedNothing(),
    });
}
