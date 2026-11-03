import { describe, expect, it } from "vitest";
import { FLIP_D, FLIP_H } from "../../src/core/cells";
import type { History } from "../../src/core/history";
import type { Project, Tileset } from "../../src/core/model";
import { TilesetUpdateError, matchTiles, updateFromSourceCommand } from "../../src/core/tileset";
import type { SourceTiles, TileResolution } from "../../src/core/tileset";
import { snapshotProject } from "./support/symmetry";
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
import type { TileSpec } from "./te-027-support";

// TE-027: the matching of "Update tileset from source" (SPEC §6.3), one case per step and per
// resolution, with the tile IDs and the cells afterwards. Matched tiles keep their IDs, so maps
// change only through Delete and Replace.

interface Run {
    history: History;
    project: Project;
    tileset: Tileset;
}

/** A project over a tileset of `specs` with cells of tiles painted in both maps. */
function given(
    specs: readonly TileSpec[],
    paint: [x: number, y: number, value: number][] = [],
): Run {
    const tileset = fixtureTileset(specs);
    const project = fixtureProject(tileset);
    const [first, second] = layers(project);
    for (const [x, y, value] of paint) {
        first.cells.set(x, y, value);
        second.cells.set(y, x, value);
    }
    return { history: historyOf(project), project, tileset };
}

/** Applies the update through the history; returns the cells of both maps before it. */
function update(
    run: Run,
    source: SourceTiles,
    resolutions: [number, TileResolution][] = [],
): { before: number[][][] } {
    const before = layers(run.project).map(cellsOf);
    const command = updateFromSourceCommand(run.project, "ts", source, new Map(resolutions));
    expect(command).not.toBeNull();
    run.history.execute(command!);
    return { before };
}

const ids = (tileset: Tileset) => tileset.tiles.map((tile) => tile.id);
const keys = (tileset: Tileset) => tileset.tiles.map((tile) => tile.sourceKey);
const colors = (tileset: Tileset) => tileset.tiles.map((tile) => colorOf(tileset, tile.id));
const mapCells = (project: Project) => layers(project).map(cellsOf);

describe("matching order", () => {
    it("1. unique fingerprint: each tile takes its entry, keeps its ID; a new key is a move", () => {
        const run = given(
            [
                { key: [0, 0], color: 1 },
                { key: [1, 0], color: 2 },
                { key: [2, 0], color: 3 },
            ],
            [
                [0, 0, cell(0)],
                [1, 0, cell(1, FLIP_H)],
                [2, 0, cell(2)],
            ],
        );
        const source = sourceOf([
            { key: [0, 0], color: 2 },
            { key: [1, 0], color: 1 },
            { key: [2, 0], color: 3 },
        ]);
        const match = matchTiles(run.tileset.tiles, source.entries);
        expect(match.matched).toEqual([
            { tileId: 0, entry: 1, kind: "moved" },
            { tileId: 1, entry: 0, kind: "moved" },
            { tileId: 2, entry: 2, kind: "unchanged" },
        ]);
        expect(match.summary).toEqual({
            unchanged: 1,
            moved: 2,
            changed: 0,
            new: 0,
            ambiguous: 0,
            missing: 0,
        });

        const { before } = update(run, source);
        const tileset = run.project.tilesets[0]!;
        expect(ids(tileset)).toEqual([0, 1, 2]);
        expect(keys(tileset)).toEqual([
            [1, 0],
            [0, 0],
            [2, 0],
        ]);
        expect(colors(tileset)).toEqual([1, 2, 3]);
        expect(mapCells(run.project)).toEqual(before);
    });

    it("2. same key: a tile whose fingerprint is not unique takes the entry of its key and its pixels", () => {
        const run = given(
            [
                { key: [0, 0], color: 1 },
                { key: [1, 0], color: 1 },
            ],
            [
                [3, 3, cell(0)],
                [4, 3, cell(1)],
            ],
        );
        const source = sourceOf([
            { key: [0, 0], color: 5 },
            { key: [1, 0], color: 1 },
        ]);
        const match = matchTiles(run.tileset.tiles, source.entries);
        expect(match.matched).toEqual([
            { tileId: 0, entry: 0, kind: "changed" },
            { tileId: 1, entry: 1, kind: "unchanged" },
        ]);
        expect(match.summary).toMatchObject({ unchanged: 1, changed: 1, new: 0 });

        const { before } = update(run, source);
        const tileset = run.project.tilesets[0]!;
        expect(ids(tileset)).toEqual([0, 1]);
        expect(colors(tileset)).toEqual([5, 1]);
        expect(tileset.tiles[0]!.fingerprint).toBe(source.entries[0]!.fingerprint);
        expect(mapCells(run.project)).toEqual(before);
    });

    it("3. ambiguous: a fingerprint several entries have; the candidate taken, the others new", () => {
        const run = given(
            [
                { key: [0, 0], color: 1 },
                { key: [1, 0], color: 2 },
            ],
            [[0, 0, cell(0)]],
        );
        const source = sourceOf([
            { key: [4, 0], color: 1 },
            { key: [5, 0], color: 1 },
            { key: [1, 0], color: 2 },
        ]);
        const match = matchTiles(run.tileset.tiles, source.entries);
        expect(match.matched).toEqual([{ tileId: 1, entry: 2, kind: "unchanged" }]);
        expect(match.ambiguous).toEqual([{ tileId: 0, candidates: [0, 1] }]);
        expect(match.unmatchedEntries).toEqual([0, 1]);
        expect(match.summary).toMatchObject({ unchanged: 1, ambiguous: 1, new: 2, missing: 0 });

        const { before } = update(run, source, [[0, { kind: "candidate", entry: 1 }]]);
        const tileset = run.project.tilesets[0]!;
        expect(ids(tileset)).toEqual([0, 1, 2]);
        expect(keys(tileset)).toEqual([
            [5, 0],
            [1, 0],
            [4, 0],
        ]);
        expect(colors(tileset)).toEqual([1, 2, 1]);
        expect(mapCells(run.project)).toEqual(before);
    });

    it("3. ambiguous: a fingerprint shared with other unmatched old tiles", () => {
        const run = given(
            [
                { key: [0, 0], color: 1 },
                { key: [1, 0], color: 1 },
            ],
            [
                [0, 0, cell(0)],
                [1, 0, cell(1)],
            ],
        );
        const source = sourceOf([{ key: [7, 0], color: 1 }]);
        const match = matchTiles(run.tileset.tiles, source.entries);
        expect(match.matched).toEqual([]);
        expect(match.ambiguous).toEqual([
            { tileId: 0, candidates: [0] },
            { tileId: 1, candidates: [0] },
        ]);
        expect(match.missing).toEqual([]);

        const { before } = update(run, source, [
            [0, { kind: "keep" }],
            [1, { kind: "candidate", entry: 0 }],
        ]);
        const tileset = run.project.tilesets[0]!;
        expect(ids(tileset)).toEqual([0, 1]);
        expect(keys(tileset)).toEqual([null, [7, 0]]);
        expect(mapCells(run.project)).toEqual(before);
    });

    it("4. missing: neither fingerprint nor key in the source", () => {
        const run = given(
            [
                { key: [0, 0], color: 1 },
                { key: [1, 0], color: 2 },
            ],
            [
                [0, 0, cell(0)],
                [1, 0, cell(1)],
            ],
        );
        const source = sourceOf([
            { key: [1, 0], color: 2 },
            { key: [2, 0], color: 3 },
        ]);
        const match = matchTiles(run.tileset.tiles, source.entries);
        expect(match.matched).toEqual([{ tileId: 1, entry: 0, kind: "unchanged" }]);
        expect(match.ambiguous).toEqual([]);
        expect(match.missing).toEqual([0]);
        expect(match.summary).toEqual({
            unchanged: 1,
            moved: 0,
            changed: 0,
            new: 1,
            ambiguous: 0,
            missing: 1,
        });

        // Kept as is, the missing tile and its cells stay; the entry is a new tile.
        const { before } = update(run, source, [[0, { kind: "keep" }]]);
        const tileset = run.project.tilesets[0]!;
        expect(ids(tileset)).toEqual([0, 1, 2]);
        expect(keys(tileset)).toEqual([null, [1, 0], [2, 0]]);
        expect(colors(tileset)).toEqual([1, 2, 3]);
        expect(mapCells(run.project)).toEqual(before);
    });

    it("5. new tiles: IDs from nextTileId at the end, with the import's animations", () => {
        const tileset = fixtureTileset(
            [
                { key: [0, 0], color: 1 },
                { key: [1, 0], color: 2 },
            ],
            10,
        );
        const project = fixtureProject(tileset);
        const history = historyOf(project);
        tileset.tiles[0]!.animation = [
            { tile: 0, ms: 50 },
            { tile: 1, ms: 50 },
        ];
        const source = sourceOf(
            [
                { key: [0, 0], color: 1 },
                { key: [1, 0], color: 2 },
                { key: [2, 0], color: 3 },
                { key: [3, 0], color: 4 },
            ],
            [
                // On an entry an old tile takes: the tile keeps its own animation.
                { entry: 0, frames: [{ entry: 3, ms: 5 }] },
                // On a new entry, through an old tile's entry and a new one.
                {
                    entry: 2,
                    frames: [
                        { entry: 2, ms: 100 },
                        { entry: 1, ms: 200 },
                        { entry: 3, ms: 300 },
                    ],
                },
            ],
        );
        layers(project)[0].cells.set(6, 6, cell(1));
        history.execute(updateFromSourceCommand(project, "ts", source)!);
        const after = project.tilesets[0]!;
        expect(ids(after)).toEqual([0, 1, 10, 11]);
        expect(mapCells(project)).toEqual([[[6, 6, cell(1)]], []]);
        expect(after.nextTileId).toBe(12);
        expect(colors(after)).toEqual([1, 2, 3, 4]);
        expect(keys(after)).toEqual([
            [0, 0],
            [1, 0],
            [2, 0],
            [3, 0],
        ]);
        expect(after.tiles[0]!.animation).toEqual([
            { tile: 0, ms: 50 },
            { tile: 1, ms: 50 },
        ]);
        expect(after.tiles[2]!.animation).toEqual([
            { tile: 10, ms: 100 },
            { tile: 1, ms: 200 },
            { tile: 11, ms: 300 },
        ]);
        expect(after.tiles[3]!.animation).toEqual([]);
    });

    it("matched tiles keep class, properties, collision and animation", () => {
        const run = given([
            { key: [0, 0], color: 1 },
            { key: [1, 0], color: 2 },
        ]);
        const kept = {
            class: "Wall",
            properties: [{ name: "solid", type: "bool" as const, value: true }],
            collision: [{ shape: "rectangle" as const, x: 0, y: 0, width: 2, height: 1 }],
            animation: [
                { tile: 0, ms: 10 },
                { tile: 1, ms: 20 },
            ],
        };
        Object.assign(run.tileset.tiles[0]!, kept);
        Object.assign(run.tileset.tiles[1]!, { ...kept, class: "Floor" });
        // Tile 0 moves, tile 1 changes in place.
        update(
            run,
            sourceOf([
                { key: [1, 0], color: 9 },
                { key: [5, 0], color: 1 },
            ]),
            [],
        );
        const [moved, changed] = run.project.tilesets[0]!.tiles;
        expect(moved).toMatchObject({ id: 0, sourceKey: [5, 0], ...kept });
        expect(changed).toMatchObject({ id: 1, sourceKey: [1, 0], ...kept, class: "Floor" });
    });

    it("an update that changes nothing makes no command", () => {
        const run = given([{ key: [0, 0], color: 1 }]);
        expect(
            updateFromSourceCommand(run.project, "ts", sourceOf([{ key: [0, 0], color: 1 }])),
        ).toBeNull();
    });
});

describe("resolutions", () => {
    /** Tile 0 missing (painted), tile 1 matched (painted), and two new entries. */
    function missingRun(): { run: Run; source: SourceTiles } {
        const run = given(
            [
                { key: [0, 0], color: 1 },
                { key: [1, 0], color: 2 },
            ],
            [
                [0, 0, cell(0)],
                [1, 0, cell(0, FLIP_H | FLIP_D)],
                [2, 0, cell(1)],
            ],
        );
        const source = sourceOf([
            { key: [1, 0], color: 2 },
            { key: [2, 0], color: 3 },
            { key: [3, 0], color: 4 },
        ]);
        return { run, source };
    }

    it("a candidate: the tile takes it, maps unchanged", () => {
        const run = given([{ key: [0, 0], color: 1 }], [[5, 5, cell(0)]]);
        const source = sourceOf([
            { key: [1, 0], color: 1 },
            { key: [2, 0], color: 1 },
        ]);
        const { before } = update(run, source, [[0, { kind: "candidate", entry: 0 }]]);
        const tileset = run.project.tilesets[0]!;
        expect(ids(tileset)).toEqual([0, 1]);
        expect(keys(tileset)).toEqual([
            [1, 0],
            [2, 0],
        ]);
        expect(mapCells(run.project)).toEqual(before);
    });

    it("Keep as is: pixels kept, key null, maps unchanged", () => {
        const { run, source } = missingRun();
        const { before } = update(run, source, [[0, { kind: "keep" }]]);
        const tileset = run.project.tilesets[0]!;
        expect(ids(tileset)).toEqual([0, 1, 2, 3]);
        expect(keys(tileset)).toEqual([null, [1, 0], [2, 0], [3, 0]]);
        expect(colors(tileset)).toEqual([1, 2, 3, 4]);
        expect(mapCells(run.project)).toEqual(before);
    });

    it("Delete: the tile goes, its cells erased in every map, animation frames and terrain on it removed", () => {
        const { run, source } = missingRun();
        run.tileset.tiles[1]!.animation = [
            { tile: 0, ms: 10 },
            { tile: 1, ms: 20 },
            { tile: 0, ms: 30 },
        ];
        run.tileset.terrainSets = [
            {
                name: "Ground",
                type: "corner",
                colors: [{ name: "Grass", color: "#00ff00ff", tile: 0 }],
                tiles: [
                    { tile: 0, wangId: [0, 1, 0, 1, 0, 1, 0, 1] },
                    { tile: 1, wangId: [0, 1, 0, 1, 0, 0, 0, 0] },
                ],
            },
        ];
        update(run, source, [[0, { kind: "delete" }]]);
        const tileset = run.project.tilesets[0]!;
        expect(ids(tileset)).toEqual([1, 2, 3]);
        expect(colors(tileset)).toEqual([2, 3, 4]);
        expect(tileset.tiles[0]!.animation).toEqual([{ tile: 1, ms: 20 }]);
        expect(tileset.terrainSets[0]!.colors[0]!.tile).toBeNull();
        expect(tileset.terrainSets[0]!.tiles.map((t) => t.tile)).toEqual([1]);
        // Only the matched tile's cell is left, in both maps.
        expect(mapCells(run.project)).toEqual([[[2, 0, cell(1)]], [[0, 2, cell(1)]]]);
    });

    it("Replace with a tile of the new source: cells rewritten to it, flags kept", () => {
        const { run, source } = missingRun();
        update(run, source, [[0, { kind: "replace", entry: 2 }]]);
        const tileset = run.project.tilesets[0]!;
        // Entry 2 is the second new tile, ID 3.
        expect(ids(tileset)).toEqual([1, 2, 3]);
        expect(colors(tileset)).toEqual([2, 3, 4]);
        const first = [
            [0, 0, cell(3)],
            [1, 0, cell(3, FLIP_H | FLIP_D)],
            [2, 0, cell(1)],
        ];
        const second = [
            [0, 0, cell(3)],
            [0, 1, cell(3, FLIP_H | FLIP_D)],
            [0, 2, cell(1)],
        ];
        expect(mapCells(run.project)).toEqual([first, second]);
    });

    it("Replace with a tile an old tile matched: cells rewritten to that tile's ID", () => {
        const { run, source } = missingRun();
        update(run, source, [[0, { kind: "replace", entry: 0 }]]);
        expect(layers(run.project)[0].cells.get(1, 0)).toBe(cell(1, FLIP_H | FLIP_D));
        expect(ids(run.project.tilesets[0]!)).toEqual([1, 2, 3]);
    });

    describe("refused before any change", () => {
        function expectRefused(
            resolutions: [number, TileResolution][],
            run: Run,
            source: SourceTiles,
        ) {
            const before = snapshotProject(run.project);
            let caught: unknown;
            try {
                updateFromSourceCommand(run.project, "ts", source, new Map(resolutions));
            } catch (error) {
                caught = error;
            }
            expect(caught).toBeInstanceOf(TilesetUpdateError);
            expect((caught as TilesetUpdateError).code).toBe("resolution");
            expect(snapshotProject(run.project)).toStrictEqual(before);
        }

        it("a missing tile without a resolution", () => {
            const { run, source } = missingRun();
            expectRefused([], run, source);
        });

        it("a resolution for a matched tile", () => {
            const { run, source } = missingRun();
            expectRefused(
                [
                    [0, { kind: "keep" }],
                    [1, { kind: "delete" }],
                ],
                run,
                source,
            );
        });

        it("a candidate for a missing tile, or one not among the tile's", () => {
            const { run, source } = missingRun();
            expectRefused([[0, { kind: "candidate", entry: 1 }]], run, source);
        });

        it("one candidate taken by two tiles", () => {
            const run = given([
                { key: [0, 0], color: 1 },
                { key: [1, 0], color: 1 },
            ]);
            const source = sourceOf([{ key: [7, 0], color: 1 }]);
            expectRefused(
                [
                    [0, { kind: "candidate", entry: 0 }],
                    [1, { kind: "candidate", entry: 0 }],
                ],
                run,
                source,
            );
        });

        it("a replacement the source does not have", () => {
            const { run, source } = missingRun();
            expectRefused([[0, { kind: "replace", entry: 3 }]], run, source);
        });
    });
});
