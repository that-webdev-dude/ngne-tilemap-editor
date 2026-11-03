import { describe, expect, it } from "vitest";
import {
    choicesComplete,
    createUpdateSession,
    initialChoices,
    keyLabel,
    updateRows,
} from "../../src/app/tilesets/update/updateSession";
import type { RowChoice } from "../../src/app/tilesets/update/updateSession";
import { notices } from "../../src/app/notices/notices";
import { sessionStore } from "../../src/app/state/session";
import {
    summaryText,
    updatePickerAccept,
    updateTilesetFromFiles,
} from "../../src/app/tilesets/update/updateFromSource";
import type { WorkerClient } from "../../src/app/worker/client";
import { tasks } from "../../src/app/worker/tasks/tilesetUpdate.task";
import type { UpdateTilesetOutput } from "../../src/app/worker/tasks/tilesetUpdate.task";
import { FLIP_H, cellValue } from "../../src/core/cells";
import { encodePng } from "../../src/core/codec";
import { createProjectSession } from "../../src/core/model";
import { TilesetUpdateError, matchTiles, tileUsage } from "../../src/core/tileset";
import {
    SLOT,
    cell,
    fixtureProject,
    fixtureTileset,
    historyOf,
    layers,
    solid,
    sourceOf,
} from "./te-027-support";

// TE-028: the app's side of Update Tileset from Source (SPEC §6.3, DESIGN §9): the usage per map
// the dialog shows, its rows and first choices, its apply as one history entry, and the worker
// task that re-reads and matches a source. The dialog itself is covered by
// tests/e2e/te-028-update.spec.ts.

describe("tile usage per map", () => {
    it("counts each tile's cells in every map and layer, whatever their flags", () => {
        const project = fixtureProject(
            fixtureTileset([
                { key: [0, 0], color: 1 },
                { key: [1, 0], color: 2 },
            ]),
        );
        const [first, inner] = layers(project);
        first.cells.set(0, 0, cell(0));
        first.cells.set(1, 0, cell(0, FLIP_H));
        inner.cells.set(5, 5, cell(0));
        inner.cells.set(6, 6, cellValue(SLOT + 1, 0));
        const usage = tileUsage(project, SLOT, [0, 1]);
        expect(usage.get(0)).toEqual([
            { mapId: project.maps[0]!.id, mapName: project.maps[0]!.name, cells: 2 },
            { mapId: "m2", mapName: "Second", cells: 1 },
        ]);
        expect(usage.get(1)).toEqual([]);
    });
});

/** Tiles 0 and 1 share a picture whose key is gone; tile 2 is missing; entries 1, 2 match 0, 1. */
function ambiguousCase() {
    const tileset = fixtureTileset([
        { key: [0, 0], color: 10 },
        { key: [1, 0], color: 10 },
        { key: [2, 0], color: 20 },
        { key: [3, 0], color: 30 },
    ]);
    const project = fixtureProject(tileset);
    const source = sourceOf([
        { key: [3, 0], color: 30 },
        { key: [8, 0], color: 10 },
        { key: [9, 0], color: 10 },
    ]);
    return { project, source, match: matchTiles(tileset.tiles, source.entries) };
}

describe("rows and first choices", () => {
    it("lists ambiguous then missing tiles, each with its picture and usage", () => {
        const { project, match } = ambiguousCase();
        layers(project)[0].cells.set(2, 2, cell(2));
        const rows = updateRows(project, "ts", match);
        expect(rows.map((row) => [row.tileId, row.status, row.candidates])).toEqual([
            [0, "ambiguous", [1, 2]],
            [1, "ambiguous", [1, 2]],
            [2, "missing", []],
        ]);
        expect([...rows[2]!.picture.data]).toEqual([...solid(20)]);
        expect(rows[2]!.usage.map((use) => use.cells)).toEqual([1]);
    });

    it("starts each row on a choice that loses nothing, no candidate twice", () => {
        const { project, match } = ambiguousCase();
        const choices = initialChoices(updateRows(project, "ts", match));
        expect([...choices]).toEqual([
            [0, { kind: "candidate", entry: 1 }],
            [1, { kind: "candidate", entry: 2 }],
            [2, { kind: "keep" }],
        ]);
        expect(choicesComplete(choices)).toBe(true);
    });

    it("is incomplete with a candidate chosen twice or a Replace with… without its tile", () => {
        const twice = new Map<number, RowChoice>([
            [0, { kind: "candidate", entry: 1 }],
            [1, { kind: "candidate", entry: 1 }],
        ]);
        expect(choicesComplete(twice)).toBe(false);
        const unpicked = new Map<number, RowChoice>([[2, { kind: "replace", entry: null }]]);
        expect(choicesComplete(unpicked)).toBe(false);
        unpicked.set(2, { kind: "replace", entry: 0 });
        expect(choicesComplete(unpicked)).toBe(true);
    });

    it("names keys, summaries and picker types as the dialog shows them", () => {
        expect(keyLabel([3, 1])).toBe("(3, 1)");
        expect(keyLabel(["frame-2", 0, 1])).toBe("frame-2 (0, 1)");
        expect(keyLabel("walk_0")).toBe("walk_0");
        expect(
            summaryText({ unchanged: 9, moved: 2, changed: 1, new: 0, ambiguous: 1, missing: 3 }),
        ).toBe("9 unchanged, 2 moved, 1 changed, 0 new, 1 ambiguous, 3 missing");
        expect(updatePickerAccept("image")).toBe("image/png,.png");
        expect(updatePickerAccept("sprite")).toContain(".ngsprite");
        expect(updatePickerAccept("atlas")).toContain(".atlas.json");
    });
});

describe("apply", () => {
    function session(busy: string | null = null) {
        const { project, source, match } = ambiguousCase();
        const history = historyOf(project);
        const update = createUpdateSession(
            { tilesetId: "ts", tilesetName: "Tiles", source, match },
            {
                project: () => history.session.project,
                execute: (command) => history.execute(command),
                busy: () => busy,
            },
        );
        return { history, update };
    }

    it("makes one history entry with the rows' choices", async () => {
        const { history, update } = session();
        update.choose(2, { kind: "delete" });
        expect(await update.confirm()).toBe("applied");
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Update Tileset from Source");
        const tileset = history.session.project.tilesets[0]!;
        expect(tileset.tiles.map((tile) => [tile.id, tile.sourceKey])).toEqual([
            [0, [8, 0]],
            [1, [9, 0]],
            [3, [3, 0]],
        ]);
        expect(update.store.getState().applying).toBe(false);
    });

    it("changes nothing and says why while the history is busy or the choices are refused", async () => {
        const busy = session("Finish the stroke on the map first.");
        expect(await busy.update.confirm()).toBeNull();
        expect(busy.update.store.getState().failure).toBe("Finish the stroke on the map first.");
        expect(busy.history.undoCount).toBe(0);

        // The project changed meanwhile: tile 2 now takes entry 1 by its key, so it is no longer
        // missing and entry 1 is no candidate of tile 0: the choices are refused.
        const stale = session();
        stale.history.session.project.tilesets[0]!.tiles[2]!.sourceKey = [8, 0];
        expect(await stale.update.confirm()).toBeNull();
        expect(stale.update.store.getState().failure).not.toBeNull();
        expect(stale.history.undoCount).toBe(0);
        // A new choice clears the failure.
        stale.update.choose(2, { kind: "keep" });
        expect(stale.update.store.getState().failure).toBeNull();
    });

    it("cannot apply with an incomplete choice", async () => {
        const { history, update } = session();
        update.choose(2, { kind: "replace", entry: null });
        expect(update.canApply()).toBe(false);
        expect(await update.confirm()).toBeNull();
        expect(history.undoCount).toBe(0);
    });
});

/** A grid PNG of 2 × 2 tiles, colours `colors` in a row. */
function png(colors: number[]): Uint8Array {
    const width = colors.length * 2;
    const data = new Uint8ClampedArray(width * 2 * 4);
    colors.forEach((color, k) => {
        const bytes = solid(color);
        for (let y = 0; y < 2; y++)
            data.set(bytes.subarray(y * 8, y * 8 + 8), (y * width + k * 2) * 4);
    });
    return encodePng({ width, height: 2, data });
}

describe("worker task tileset.updateSource", () => {
    const run = tasks.find((task) => task.name === "tileset.updateSource")!;

    const input = (files: unknown) => {
        const tileset = fixtureTileset([
            { key: [0, 0], color: 1 },
            { key: [1, 0], color: 2 },
        ]);
        return {
            tileset: {
                id: tileset.id,
                name: tileset.name,
                tileWidth: tileset.tileWidth,
                tileHeight: tileset.tileHeight,
                source: tileset.source,
                tiles: tileset.tiles,
            },
            files,
        };
    };

    it("re-reads the source with the recorded grid and matches it to the tiles", async () => {
        const output = (await run.run(
            input({ kind: "image", png: png([2, 1, 3]) }),
        )) as UpdateTilesetOutput;
        expect(output.source.entries.map((entry) => entry.key)).toEqual([
            [0, 0],
            [1, 0],
            [2, 0],
        ]);
        expect(output.match.summary).toEqual({
            unchanged: 0,
            moved: 2,
            changed: 0,
            new: 1,
            ambiguous: 0,
            missing: 0,
        });
        // The entries' pixels are handed over, not copied.
        expect(run.transfer!(output)).toHaveLength(3);
    });

    it("refuses a source of another kind", async () => {
        await expect(run.run(input({ kind: "sprite", bytes: new Uint8Array(4) }))).rejects.toThrow(
            TilesetUpdateError,
        );
    });
});

describe("review fixes", () => {
    it("reports a tileset deleted while its source was read, without a crash", async () => {
        const tileset = fixtureTileset([
            { key: [0, 0], color: 1 },
            { key: [1, 0], color: 2 },
        ]);
        sessionStore.getState().replace(createProjectSession(fixtureProject(tileset)));
        const shown: string[] = [];
        const detach = notices.attachSink((_, message) => shown.push(message));
        try {
            const source = sourceOf([{ key: [5, 0], color: 9 }]);
            const worker = {
                run: (async () => {
                    // The tileset goes while the worker reads: an undo of its import.
                    const { project } = sessionStore.getState().session;
                    sessionStore
                        .getState()
                        .replace(createProjectSession({ ...project, tilesets: [] }));
                    return { source, match: matchTiles(tileset.tiles, source.entries) };
                }) as unknown as WorkerClient["run"],
            };
            const picked = { name: "tiles.png", read: async () => new Uint8Array(png([1])) };
            await expect(updateTilesetFromFiles("ts", [picked], worker)).resolves.toBe(false);
            expect(shown).toEqual([
                "Could not update tileset “Tiles”. The tileset was removed while its source was read.",
            ]);
        } finally {
            detach();
        }
    });

    it("tells Apply that changes nothing apart from an update", async () => {
        // Tile 1 was kept in an earlier update (no key) and is missing again; Keep changes nothing.
        const tileset = fixtureTileset([
            { key: [0, 0], color: 1 },
            { key: null, color: 2 },
        ]);
        const project = fixtureProject(tileset);
        const history = historyOf(project);
        const source = sourceOf([{ key: [0, 0], color: 1 }]);
        const update = createUpdateSession(
            {
                tilesetId: "ts",
                tilesetName: "Tiles",
                source,
                match: matchTiles(tileset.tiles, source.entries),
            },
            {
                project: () => history.session.project,
                execute: (command) => history.execute(command),
                busy: () => null,
            },
        );
        expect(await update.confirm()).toBe("unchanged");
        expect(history.undoCount).toBe(0);
    });
});
