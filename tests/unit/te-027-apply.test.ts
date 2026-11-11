import { beforeEach, describe, expect, it } from "vitest";
import { clipboardContent, copyCellsToClipboard } from "../../src/app/clipboard/clipboard";
import { sessionStore } from "../../src/app/state/session";
import { currentStamp, setCurrentStamp } from "../../src/app/tools/stamp/currentStamp";
import type { Stamp } from "../../src/core/cells";
import { BYTES_PER_PATCHED_CELL, CELL_PATCH_OVERHEAD_BYTES, History } from "../../src/core/history";
import { assertInvariants, createProjectSession } from "../../src/core/model";
import type { Project } from "../../src/core/model";
import {
    TilesetUpdateError,
    UPDATE_FROM_SOURCE_LABEL,
    addTilesetCommand,
    importAtlas,
    importGridPng,
    importSprite,
    readSpriteOutline,
    readUpdateSource,
    renameTilesetCommand,
    spriteGridDefaults,
    updateFromSourceCommand,
} from "../../src/core/tileset";
import type { SourceTiles, TileResolution } from "../../src/core/tileset";
import { expectSymmetric, snapshotProject } from "./support/symmetry";
import { atlasJson, emptyProject, png, positionImage } from "./te-022-support";
import { spriteFixture } from "./te-023-support";
import {
    cell,
    cellsOf,
    colorOf,
    fixtureProject,
    fixtureTileset,
    historyOf,
    layers,
    sourceOf,
} from "./te-027-support";

// TE-027: the apply of "Update tileset from source" (SPEC §6.3) as one history entry. It passes
// the TE-006 symmetry harness; its `bytes` count the pixels of changed, new and removed tiles
// and the rewritten cells only; the current stamp and the clipboard lose their cells on removed
// tiles (SPEC §4.2); a source of another tile size is refused; each kind of source is re-read
// with the tileset's recorded parameters.

const TILE_BYTES = 2 * 2 * 4;

/**
 * Tile 0 changed by key, 1 deleted, 2 replaced, 3 kept, 4 unchanged, 5 and 6 ambiguous (one
 * takes the candidate, the other is deleted), then `extra` unchanged tiles; two new entries.
 * Cells of 0, 1, 2 and 6 painted in both maps.
 */
function mixedUpdate(extra = 0): {
    project: Project;
    source: SourceTiles;
    resolutions: Map<number, TileResolution>;
} {
    const extras = Array.from({ length: extra }, (_, i) => ({
        key: [20 + i, 0] as [number, number],
        color: 100 + i,
    }));
    const tileset = fixtureTileset([
        { key: [0, 0], color: 1 },
        { key: [1, 0], color: 2 },
        { key: [2, 0], color: 3 },
        { key: [3, 0], color: 4 },
        { key: [4, 0], color: 5 },
        { key: [5, 0], color: 6 },
        { key: [6, 0], color: 6 },
        ...extras,
    ]);
    const project = fixtureProject(tileset);
    const [first, second] = layers(project);
    for (const [x, id] of [
        [0, 1],
        [1, 2],
        [2, 2],
        [3, 6],
        [4, 0],
    ] as const) {
        first.cells.set(x, 0, cell(id));
        second.cells.set(0, x, cell(id));
    }
    const source = sourceOf([
        { key: [0, 0], color: 10 },
        { key: [4, 0], color: 5 },
        { key: [8, 0], color: 6 },
        { key: [9, 0], color: 11 },
        { key: [10, 0], color: 12 },
        ...extras,
    ]);
    const resolutions = new Map<number, TileResolution>([
        [1, { kind: "delete" }],
        [2, { kind: "replace", entry: 3 }],
        [3, { kind: "keep" }],
        [5, { kind: "candidate", entry: 2 }],
        [6, { kind: "delete" }],
    ]);
    return { project, source, resolutions };
}

describe("the apply as one history entry", () => {
    it("passes the symmetry harness", () => {
        const { project, source, resolutions } = mixedUpdate();
        const history = historyOf(project);
        const command = expectSymmetric(
            history,
            (session) => updateFromSourceCommand(session.project, "ts", source, resolutions)!,
            { rounds: 2 },
        );
        expect(command.label).toBe(UPDATE_FROM_SOURCE_LABEL);
        expect(command.touched).toEqual({
            mapId: null,
            layerIds: [],
            cellRects: [],
            tilesetIds: ["ts"],
            structure: false,
        });
        const tileset = history.session.project.tilesets[0]!;
        expect(tileset.tiles.map((tile) => tile.id)).toEqual([0, 3, 4, 5, 7, 8]);
        expect(tileset.tiles.map((tile) => colorOf(tileset, tile.id))).toEqual([
            10, 4, 5, 6, 11, 12,
        ]);
        expect(cellsOf(layers(history.session.project)[0])).toEqual([
            [1, 0, cell(7)],
            [2, 0, cell(7)],
            [4, 0, cell(0)],
        ]);
    });

    it("bytes: the pixels of changed, new and removed tiles and the rewritten cells only", () => {
        const { project, source, resolutions } = mixedUpdate();
        const command = updateFromSourceCommand(project, "ts", source, resolutions)!;
        // Tile 0 changed (before and after), two new tiles, three removed (1, 2, 6).
        const pixels = (2 + 2 + 3) * TILE_BYTES;
        // Four cells rewritten in each map's layer.
        const cells = 2 * (4 * BYTES_PER_PATCHED_CELL + CELL_PATCH_OVERHEAD_BYTES);
        expect(command.bytes - pixels - cells).toBe(256);

        // Unchanged tiles add nothing.
        const larger = mixedUpdate(200);
        expect(
            updateFromSourceCommand(larger.project, "ts", larger.source, larger.resolutions)!.bytes,
        ).toBe(command.bytes);
    });

    it("counts against the history budget like any entry: one larger than it stays undoable", () => {
        const { project, source, resolutions } = mixedUpdate();
        const history = new History(createProjectSession(project), {
            budgetBytes: 300,
            verify: assertInvariants,
        });
        history.execute(renameTilesetCommand("ts", "Before"));
        const before = snapshotProject(history.session.project);
        history.execute(updateFromSourceCommand(project, "ts", source, resolutions)!);
        expect(history.undoCount).toBe(1);
        expect(history.undo()).toBe(true);
        // Undo does not give the two new tiles' IDs (7, 8) back.
        before.tilesets[0]!.nextTileId = 9;
        expect(snapshotProject(history.session.project)).toStrictEqual(before);
    });
});

describe("undo does not give tile IDs back (FORMAT §2.4, as in Tiled)", () => {
    it("an update after undoing one that added tiles gives its new tiles unused IDs", () => {
        const history = historyOf(fixtureProject(fixtureTileset([{ key: [0, 0], color: 1 }])));
        const tileset = () => history.session.project.tilesets[0]!;
        const ids = () => tileset().tiles.map((tile) => tile.id);
        const update = (specs: { key: [number, number]; color: number }[]) =>
            history.execute(
                updateFromSourceCommand(history.session.project, "ts", sourceOf(specs))!,
            );

        update([
            { key: [0, 0], color: 1 },
            { key: [1, 0], color: 2 },
            { key: [2, 0], color: 3 },
        ]);
        expect(ids()).toEqual([0, 1, 2]);
        expect(history.undo()).toBe(true);
        expect(ids()).toEqual([0]);
        expect(tileset().nextTileId).toBe(3);
        expect(history.redo()).toBe(true);
        expect(tileset().nextTileId).toBe(3);
        expect(history.undo()).toBe(true);

        update([
            { key: [0, 0], color: 1 },
            { key: [3, 0], color: 4 },
        ]);
        expect(ids()).toEqual([0, 3]);
        expect(tileset().nextTileId).toBe(4);
        expect(history.undo()).toBe(true);
        expect(ids()).toEqual([0]);
        expect(tileset().nextTileId).toBe(4);
    });
});

describe("the apply undone: animation frames, terrain and the stored grid come back", () => {
    it("a Delete that strips animation frames and terrain passes the symmetry harness", () => {
        const { project, source, resolutions } = mixedUpdate();
        const tileset = project.tilesets[0]!;
        tileset.tiles[4]!.animation = [
            { tile: 1, ms: 10 },
            { tile: 4, ms: 20 },
            { tile: 2, ms: 30 },
        ];
        tileset.terrainSets = [
            {
                name: "Ground",
                type: "corner",
                colors: [
                    { name: "Grass", color: "#00ff00ff", tile: 1 },
                    { name: "Sand", color: "#ffff00ff", tile: 4 },
                ],
                tiles: [
                    { tile: 1, wangId: [0, 1, 0, 1, 0, 1, 0, 1] },
                    { tile: 4, wangId: [0, 2, 0, 2, 0, 2, 0, 2] },
                ],
            },
        ];
        const history = historyOf(project);
        expectSymmetric(
            history,
            (session) => updateFromSourceCommand(session.project, "ts", source, resolutions)!,
            { rounds: 2 },
        );
        const after = history.session.project.tilesets[0]!;
        expect(after.tiles.find((tile) => tile.id === 4)!.animation).toEqual([{ tile: 4, ms: 20 }]);
        expect(after.terrainSets[0]!.colors.map((color) => color.tile)).toEqual([null, 4]);
        expect(after.terrainSets[0]!.tiles.map((tile) => tile.tile)).toEqual([4]);
    });

    it("an update past 8192 px of rows lays the tiles out anew and passes the symmetry harness", () => {
        // One column of 4096 tiles of 2 px is 8192 px high: one more tile needs more columns.
        const specs = Array.from({ length: 4096 }, (_, k) => ({
            key: [k, 0] as [number, number],
            color: k % 256,
        }));
        const project = fixtureProject(fixtureTileset(specs, specs.length, 1));
        const source = sourceOf([...specs, { key: [4096, 0], color: 7 }]);
        const history = historyOf(project);
        expectSymmetric(history, (session) =>
            updateFromSourceCommand(session.project, "ts", source)!,
        );
        const after = history.session.project.tilesets[0]!;
        expect(after.columns).toBeGreaterThan(1);
        expect(after.tiles.length).toBe(4097);
        expect(after.tiles.map((tile) => colorOf(after, tile.id))).toEqual([
            ...specs.map((spec) => spec.color),
            7,
        ]);
    });
});

describe("refusals", () => {
    function refusal(run: () => unknown): TilesetUpdateError {
        try {
            run();
        } catch (error) {
            expect(error).toBeInstanceOf(TilesetUpdateError);
            return error as TilesetUpdateError;
        }
        throw new Error("not refused");
    }

    it("a source of another tile size", () => {
        const project = fixtureProject(fixtureTileset([{ key: [0, 0], color: 1 }]));
        const before = snapshotProject(project);
        const source = { ...sourceOf([{ key: [0, 0], color: 1 }]), tileWidth: 4, tileHeight: 3 };
        const error = refusal(() => updateFromSourceCommand(project, "ts", source));
        expect(error.code).toBe("tile-size");
        expect(error.message).toContain("tile size changed from 2 × 2 to 4 × 3");
        expect(snapshotProject(project)).toStrictEqual(before);
    });

    it("an atlas re-read whose frames grew: tile size changed from 16 × 16 to 32 × 32", async () => {
        const project = emptyProject();
        const frames = {
            a: { x: 0, y: 0, w: 16, h: 16, sourceW: 16, sourceH: 16 },
            b: { x: 16, y: 0, w: 16, h: 16, sourceW: 16, sourceH: 16 },
        };
        const { tileset } = await importAtlas(
            project,
            atlasJson(32, 16, frames),
            png(positionImage(32, 16)),
            { fileName: "hero.atlas.json" },
        );
        new History(createProjectSession(project)).execute(addTilesetCommand(tileset));
        const larger = atlasJson(64, 32, {
            a: { x: 0, y: 0, w: 32, h: 32, sourceW: 32, sourceH: 32 },
            b: { x: 32, y: 0, w: 32, h: 32, sourceW: 32, sourceH: 32 },
        });
        const error = await readUpdateSource(project, tileset.id, {
            kind: "atlas",
            json: larger,
            png: png(positionImage(64, 32)),
        }).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(TilesetUpdateError);
        expect((error as TilesetUpdateError).code).toBe("tile-size");
        expect((error as TilesetUpdateError).message).toContain(
            "tile size changed from 16 × 16 to 32 × 32",
        );
    });

    it("a source of another kind, and a collection tileset (TE-062)", async () => {
        const tileset = fixtureTileset([{ key: [0, 0], color: 1 }]);
        const project = fixtureProject(tileset);
        const sprite = readUpdateSource(project, "ts", { kind: "sprite", bytes: new Uint8Array() });
        await expect(sprite).rejects.toMatchObject({ code: "source-kind" });
        tileset.source = { kind: "collection", fileName: "tiles.tsj", margin: 0, spacing: 0 };
        tileset.tiles[0]!.sourceKey = "grass.png";
        const image = readUpdateSource(project, "ts", { kind: "image", png: new Uint8Array() });
        await expect(image).rejects.toMatchObject({ code: "source-kind" });
        const source = sourceOf([{ key: "grass.png", color: 1 }]);
        expect(updateFromSourceCommand(project, "ts", source)).toBeNull();
    });
});

describe("each kind of source re-read with the recorded parameters", () => {
    it("grid PNG: margin and spacing kept; changed by key and new tiles at the end", async () => {
        const project = emptyProject();
        const history = new History(createProjectSession(project), { verify: assertInvariants });
        const options = {
            fileName: "ground.png",
            tileWidth: 4,
            tileHeight: 4,
            margin: 1,
            spacing: 1,
        };
        // 2 × 2 tiles in 10 × 10 px; then 3 × 2 tiles in another colour.
        const { tileset } = await importGridPng(project, png(positionImage(10, 10)), options);
        history.execute(addTilesetCommand(tileset));
        const source = await readUpdateSource(project, tileset.id, {
            kind: "image",
            png: png(positionImage(15, 10, 9)),
        });
        expect(source.entries.map((entry) => entry.key)).toEqual([
            [0, 0],
            [1, 0],
            [2, 0],
            [0, 1],
            [1, 1],
            [2, 1],
        ]);
        history.execute(updateFromSourceCommand(project, tileset.id, source)!);
        const after = project.tilesets[0]!;
        expect(after.tiles.map((tile) => [tile.id, tile.sourceKey])).toEqual([
            [0, [0, 0]],
            [1, [1, 0]],
            [2, [0, 1]],
            [3, [1, 1]],
            [4, [2, 0]],
            [5, [2, 1]],
        ]);
        // Tile 2 is the source's cell [0, 1]: its first pixel is at (1, 6), tag 9.
        const k = 2;
        const x = (k % after.columns) * 4;
        const y = Math.floor(k / after.columns) * 4;
        const at = (y * after.pixels.width + x) * 4;
        expect([...after.pixels.data.subarray(at, at + 4)]).toEqual([1, 6, 9, 255]);
    });

    it("sprite project: sliced with the recorded grid; the same file changes nothing", async () => {
        const { sprite } = spriteFixture();
        const project = emptyProject();
        const grid = spriteGridDefaults(readSpriteOutline(sprite))!;
        const { tileset } = await importSprite(project, sprite, {
            fileName: "tiles.ngsprite",
            ...grid,
        });
        new History(createProjectSession(project)).execute(addTilesetCommand(tileset));
        const source = await readUpdateSource(project, tileset.id, {
            kind: "sprite",
            bytes: sprite,
        });
        expect(source.entries.map((entry) => entry.key)).toEqual(
            tileset.tiles.map((tile) => tile.sourceKey),
        );
        expect(source.animations.length).toBe(
            tileset.tiles.filter((tile) => tile.animation.length > 0).length,
        );
        expect(updateFromSourceCommand(project, tileset.id, source)).toBeNull();
    });

    it("atlas: reordered frames keep their tiles", async () => {
        const project = emptyProject();
        const history = new History(createProjectSession(project), { verify: assertInvariants });
        const a = { x: 0, y: 0, w: 4, h: 4, sourceW: 4, sourceH: 4 };
        const b = { x: 4, y: 0, w: 4, h: 4, sourceW: 4, sourceH: 4 };
        const image = png(positionImage(8, 4));
        const { tileset } = await importAtlas(project, atlasJson(8, 4, { a, b }), image, {
            fileName: "hero.atlas.json",
        });
        history.execute(addTilesetCommand(tileset));
        // Frame "b" first now, and named "c".
        const json = atlasJson(8, 4, { c: b, a });
        const source = await readUpdateSource(project, tileset.id, {
            kind: "atlas",
            json,
            png: image,
        });
        history.execute(updateFromSourceCommand(project, tileset.id, source)!);
        expect(project.tilesets[0]!.tiles.map((tile) => [tile.id, tile.sourceKey])).toEqual([
            [0, "a"],
            [1, "c"],
        ]);
    });
});

describe("removed tiles leave the current stamp and the clipboard", () => {
    const stamp = (cells: number[]): Stamp => ({
        width: cells.length,
        height: 1,
        cells: Uint32Array.from(cells),
    });
    const held = (value: Stamp | null | undefined) => (value ? [...value.cells] : null);
    const history = () => sessionStore.getState().history;

    /** Tile 0 missing, tile 1 matched, one new entry (ID 2). */
    function load(): { project: Project; source: SourceTiles } {
        const project = fixtureProject(
            fixtureTileset([
                { key: [0, 0], color: 1 },
                { key: [1, 0], color: 2 },
            ]),
        );
        sessionStore.getState().replace(createProjectSession(project));
        const source = sourceOf([
            { key: [1, 0], color: 2 },
            { key: [2, 0], color: 3 },
        ]);
        return { project, source };
    }

    beforeEach(() => setCurrentStamp(null));

    it.each([
        ["Delete", { kind: "delete" } as TileResolution],
        ["Replace", { kind: "replace", entry: 1 } as TileResolution],
    ])("after %s, and after its redo; the other cells unchanged", (_, resolution) => {
        const { project, source } = load();
        setCurrentStamp(stamp([cell(0), cell(1), 0, cell(0, 0x80000000)]));
        copyCellsToClipboard(stamp([cell(1), cell(0)]));
        history().execute(
            updateFromSourceCommand(project, "ts", source, new Map([[0, resolution]]))!,
        );
        expect(held(currentStamp())).toEqual([0, cell(1), 0, 0]);
        expect(held(clipboardContent()?.stamp)).toEqual([cell(1), 0]);

        // Undo puts the tile back but not the cells; redo removes it again.
        history().undo();
        setCurrentStamp(stamp([cell(0), cell(1)]));
        copyCellsToClipboard(stamp([cell(0)]));
        history().redo();
        expect(held(currentStamp())).toEqual([0, cell(1)]);
        expect(clipboardContent()).toBeNull();
    });

    it("after undoing an apply that added tiles", () => {
        const { project, source } = load();
        history().execute(
            updateFromSourceCommand(project, "ts", source, new Map([[0, { kind: "keep" }]]))!,
        );
        expect(project.tilesets[0]!.tiles.map((tile) => tile.id)).toEqual([0, 1, 2]);
        setCurrentStamp(stamp([cell(2), cell(0), cell(1)]));
        copyCellsToClipboard(stamp([cell(2)]));
        history().undo();
        expect(held(currentStamp())).toEqual([0, cell(0), cell(1)]);
        expect(clipboardContent()).toBeNull();
    });
});
