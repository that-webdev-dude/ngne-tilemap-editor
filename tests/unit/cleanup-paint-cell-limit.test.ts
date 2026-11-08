import { describe, expect, it } from "vitest";
import { History } from "../../src/core/history";
import type { Command } from "../../src/core/history";
import { newLayerCommand, setLayerValuesCommand } from "../../src/core/layers";
import {
    CellLimitError,
    MAX_CELLS_PER_LAYER,
    MAX_CELLS_PER_MAP,
    assertInvariants,
    walkLayers,
} from "../../src/core/model";
import type { ProjectVerifier } from "../../src/core/history";
import type { TileLayer } from "../../src/core/model";
import { MAP, newSession, tile } from "./te-006-support";

// The cells-per-map limit of FORMAT §2.8 (4 194 304 cells in all tile layers of a map) holds
// for every step of the history, not only for layer commands: a stroke or a command that
// would take a map past it is refused whole, with the cells as they were and no entry, in
// production (no verifier) as in development builds.

const SIDE = 1024;

/** The map's tile layers, bottom to top. */
function tileLayers(history: History): TileLayer[] {
    const map = history.session.project.maps[0]!;
    return [...walkLayers(map.layers)]
        .map(({ layer }) => layer)
        .filter((layer): layer is TileLayer => layer.type === "tile");
}

/**
 * A history on a 1024 × 1024 map with five tile layers, the first four full (the map holds
 * `MAX_CELLS_PER_MAP` cells) and the fifth empty; `gap` leaves cell (0, 0) of the fourth empty.
 */
function fullMap(verify: ProjectVerifier | null, gap = false): History {
    const history = new History(newSession(SIDE, SIDE), { verify });
    for (let k = 0; k < 4; k++) history.execute(newLayerCommand(MAP, "tile"));
    const layers = tileLayers(history);
    expect(layers).toHaveLength(5);
    for (const layer of layers.slice(0, 4)) {
        for (let y = 0; y < SIDE; y++) {
            for (let x = 0; x < SIDE; x++) layer.cells.set(x, y, tile(0));
        }
    }
    if (gap) layers[3]!.cells.set(0, 0, 0);
    expect(4 * MAX_CELLS_PER_LAYER).toBe(MAX_CELLS_PER_MAP);
    return history;
}

/** Paints cell (`x`, `y`) of `layer` in one stroke and commits it. */
function stroke(history: History, layer: TileLayer, x: number, y: number): Command | null {
    const transaction = history.begin({ mapId: MAP, layerId: layer.id });
    transaction.set(x, y, tile(1));
    return transaction.commit("Stamp Brush");
}

const builds: [string, ProjectVerifier | null][] = [
    ["production (no verifier)", null],
    ["development (invariants)", assertInvariants],
];

describe.each(builds)("Cells per map limit, %s", (_, verify) => {
    it("refuses a stroke that would pass it, with the cells as they were and no entry", () => {
        const history = fullMap(verify);
        const fifth = tileLayers(history)[4]!;
        const position = history.position;

        expect(() => stroke(history, fifth, 10, 20)).toThrow(CellLimitError);
        expect(fifth.cells.get(10, 20)).toBe(0);
        expect(fifth.cells.count).toBe(0);
        expect(history.position).toBe(position);
        expect(history.transaction).toBeNull();
    });

    it("accepts a stroke that reaches it exactly", () => {
        const history = fullMap(verify, true);
        const fifth = tileLayers(history)[4]!;

        expect(stroke(history, fifth, 0, 0)).not.toBeNull();
        expect(fifth.cells.get(0, 0)).toBe(tile(1));
        expect(() => stroke(history, fifth, 1, 0)).toThrow(CellLimitError);
        expect(fifth.cells.get(1, 0)).toBe(0);
    });

    it("refuses a command that would pass it, with the project unchanged", () => {
        const history = fullMap(verify);
        const fifth = tileLayers(history)[4]!;
        const position = history.position;
        const fill: Command = {
            label: "Paste",
            bytes: 0,
            touched: {
                mapId: MAP,
                layerIds: [fifth.id],
                cellRects: [{ x: 0, y: 0, width: 1, height: 1 }],
                tilesetIds: [],
                structure: false,
            },
            do: () => void fifth.cells.set(0, 0, tile(1)),
            undo: () => void fifth.cells.set(0, 0, 0),
        };

        expect(() => history.execute(fill)).toThrow(CellLimitError);
        expect(fifth.cells.get(0, 0)).toBe(0);
        expect(history.position).toBe(position);
    });

    it("keeps layer commands working after a refused stroke", () => {
        const history = fullMap(verify);
        const [first, , , , fifth] = tileLayers(history);
        expect(() => stroke(history, fifth!, 0, 0)).toThrow(CellLimitError);

        const project = history.session.project;
        history.execute(setLayerValuesCommand(project, MAP, [first!.id], { visible: false }));
        expect(first!.visible).toBe(false);
        history.execute(newLayerCommand(MAP, "tile"));
        expect(tileLayers(history)).toHaveLength(6);
    });
});
