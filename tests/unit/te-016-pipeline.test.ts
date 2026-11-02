import { describe, expect, it } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { notices } from "../../src/app/notices/notices";
import { createToolState } from "../../src/app/tools/activeTool";
import { reportStrokeError } from "../../src/app/tools/appPipeline";
import { REFUSALS } from "../../src/app/tools/paintTarget";
import { createToolPipeline } from "../../src/app/tools/pipeline";
import type { PointerInput } from "../../src/app/tools/pipeline";
import { createToolRegistry } from "../../src/app/tools/registry";
import type { ToolRegistry } from "../../src/app/tools/registry";
import { railToolSet } from "../../src/app/tools/toolSets";
import type { ToolLayerKind, ToolSpec } from "../../src/app/tools/types";
import { createSessionStore } from "../../src/app/state/session";
import type { SessionState } from "../../src/app/state/session";
import { createStatusStore } from "../../src/app/state/status";
import { createViewMapping } from "../../src/app/view/coordinates";
import { cellValue } from "../../src/core/cells";
import { AllocationError } from "../../src/core/history";
import type { Touched } from "../../src/core/history";
import {
    createGroupLayer,
    createMap,
    createMarkerLayer,
    createProject,
    createProjectSession,
    createTileLayer,
    sequentialIds,
} from "../../src/core/model";
import type { ProjectMap, TileLayer } from "../../src/core/model";
import { plannedTools } from "../../src/app/tools/planned.tools";
import { tools as handTools } from "../../src/app/tools/hand/hand.tools";
import { tools as zoomTools } from "../../src/app/tools/zoom/zoom.tools";

// TE-016: the cell pointer pipeline (SPEC §3, §4.1) and the tool sets of the rail (DESIGN §6),
// on stores of their own, with synthetic pointer sequences. A probe tool paints one value at
// every cell its pointer samples carry.

const VALUE = cellValue(1, 0);
/** A 10 × 8 map of 16-pixel cells shown at 1× in a 640 × 480 viewport at the window's corner. */
const SIZE = { width: 640, height: 480 };

/** Layer IDs of the test map: tile 1, group 2 holding tile 3, marker 4. */
const LAYERS = { tile: 1, group: 2, grouped: 3, marker: 4 };

function testMap(): ProjectMap {
    const map = createMap({ newId: sequentialIds(), width: 10, height: 8 });
    const group = createGroupLayer(LAYERS.group, "Group");
    group.layers.push(createTileLayer(LAYERS.grouped, "Grouped"));
    map.layers.push(group, createMarkerLayer(LAYERS.marker, "Markers"));
    map.nextLayerId = 5;
    return map;
}

interface Harness {
    store: StoreApi<SessionState>;
    status: ReturnType<typeof createStatusStore>;
    registry: ToolRegistry;
    tools: ReturnType<typeof createToolState>;
    pipeline: ReturnType<typeof createToolPipeline>;
    map: ProjectMap;
    reported: Touched[];
    layer(id: number): TileLayer;
    setActiveLayer(id: number): void;
}

/** What the pipeline reported through `onError`: the error and the stroke's tool. */
type Failure = [unknown, string];

/**
 * The test stores, registry and pipeline. A failure the pipeline reports throws, unless
 * `collect` keeps it in `failures`.
 */
function harness(
    options: { allocate?: (bytes: number) => ArrayBuffer; collect?: boolean } = {},
): Harness & { failures: Failure[] } {
    const { collect = false, ...historyOptions } = options;
    const project = createProject({ newId: sequentialIds() });
    project.maps[0] = testMap();
    const store = createSessionStore(createProjectSession(project), {
        verify: null,
        ...historyOptions,
    });
    const failures: Failure[] = [];
    const status = createStatusStore();
    const registry = createToolRegistry();
    for (const spec of plannedTools) registry.plan(spec, "planned.tools.ts");
    for (const spec of [...handTools, ...zoomTools]) registry.register(spec, "view tools");
    registry.register(probe, "test");
    const tools = createToolState(store, registry);
    const reported: Touched[] = [];
    const map = store.getState().session.project.maps[0]!;
    const pipeline = createToolPipeline({
        session: store,
        status,
        tools,
        mapping: () => mappingOf(map),
        later: () => () => {},
        onError(error, tool) {
            if (!collect) throw error;
            failures.push([error, tool.label]);
        },
        cellsChanged: (touched) => reported.push(touched),
    });
    return {
        failures,
        store,
        status,
        registry,
        tools,
        pipeline,
        map,
        reported,
        layer(id) {
            const found = [map.layers[0], (map.layers[1] as { layers: TileLayer[] }).layers[0]];
            return found.find((layer) => layer?.id === id) as TileLayer;
        },
        setActiveLayer(id) {
            store.getState().session.perMap.get(map.id)!.activeLayerId = id;
            store.getState().touch();
        },
    };
}

/** The map at 1×, centred in the viewport (its session's view, which no test changes). */
function mappingOf(map: ProjectMap) {
    return createViewMapping({
        view: { centreX: (map.width * 16) / 2, centreY: (map.height * 16) / 2, zoom: 1 },
        dpr: 1,
        size: SIZE,
        mapWidth: map.width,
        mapHeight: map.height,
        tileWidth: map.tileWidth,
        tileHeight: map.tileHeight,
        left: 0,
        top: 0,
    });
}

const probe: ToolSpec = {
    id: "probe",
    label: "Probe",
    layers: ["tile"],
    paints: true,
    onDown(context, pointer) {
        for (const cell of pointer.cells) context.paint?.set(cell.x, cell.y, VALUE);
    },
    onMove(context, pointer) {
        for (const cell of pointer.cells) context.paint?.set(cell.x, cell.y, VALUE);
    },
};

/** The client position of the centre of cell `(x, y)`: the map is centred in the viewport. */
const at = (x: number, y: number) => ({ clientX: 248 + x * 16, clientY: 184 + y * 16 });

function input(
    point: { clientX: number; clientY: number },
    over: Partial<PointerInput> = {},
): PointerInput {
    return {
        pointerId: 1,
        button: -1,
        buttons: 1,
        ...point,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        timeStamp: 0,
        ...over,
    };
}

const down = (point: ReturnType<typeof at>, over: Partial<PointerInput> = {}) =>
    input(point, { button: 0, ...over });
const up = (point: ReturnType<typeof at>) => input(point, { button: 0, buttons: 0 });

function painted(layer: TileLayer): string[] {
    const found: string[] = [];
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 10; x++) if (layer.cells.get(x, y) !== 0) found.push(`${x},${y}`);
    }
    return found;
}

function ready(): Harness {
    const h = harness();
    expect(h.tools.select("probe")).toBe(true);
    return h;
}

describe("cell pointer pipeline", () => {
    it("joins a fast drag with pointsOnLine and commits one history entry at the release", () => {
        const h = ready();
        expect(h.pipeline.down(down(at(1, 1)))).toBe(true);
        // One sample far from the last: every cell between is painted.
        h.pipeline.move([input(at(6, 3))]);
        h.pipeline.up(up(at(6, 3)));
        expect(painted(h.layer(LAYERS.tile))).toEqual(
            ["1,1", "2,1", "3,2", "4,2", "5,3", "6,3"].sort(byCell),
        );
        expect(h.store.getState().history.canUndo).toBe(true);
        h.store.getState().history.undo();
        expect(painted(h.layer(LAYERS.tile))).toEqual([]);
        // The cells were shown before the entry existed.
        expect(h.reported.flatMap((touched) => touched.cellRects).length).toBeGreaterThan(0);
    });

    it("restores the cells on cancel (Escape, pointer cancel) and makes no entry", () => {
        const h = ready();
        h.pipeline.down(down(at(2, 2)));
        h.pipeline.move([input(at(4, 2))]);
        expect(painted(h.layer(LAYERS.tile))).toHaveLength(3);
        expect(h.pipeline.cancel()).toBe(true);
        expect(painted(h.layer(LAYERS.tile))).toEqual([]);
        expect(h.store.getState().history.canUndo).toBe(false);
        // The cells put back are shown too.
        expect(h.reported.at(-1)?.cellRects).toEqual([{ x: 2, y: 2, width: 3, height: 1 }]);
    });

    it("aborts a left drag when the right button joins it", () => {
        const h = ready();
        h.pipeline.down(down(at(2, 2)));
        h.pipeline.move([input(at(3, 2))]);
        // A chorded press arrives as a move with both buttons held.
        h.pipeline.move([input(at(3, 2), { button: 2, buttons: 3 })]);
        expect(h.pipeline.stroking).toBe(false);
        expect(painted(h.layer(LAYERS.tile))).toEqual([]);
        // As a `pointerdown` it aborts the stroke too.
        h.pipeline.down(down(at(2, 2)));
        expect(h.pipeline.down(down(at(2, 2), { button: 2, buttons: 3 }))).toBe(true);
        expect(h.pipeline.stroking).toBe(false);
        expect(h.store.getState().history.canUndo).toBe(false);
    });

    it("puts the cells back and reports the stroke's tool when the commit cannot allocate", () => {
        const h = harness({
            collect: true,
            allocate: () => {
                throw new RangeError("out of memory");
            },
        });
        h.tools.select("probe");
        h.pipeline.down(down(at(1, 1)));
        h.pipeline.move([input(at(3, 1))]);
        h.pipeline.up(up(at(3, 1)));
        expect(painted(h.layer(LAYERS.tile))).toEqual([]);
        expect(h.store.getState().history.canUndo).toBe(false);
        expect(h.failures.map(([error, label]) => [(error as Error).name, label])).toEqual([
            ["AllocationError", "Probe"],
        ]);
        // The cells put back are shown.
        expect(h.reported.at(-1)?.cellRects).toEqual([{ x: 1, y: 1, width: 3, height: 1 }]);
    });

    it("clips painting to the map", () => {
        const h = ready();
        h.pipeline.down(down(at(-3, 2)));
        h.pipeline.move([input(at(1, 2))]);
        h.pipeline.move([input(at(14, 2))]);
        h.pipeline.up(up(at(14, 2)));
        expect(painted(h.layer(LAYERS.tile))).toEqual(
            Array.from({ length: 10 }, (_, x) => `${x},2`).sort(byCell),
        );
        const outside = ready();
        outside.pipeline.down(down(at(-2, -2)));
        outside.pipeline.move([input(at(-5, 12))]);
        outside.pipeline.up(up(at(-5, 12)));
        expect(painted(outside.layer(LAYERS.tile))).toEqual([]);
        expect(outside.store.getState().history.canUndo).toBe(false);
    });

    it("refuses a locked or hidden layer, or one under a locked or hidden group, with a message", () => {
        const cases: [string, (h: Harness) => void, number, string][] = [
            ["locked", (h) => (h.layer(LAYERS.tile).locked = true), LAYERS.tile, REFUSALS.locked],
            ["hidden", (h) => (h.layer(LAYERS.tile).visible = false), LAYERS.tile, REFUSALS.hidden],
            [
                "under a locked group",
                (h) => (h.map.layers[1]!.locked = true),
                LAYERS.grouped,
                REFUSALS.locked,
            ],
            [
                "under a hidden group",
                (h) => (h.map.layers[1]!.visible = false),
                LAYERS.grouped,
                REFUSALS.hidden,
            ],
        ];
        for (const [, change, layerId, message] of cases) {
            const h = ready();
            change(h);
            h.setActiveLayer(layerId);
            expect(h.pipeline.down(down(at(1, 1)))).toBe(false);
            expect(h.status.getState().feedback).toBe(message);
            expect(painted(h.layer(layerId))).toEqual([]);
            expect(h.store.getState().history.canUndo).toBe(false);
        }
        // An unlocked layer of an unlocked group paints.
        const h = ready();
        h.setActiveLayer(LAYERS.grouped);
        expect(h.tools.select("probe")).toBe(true);
        expect(h.pipeline.down(down(at(1, 1)))).toBe(true);
    });

    it("says so when a tile tool meets a layer that is not a tile layer", () => {
        const h = harness();
        // Only a held key could make a tool act outside its set; the pipeline still refuses.
        const pipeline = createToolPipeline({
            session: h.store,
            status: h.status,
            tools: { active: () => h.registry.get("probe")!, options: () => ({}) },
            mapping: () => mappingOf(h.map),
            later: () => () => {},
        });
        for (const layerId of [LAYERS.marker, LAYERS.group]) {
            h.setActiveLayer(layerId);
            expect(pipeline.down(down(at(1, 1)))).toBe(false);
            expect(h.status.getState().feedback).toBe(REFUSALS.notTile);
        }
    });

    it("cancels the stroke when the active layer changes", () => {
        const h = ready();
        h.pipeline.down(down(at(2, 2)));
        h.setActiveLayer(LAYERS.grouped);
        expect(h.pipeline.stroking).toBe(false);
        expect(painted(h.layer(LAYERS.tile))).toEqual([]);
    });

    it("leaves the middle button and presses while the pan key is held", () => {
        const h = ready();
        expect(h.pipeline.down(down(at(2, 2), { button: 1, buttons: 4 }))).toBe(false);
        let panning = true;
        const pipeline = createToolPipeline({
            session: h.store,
            status: h.status,
            tools: h.tools,
            mapping: () => null,
            later: () => () => {},
            navigating: () => panning,
        });
        expect(pipeline.down(down(at(2, 2)))).toBe(false);
        panning = false;
        expect(pipeline.down(down(at(2, 2)))).toBe(false); // no mapping: no viewport
        expect(h.pipeline.down(down(at(2, 2)))).toBe(true);
    });

    it("opens the gesture context while a multi-click gesture is open", () => {
        const h = ready();
        const contexts: boolean[] = [];
        h.registry.register(
            {
                id: "gesture",
                label: "Gesture",
                layers: ["tile"],
                onDown: (context) => context.openGesture(),
            },
            "test",
        );
        h.tools.select("gesture");
        const pipeline = createToolPipeline({
            session: h.store,
            status: h.status,
            tools: h.tools,
            mapping: () => mappingOf(h.map),
            later: () => () => {},
            gesture: (open) => contexts.push(open),
        });
        pipeline.down(down(at(1, 1)));
        pipeline.up(up(at(1, 1)));
        expect(pipeline.gesture).toBe(true);
        expect(pipeline.closeGesture()).toBe(true);
        expect(contexts).toEqual([true, false]);
    });
});

describe("stroke failures in the app", () => {
    it("are reported as a toast naming the tool (SPEC §3)", () => {
        const shown: [string, string][] = [];
        const detach = notices.attachSink((kind, message) => shown.push([kind, message]));
        try {
            reportStrokeError(new AllocationError(4096), { label: "Stamp Brush" });
        } finally {
            detach();
        }
        expect(shown).toEqual([
            ["error", "Stamp Brush failed: Could not allocate 4096 bytes of history memory."],
        ]);
    });
});

describe("tool sets", () => {
    const ids = (registry: ToolRegistry, kind: ToolLayerKind) =>
        railToolSet(registry, kind).map((group) => group.map((slot) => slot.id));

    it("offers the tile tools on a tile layer and only Hand and Zoom on a group layer", () => {
        const { registry } = harness();
        expect(ids(registry, "tile")).toEqual([
            ["stamp", "eraser", "bucket", "shapeFill"],
            ["terrain"],
            ["rectSelect", "wand", "sameTile"],
            ["hand", "zoom"],
        ]);
        expect(ids(registry, "none")).toEqual([["hand", "zoom"]]);
        expect(ids(registry, "marker")).toEqual([
            ["markerSelect", "editPoints"],
            ["markerRectangle", "markerEllipse", "markerPoint", "markerPolygon", "markerPolyline"],
            ["hand", "zoom"],
        ]);
    });

    it("keeps each kind's last tool when the active layer changes kind", () => {
        const h = harness();
        expect(h.tools.kind()).toBe("tile");
        expect(h.tools.select("probe")).toBe(true);
        h.setActiveLayer(LAYERS.group);
        expect(h.tools.kind()).toBe("none");
        expect(h.tools.activeId()).toBe("hand");
        // A tool of another set is not selected here.
        expect(h.tools.select("probe")).toBe(false);
        expect(h.tools.select("zoom")).toBe(true);
        h.setActiveLayer(LAYERS.tile);
        expect(h.tools.activeId()).toBe("probe");
        h.setActiveLayer(LAYERS.grouped);
        expect(h.tools.activeId()).toBe("probe");
        h.setActiveLayer(LAYERS.group);
        expect(h.tools.activeId()).toBe("zoom");
    });
});

function byCell(a: string, b: string): number {
    const [ax, ay] = a.split(",").map(Number) as [number, number];
    const [bx, by] = b.split(",").map(Number) as [number, number];
    return ay - by || ax - bx;
}
