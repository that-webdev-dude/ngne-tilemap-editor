import { describe, expect, it } from "vitest";
import { cellValue } from "../../src/core/cells";
import { History } from "../../src/core/history";
import {
    MapEditError,
    RESIZE_ANCHORS,
    RESIZE_MAP_LABEL,
    anchorOffset,
    clampOffset,
    offsetRange,
    resizeMapCommand,
    resizeMapProblems,
    resizeSource,
} from "../../src/core/maps";
import type { ResizeMapValues } from "../../src/core/maps";
import {
    MAX_CELLS_PER_LAYER,
    MAX_MAP_SIDE,
    MAX_MARKER_COORD,
    assertInvariants,
    MAX_LAYER_OFFSET,
    createGroupLayer,
    createImageLayer,
    createMarkerLayer,
    createProject,
    createProjectSession,
    createTileLayer,
    sequentialIds,
} from "../../src/core/model";
import type {
    GroupLayer,
    ImageLayer,
    Marker,
    MarkerLayer,
    ProjectMap,
    TileLayer,
} from "../../src/core/model";
import { expectSymmetric, snapshotProject } from "./support/symmetry";
import { tileset } from "./te-006-support";
import { movePivotPreset } from "../../src/ui/sprite/pivotGridKeys";

// TE-033: Resize / Offset Map (SPEC §7.1; Tiled's `MapDocument::resizeMap`), in `core/maps`.
// The fixture map is 5 × 4 cells of 16 × 8 px: a full tile layer at the bottom, and a group
// holding a sparse tile layer and a marker layer, so nested layers are covered. Cells move by
// the offset and those outside the new bounds go; markers move by the offset in pixels and are
// kept outside the bounds.

const WIDTH = 5;
const HEIGHT = 4;
const TILE_WIDTH = 16;
const TILE_HEIGHT = 8;

const v = (tile: number) => cellValue(1, tile, 0);

function marker(id: number, shape: Partial<Marker> & Pick<Marker, "shape">): Marker {
    return { x: 0, y: 0, id, name: "", class: "", properties: [], ...shape } as Marker;
}

function fixture(): History {
    const project = createProject({
        newId: sequentialIds(),
        map: { width: WIDTH, height: HEIGHT, tileWidth: TILE_WIDTH, tileHeight: TILE_HEIGHT },
    });
    project.tilesets.push(tileset("ts", 1, 64));
    const map = project.maps[0]!;
    const ground = map.layers[0] as TileLayer;
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) ground.cells.set(x, y, v(y * WIDTH + x));
    }
    const group = createGroupLayer(2, "Group");
    const detail = createTileLayer(3, "Detail");
    detail.cells.set(0, 0, v(40));
    detail.cells.set(4, 3, v(41));
    const markers = createMarkerLayer(4, "Markers");
    markers.offsetX = 3;
    markers.markers.push(
        marker(1, { shape: "rectangle", x: 10, y: 4, width: 20, height: 8 }),
        marker(2, { shape: "point", x: 70, y: 30 }),
        marker(3, {
            shape: "polygon",
            x: 32,
            y: 16,
            points: [
                [0, 0],
                [8, 0],
                [0, 8],
            ],
        }),
    );
    group.layers.push(detail, markers);
    map.layers.push(group);
    map.nextLayerId = 5;
    map.nextMarkerId = 4;
    assertInvariants(project);
    return new History(createProjectSession(project), { verify: assertInvariants });
}

const mapOf = (history: History): ProjectMap => history.session.project.maps[0]!;
const MAP = "id2";
const groupOf = (history: History) => mapOf(history).layers[1] as GroupLayer;
const layers = (history: History) => ({
    ground: mapOf(history).layers[0] as TileLayer,
    detail: groupOf(history).layers[0] as TileLayer,
    markers: groupOf(history).layers[1] as MarkerLayer,
});

/** Every non-empty cell of `layer` inside `width × height` as `[x, y, value]`, row by row. */
function cells(layer: TileLayer, width: number, height: number): number[][] {
    const out: number[][] = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const value = layer.cells.get(x, y);
            if (value !== 0) out.push([x, y, value]);
        }
    }
    return out;
}

/** The cells of `before` moved by the offset of `values`, those outside the new size left out. */
function expectedCells(before: number[][], values: ResizeMapValues): number[][] {
    return before
        .map(([x, y, value]) => [x! + values.offsetX, y! + values.offsetY, value!])
        .filter(([x, y]) => x! >= 0 && y! >= 0 && x! < values.width && y! < values.height)
        .sort((a, b) => a[1]! - b[1]! || a[0]! - b[0]!);
}

const SIZES: readonly [string, number, number][] = [
    ["grow", 8, 7],
    ["shrink", 2, 3],
    ["grow wide, shrink tall", 9, 2],
];

describe("Resize / Offset Map: cells and markers", () => {
    for (const [name, width, height] of SIZES) {
        for (const anchor of RESIZE_ANCHORS) {
            it(`${name} to ${width} × ${height} at ${anchor.name}`, () => {
                const history = fixture();
                const values: ResizeMapValues = {
                    width,
                    height,
                    offsetX: anchorOffset(anchor.x, WIDTH, width),
                    offsetY: anchorOffset(anchor.y, HEIGHT, height),
                };
                const before = layers(history);
                const groundBefore = cells(before.ground, WIDTH, HEIGHT);
                const detailBefore = cells(before.detail, WIDTH, HEIGHT);
                const markersBefore = structuredClone(before.markers.markers);

                const command = expectSymmetric(
                    history,
                    resizeMapCommand(history.session.project, MAP, values)!,
                );

                expect(command.label).toBe(RESIZE_MAP_LABEL);
                expect(mapOf(history)).toMatchObject({ width, height });
                const after = layers(history);
                expect(cells(after.ground, width, height)).toEqual(
                    expectedCells(groundBefore, values),
                );
                expect(after.ground.cells.count).toBe(expectedCells(groundBefore, values).length);
                expect(cells(after.detail, width, height)).toEqual(
                    expectedCells(detailBefore, values),
                );
                // Markers move by the offset in pixels, all kept; their layer offset stays.
                expect(after.markers.markers).toStrictEqual(
                    markersBefore.map((each) => ({
                        ...each,
                        x: each.x + values.offsetX * TILE_WIDTH,
                        y: each.y + values.offsetY * TILE_HEIGHT,
                    })),
                );
                expect(after.markers.offsetX).toBe(3);
            });
        }
    }

    it("an offset alone moves the cells of a map of the same size", () => {
        const history = fixture();
        // Same size: the only offset in range is 0, so grow by one and anchor bottom-right.
        const values = { width: WIDTH + 1, height: HEIGHT + 1, offsetX: 1, offsetY: 1 };
        expectSymmetric(history, resizeMapCommand(history.session.project, MAP, values)!);
        const { ground, detail, markers } = layers(history);
        expect(ground.cells.get(0, 0)).toBe(0);
        expect(ground.cells.get(1, 1)).toBe(v(0));
        expect(ground.cells.get(5, 4)).toBe(v(19));
        expect(detail.cells.get(1, 1)).toBe(v(40));
        expect(detail.cells.get(5, 4)).toBe(v(41));
        expect(markers.markers[0]).toMatchObject({ x: 10 + 16, y: 4 + 8 });
        // Polygon points are relative to the marker: unchanged.
        expect(markers.markers[2]).toMatchObject({
            x: 48,
            y: 24,
            points: [
                [0, 0],
                [8, 0],
                [0, 8],
            ],
        });
    });

    it("a shrink keeps markers outside the new bounds", () => {
        const history = fixture();
        history.execute(
            resizeMapCommand(history.session.project, MAP, {
                width: 1,
                height: 1,
                offsetX: -4,
                offsetY: -3,
            })!,
        );
        const { ground, markers } = layers(history);
        expect(cells(ground, 1, 1)).toEqual([[0, 0, v(19)]]);
        expect(ground.cells.count).toBe(1);
        expect(markers.markers.map(({ x, y }) => [x, y])).toEqual([
            [10 - 64, 4 - 24],
            [70 - 64, 30 - 24],
            [32 - 64, 16 - 24],
        ]);
    });

    it("the same size and no offset make no entry", () => {
        const history = fixture();
        const values = { width: WIDTH, height: HEIGHT, offsetX: 0, offsetY: 0 };
        expect(resizeMapCommand(history.session.project, MAP, values)).toBeNull();
    });

    it("tells the viewport the tile layers changed structurally, and counts new chunks", () => {
        const history = fixture();
        const command = resizeMapCommand(history.session.project, MAP, {
            width: 64,
            height: 64,
            offsetX: 30,
            offsetY: 30,
        })!;
        expect(command.touched).toStrictEqual({
            mapId: MAP,
            layerIds: [1, 3],
            cellRects: [],
            tilesetIds: [],
            structure: true,
        });
        // Both layers sat in one chunk each; moved by 30 they spread over two by two.
        expect(command.projectBytes).toBe((4 + 2 - 2) * 32 * 32 * 4);
        expectSymmetric(history, command);
    });
});

describe("Resize / Offset Map: limits", () => {
    const from = { width: WIDTH, height: HEIGHT };

    /** Expects `values` refused by the command with `MapEditError` ("values"), nothing changed. */
    function expectRefused(values: ResizeMapValues, message: RegExp): void {
        const history = fixture();
        const before = snapshotProject(history.session.project);
        let caught: unknown = null;
        try {
            resizeMapCommand(history.session.project, MAP, values);
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(MapEditError);
        expect((caught as MapEditError).code).toBe("values");
        expect((caught as MapEditError).message).toMatch(message);
        expect(snapshotProject(history.session.project)).toStrictEqual(before);
        expect(history.undoCount).toBe(0);
    }

    it("a side above FORMAT §2.8 is refused", () => {
        expectRefused({ width: MAX_MAP_SIDE + 1, height: 4, offsetX: 0, offsetY: 0 }, /4096/);
        expectRefused({ width: 5, height: MAX_MAP_SIDE + 1, offsetX: 0, offsetY: 0 }, /4096/);
        expectRefused({ width: 0, height: 4, offsetX: 0, offsetY: 0 }, /from 1 to 4096/);
        expectRefused({ width: 2.5, height: 4, offsetX: 0, offsetY: 0 }, /whole number/);
    });

    it("more cells than FORMAT §2.8 allows a layer are refused", () => {
        expect(MAX_MAP_SIDE * MAX_MAP_SIDE).toBeGreaterThan(MAX_CELLS_PER_LAYER);
        expectRefused({ width: 4096, height: 257, offsetX: 0, offsetY: 0 }, /1,048,576 cells/);
        expect(
            resizeMapProblems(from, { width: 4096, height: 256, offsetX: 0, offsetY: 0 }),
        ).toEqual({});
    });

    it("an offset outside Tiled's range is refused", () => {
        expectRefused({ width: 8, height: 4, offsetX: 4, offsetY: 0 }, /offset X .* 0 to 3/);
        expectRefused({ width: 8, height: 4, offsetX: -1, offsetY: 0 }, /offset X .* 0 to 3/);
        expectRefused({ width: 2, height: 4, offsetX: -4, offsetY: 0 }, /offset X .* -3 to 0/);
        expectRefused({ width: 8, height: 4, offsetX: 0, offsetY: 1 }, /offset Y is 0 while/);
        expectRefused({ width: 8, height: 4, offsetX: 0.5, offsetY: 0 }, /offset X/);
    });

    it("an offset that moves a marker past the coordinate range is refused", () => {
        const history = fixture();
        layers(history).markers.markers[1]!.x = MAX_MARKER_COORD - 20;
        assertInvariants(history.session.project);
        expect(() =>
            resizeMapCommand(history.session.project, MAP, {
                width: 7,
                height: 4,
                offsetX: 2,
                offsetY: 0,
            }),
        ).toThrow(/marker 2 of “Markers”/);
    });

    it("offsetRange and clampOffset follow Tiled's ResizeHelper", () => {
        expect(offsetRange(5, 8)).toEqual({ min: 0, max: 3 });
        expect(offsetRange(5, 2)).toEqual({ min: -3, max: 0 });
        expect(offsetRange(5, 5)).toEqual({ min: 0, max: 0 });
        expect(clampOffset(7, offsetRange(5, 8))).toBe(3);
        expect(clampOffset(-7, offsetRange(5, 2))).toBe(-3);
    });
});

describe("Resize / Offset Map: anchors", () => {
    it("the nine anchors lie row by row from the top-left corner", () => {
        expect(RESIZE_ANCHORS.map((anchor) => anchor.id)).toEqual([
            "top-left",
            "top-centre",
            "top-right",
            "centre-left",
            "centre",
            "centre-right",
            "bottom-left",
            "bottom-centre",
            "bottom-right",
        ]);
        expect(RESIZE_ANCHORS[5]).toMatchObject({ name: "Centre right", x: 1, y: 0.5 });
    });

    it("an anchor offset truncates towards zero, so grow and shrink by one undo each other", () => {
        expect(anchorOffset(0.5, 5, 8)).toBe(1);
        expect(anchorOffset(0.5, 8, 5)).toBe(-1);
        expect(anchorOffset(1, 5, 8)).toBe(3);
        expect(anchorOffset(1, 8, 5)).toBe(-3);
        expect(anchorOffset(0, 8, 5)).toBe(0);
        expect(Object.is(anchorOffset(0.5, 5, 4), 0)).toBe(true);
    });

    it("arrow keys move the anchor inside the grid", () => {
        expect(movePivotPreset(4, "ArrowLeft")).toBe(3);
        expect(movePivotPreset(3, "ArrowLeft")).toBe(3);
        expect(movePivotPreset(4, "ArrowDown")).toBe(7);
        expect(movePivotPreset(7, "ArrowDown")).toBe(7);
        expect(movePivotPreset(2, "ArrowRight")).toBe(2);
        expect(movePivotPreset(1, "ArrowUp")).toBe(1);
        expect(movePivotPreset(1, "Enter")).toBeNull();
    });
});

describe("Resize / Offset Map: image layers (Tiled's resizeMap: SetLayerOffset by the offset)", () => {
    /** The fixture with an image layer on top, at layer offset (5, −2) px. */
    function withImage(): History {
        const history = fixture();
        const { project } = history.session;
        project.images.push({
            id: "img",
            name: "Sky",
            exportName: "sky",
            pixels: { width: 2, height: 2, data: new Uint8ClampedArray(16) },
        });
        const image = createImageLayer(5, "Sky", "img");
        image.offsetX = 5;
        image.offsetY = -2;
        mapOf(history).layers.push(image);
        mapOf(history).nextLayerId = 6;
        assertInvariants(project);
        return history;
    }
    const imageOf = (history: History) => mapOf(history).layers[2] as ImageLayer;

    it("an image layer moves by the offset in pixels, in the same entry", () => {
        const history = withImage();
        const values = { width: 8, height: 2, offsetX: 3, offsetY: -2 };
        expectSymmetric(history, resizeMapCommand(history.session.project, MAP, values)!);
        expect(imageOf(history)).toMatchObject({
            offsetX: 5 + 3 * TILE_WIDTH,
            offsetY: -2 - 2 * TILE_HEIGHT,
        });
    });

    it("an offset that moves an image layer past the layer offset range is refused", () => {
        const history = withImage();
        imageOf(history).offsetX = MAX_LAYER_OFFSET - 20;
        const values = { width: 7, height: 4, offsetX: 2, offsetY: 0 };
        expect(resizeMapProblems(resizeSource(mapOf(history)), values).offsetX).toMatch(
            /image layer/,
        );
        expect(() => resizeMapCommand(history.session.project, MAP, values)).toThrow(
            /image layer “Sky”/,
        );
    });
});

describe("Resize / Offset Map: what the dialog checks before OK", () => {
    it("a marker the offset would move out of range is a problem of the offset", () => {
        const history = fixture();
        layers(history).markers.markers[1]!.x = MAX_MARKER_COORD - 20;
        layers(history).markers.markers[2]!.y = -MAX_MARKER_COORD + 4;
        const source = resizeSource(mapOf(history));
        expect(
            resizeMapProblems(source, { width: 7, height: 4, offsetX: 2, offsetY: 0 }).offsetX,
        ).toMatch(/marker/);
        expect(
            resizeMapProblems(source, { width: 5, height: 2, offsetX: 0, offsetY: -1 }).offsetY,
        ).toMatch(/marker/);
        expect(resizeMapProblems(source, { width: 7, height: 4, offsetX: 1, offsetY: 0 })).toEqual(
            {},
        );
    });

    it("the entry counts the markers it keeps", () => {
        const history = fixture();
        const values = { width: 8, height: 4, offsetX: 3, offsetY: 0 };
        const withMarkers = resizeMapCommand(history.session.project, MAP, values)!.bytes;
        layers(history).markers.markers.length = 0;
        const without = resizeMapCommand(history.session.project, MAP, values)!.bytes;
        expect(withMarkers).toBeGreaterThan(without);
    });
});
