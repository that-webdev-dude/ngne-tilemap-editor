import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appCommands } from "../../src/app/commands/appCommands";
import { commandDialogs } from "../../src/app/dialogs/dialogRequests";
import { notices } from "../../src/app/notices/notices";
import { sessionStore } from "../../src/app/state/session";
import { importTilesetFiles, importingTileset } from "../../src/app/tilesets/import/importTileset";
import type { PickedFile } from "../../src/app/tilesets/import/importSources";
import { installTilesetDrop } from "../../src/app/tilesets/import/tilesetDrop";
import { tilesetPanelStore } from "../../src/app/tilesets/panel/tilesetPanel";
import { installUpdateDrop } from "../../src/app/tilesets/update/updateDrop";
import {
    updateTilesetFromFiles,
    updatingTileset,
} from "../../src/app/tilesets/update/updateFromSource";
import type { WorkerClient } from "../../src/app/worker/client";
import { encodePng } from "../../src/core/codec";
import { createProjectSession } from "../../src/core/model";
import { matchTiles } from "../../src/core/tileset";
import { fixtureProject, fixtureTileset, solid, sourceOf } from "./te-027-support";

// TE-028: one tileset file operation at a time (SPEC §6). While Import Tileset or Update
// Tileset from Source runs, the drops, the file commands and the tileset dialogs are
// unavailable, and an operation given up after it started is reported by a toast.

const COMMANDS = [
    "file.importTileset",
    "tileset.updateFromSource",
    "tileset.editCollision",
    "tileset.editAnimation",
    "tileset.properties",
];

const enabled = (id: string) => appCommands.get(id)!.enabled();

/** A grid PNG of one 2 × 2 tile. */
function png(): Uint8Array {
    const data = new Uint8ClampedArray(2 * 2 * 4);
    for (let at = 0; at < data.length; at += 4) data.set(solid(1).subarray(0, 4), at);
    return encodePng({ width: 2, height: 2, data });
}

/** A file whose bytes arrive when `release` is called. */
function heldFile(name: string) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const file: PickedFile = {
        name,
        read: async () => {
            await gate;
            return png();
        },
    };
    return { file, release };
}

function dragEvent(type: string, names: string[], target?: Element) {
    const files = names.map((name) => ({ name, arrayBuffer: async () => new ArrayBuffer(0) }));
    const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
        dataTransfer: { types: string[]; files: unknown[]; dropEffect: string };
    };
    event.dataTransfer = { types: ["Files"], files, dropEffect: "none" };
    if (target) Object.defineProperty(event, "target", { value: target });
    return event;
}

const tab = { closest: () => ({ dataset: { tilesetTab: "ts" } }) } as unknown as Element;

/** The worker of an update that finds a tile missing, so that its dialog is needed. */
function ambiguousWorker(before?: () => void): Pick<WorkerClient, "run"> {
    const tileset = fixtureTileset([
        { key: [0, 0], color: 10 },
        { key: [1, 0], color: 20 },
    ]);
    const source = sourceOf([{ key: [0, 0], color: 10 }]);
    return {
        run: (async () => {
            before?.();
            return { source, match: matchTiles(tileset.tiles, source.entries) };
        }) as unknown as WorkerClient["run"],
    };
}

let detachHost: () => void;
let detachSink: () => void;
let shown: string[];
const idleWorker: Pick<WorkerClient, "run"> = {
    run: (() => new Promise(() => undefined)) as unknown as WorkerClient["run"],
};

/** Answers the open dialog with a cancel. */
const cancelOpenDialog = () => commandDialogs.store.getState().request?.answer(null as never);
const dialogOpen = () => expect(commandDialogs.store.getState().request).not.toBeNull();

beforeEach(() => {
    const tileset = fixtureTileset([
        { key: [0, 0], color: 10 },
        { key: [1, 0], color: 20 },
    ]);
    sessionStore.getState().replace(createProjectSession(fixtureProject(tileset)));
    tilesetPanelStore.setState({
        activeTilesetId: "ts",
        selections: { ts: { anchor: { column: 0, row: 0 }, focus: { column: 0, row: 0 } } },
    });
    detachHost = commandDialogs.attachHost();
    shown = [];
    detachSink = notices.attachSink((_, message) => shown.push(message));
});

afterEach(() => {
    detachHost();
    detachSink();
});

describe("while an update runs", () => {
    it("refuses the drops and the five commands, then allows them again", async () => {
        for (const id of COMMANDS) expect(enabled(id), id).toBe(true);
        const held = heldFile("tiles.png");
        const update = updateTilesetFromFiles("ts", [held.file], ambiguousWorker());
        expect(updatingTileset()).toBe(true);

        const imported: unknown[] = [];
        const updated: unknown[] = [];
        const target = new EventTarget();
        const stopImport = installTilesetDrop({
            target,
            files: "all",
            overlayOpen: () => false,
            importFiles: (files) => imported.push(files),
        });
        const stopUpdate = installUpdateDrop({
            target,
            overlayOpen: () => false,
            updateFiles: (id, files) => updated.push([id, files]),
        });
        const over = dragEvent("dragover", ["tiles.png"], tab);
        target.dispatchEvent(over);
        expect(over.dataTransfer.dropEffect).toBe("none");
        target.dispatchEvent(dragEvent("drop", ["tiles.png"], tab));
        target.dispatchEvent(dragEvent("drop", ["tiles.png"]));
        expect(imported).toEqual([]);
        expect(updated).toEqual([]);
        stopImport();
        stopUpdate();

        for (const id of COMMANDS) expect(enabled(id), id).toBe(false);

        held.release();
        await vi.waitFor(dialogOpen);
        cancelOpenDialog();
        await update;
        expect(updatingTileset()).toBe(false);
        for (const id of COMMANDS) expect(enabled(id), id).toBe(true);
    });
});

describe("while an import runs", () => {
    it("refuses the update drop and the commands, then allows them again", async () => {
        const held = heldFile("tiles.png");
        const imported = importTilesetFiles([held.file], idleWorker);
        expect(importingTileset()).toBe(true);

        const updated: unknown[] = [];
        const target = new EventTarget();
        const stopUpdate = installUpdateDrop({
            target,
            overlayOpen: () => false,
            updateFiles: (id, files) => updated.push([id, files]),
        });
        const over = dragEvent("dragover", ["tiles.png"], tab);
        target.dispatchEvent(over);
        expect(over.dataTransfer.dropEffect).toBe("none");
        target.dispatchEvent(dragEvent("drop", ["tiles.png"], tab));
        expect(updated).toEqual([]);
        stopUpdate();

        for (const id of COMMANDS) expect(enabled(id), id).toBe(false);
        await expect(updateTilesetFromFiles("ts", [held.file], idleWorker)).resolves.toBe(false);

        held.release();
        await vi.waitFor(dialogOpen);
        cancelOpenDialog();
        await expect(imported).resolves.toBe(false);
        expect(importingTileset()).toBe(false);
        for (const id of COMMANDS) expect(enabled(id), id).toBe(true);
        expect(shown).toEqual([]);
    });
});

describe("another dialog opened while a file is read", () => {
    /** Opens a dialog of another kind. */
    function openOther() {
        void commandDialogs.open<null>((answer) => ({ kind: "other", answer }));
    }

    it("reports an update that cannot ask its question, and resolves false", async () => {
        const held = heldFile("tiles.png");
        const update = updateTilesetFromFiles(
            "ts",
            [held.file],
            ambiguousWorker(() => openOther()),
        );
        held.release();
        await expect(update).resolves.toBe(false);
        expect(shown).toEqual(["Could not update tileset “Tiles”. Another dialog is open."]);
        cancelOpenDialog();
        expect(updatingTileset()).toBe(false);
    });

    it("reports an import that cannot show its dialog, and resolves false", async () => {
        const held = heldFile("tiles.png");
        const imported = importTilesetFiles([held.file], idleWorker);
        openOther();
        held.release();
        await expect(imported).resolves.toBe(false);
        expect(shown).toEqual(["Could not import the tileset. Another dialog is open."]);
        cancelOpenDialog();
        expect(importingTileset()).toBe(false);
    });

    it("shows no notice when the user cancels the dialog", async () => {
        const held = heldFile("tiles.png");
        const update = updateTilesetFromFiles("ts", [held.file], ambiguousWorker());
        held.release();
        await vi.waitFor(dialogOpen);
        cancelOpenDialog();
        await expect(update).resolves.toBe(false);
        expect(shown).toEqual([]);
    });
});
