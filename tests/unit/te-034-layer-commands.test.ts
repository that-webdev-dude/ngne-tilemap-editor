import { describe, expect, it } from "vitest";
import { envelopeWarning, watchEnvelope } from "../../src/app/layers/envelopeWarning";
import { createSessionStore } from "../../src/app/state/session";
import { layerHighlight } from "../../src/app/viewport/scene";
import type { History } from "../../src/core/history";
import { newMapCommand } from "../../src/core/maps";
import {
    ENVELOPE,
    LAYER_LABELS,
    LayerEditError,
    adjacentLayer,
    deleteLayersCommand,
    duplicateLayersCommand,
    envelopeProblems,
    groupLayersCommand,
    groupName,
    layerOrder,
    moveLayerCommand,
    moveLayerToCommand,
    newLayerCommand,
    newLayerName,
    otherLayers,
    setLayerValuesCommand,
    toggleOtherLayersCommand,
    ungroupCommand,
} from "../../src/core/layers";
import {
    MAX_GROUP_DEPTH,
    MAX_LAYERS,
    MAX_LAYER_OFFSET,
    assertInvariants,
    createGroupLayer,
    createMarkerLayer,
    createTileLayer,
    drawnOpacity,
    effectiveValues,
    findLayer,
    walkLayers,
} from "../../src/core/model";
import type { Layer, MarkerLayer, ProjectMap, TileLayer } from "../../src/core/model";
import { expectSymmetric, snapshotProject } from "./support/symmetry";
import { MAP, setup, tile } from "./te-006-support";

// TE-034: the layer commands of SPEC §7.2 with Tiled's behaviour (MapDocument, MoveLayer,
// LayerModel at v1.12.2). Every command passes the TE-006 symmetry harness; layer and marker IDs
// come from the map's counters and are never given twice; the limits of FORMAT §2.8 (256 layers,
// groups 16 deep) and the effective ranges of §2.5 are refused with the project unchanged. The
// map of `setup` is 8 × 8 with one tile layer (ID 1), active.

/**
 * The map of `history` furnished as
 *
 *     Markers (5, marker layer; markers 1 and 2)      top
 *     Group (2)
 *       Upper (4, tile)
 *       Lower (3, tile; cells (1, 1), (6, 6))
 *     Tile Layer 1 (1, tile; cell (0, 0))             bottom
 *
 * with layer 3 active.
 */
function furnish(history: History): ProjectMap {
    const map = history.session.project.maps[0]!;
    (map.layers[0] as TileLayer).cells.set(0, 0, tile(0));
    const group = createGroupLayer(2, "Group");
    const lower = createTileLayer(3, "Lower");
    lower.cells.set(1, 1, tile(1));
    lower.cells.set(6, 6, tile(0));
    group.layers.push(lower, createTileLayer(4, "Upper"));
    const markers = createMarkerLayer(5, "Markers");
    markers.markers.push(
        { shape: "point", x: 4, y: 5, id: 1, name: "Spawn", class: "", properties: [] },
        {
            shape: "polygon",
            x: 0,
            y: 0,
            points: [
                [0, 0],
                [8, 0],
                [8, 8],
            ],
            id: 2,
            name: "Zone",
            class: "",
            properties: [],
        },
    );
    map.layers.push(group, markers);
    map.nextLayerId = 6;
    map.nextMarkerId = 3;
    active(history, 3);
    assertInvariants(history.session.project);
    return map;
}

/** A map past 65,536 cells. */
const BIG_MAP = { width: 512, height: 512, tileWidth: 16, tileHeight: 16 };

function mapOf(history: History): ProjectMap {
    return history.session.project.maps[0]!;
}

function active(history: History, id?: number): number {
    const mapSession = history.session.perMap.get(MAP)!;
    if (id !== undefined) mapSession.activeLayerId = id;
    return mapSession.activeLayerId;
}

/** The tree as nested names, top of the map last, as "Group[Lower,Upper]". */
function tree(layers: readonly Layer[]): string {
    return layers
        .map((layer) =>
            layer.type === "group" ? `${layer.name}[${tree(layer.layers)}]` : layer.name,
        )
        .join(",");
}

function ids(map: ProjectMap): number[] {
    return [...walkLayers(map.layers)].map((entry) => entry.layer.id);
}

/** Expects `run` to throw a `LayerEditError` with `code` and the project and history unchanged. */
function expectRefused(history: History, run: () => void, code: string): void {
    const before = snapshotProject(history.session.project);
    const activeBefore = active(history);
    const undoCount = history.undoCount;
    let caught: unknown = null;
    try {
        run();
    } catch (error) {
        caught = error;
    }
    expect(caught).toBeInstanceOf(LayerEditError);
    expect((caught as LayerEditError).code).toBe(code);
    expect(snapshotProject(history.session.project)).toStrictEqual(before);
    expect(active(history)).toBe(activeBefore);
    expect(history.undoCount).toBe(undoCount);
}

describe("every layer command passes the symmetry harness", () => {
    it("new tile, marker and group layers go above the active layer and become active", () => {
        const history = setup();
        const map = furnish(history);
        const tileCommand = expectSymmetric(history, newLayerCommand(MAP, "tile"));
        expect(tileCommand.label).toBe(LAYER_LABELS.newTile);
        expect(tree(map.layers)).toBe("Tile Layer 1,Group[Lower,Tile Layer 4,Upper],Markers");
        expect(active(history)).toBe(6);
        expect(map.nextLayerId).toBe(7);
        expect(tileCommand.touched).toMatchObject({ mapId: MAP, structure: true });

        expectSymmetric(history, newLayerCommand(MAP, "marker"));
        expect(findLayer(map, 7)!.layer).toMatchObject({ type: "marker", name: "Marker Layer 2" });
        expectSymmetric(history, newLayerCommand(MAP, "group"));
        expect(findLayer(map, 8)!.layer).toMatchObject({ type: "group", name: "Group Layer 2" });
        expect(tree(map.layers)).toBe(
            "Tile Layer 1,Group[Lower,Tile Layer 4,Marker Layer 2,Group Layer 2[],Upper],Markers",
        );
        expect(active(history)).toBe(8);
        // Undo gives back the active layer the step found.
        history.undo();
        expect(active(history)).toBe(7);
    });

    it("group layers wraps them in a new group above the first, the active layer staying", () => {
        const history = setup();
        const map = furnish(history);
        const command = expectSymmetric(history, groupLayersCommand(MAP, [1, 5]));
        expect(command.label).toBe(LAYER_LABELS.group);
        // Tiled: "Group N", N one above the count of groups; the layers in tree order.
        expect(tree(map.layers)).toBe("Group 2[Tile Layer 1,Markers],Group[Lower,Upper]");
        expect(findLayer(map, 6)!.layer.name).toBe("Group 2");
        expect(active(history)).toBe(3);
    });

    it("ungroup moves a group's children out where it was and removes it", () => {
        const history = setup();
        const map = furnish(history);
        active(history, 2);
        const command = expectSymmetric(history, ungroupCommand(MAP, [2]));
        expect(command.label).toBe(LAYER_LABELS.ungroup);
        expect(tree(map.layers)).toBe("Tile Layer 1,Lower,Upper,Markers");
        // The active group went; its top child took its row.
        expect(active(history)).toBe(4);
        history.undo();
        expect(active(history)).toBe(2);
    });

    it("ungroup of an empty active group passes the active layer as Delete does", () => {
        // Below it: the layer below; at the bottom: the one above (Qt's current row).
        const history = setup();
        const map = mapOf(history);
        map.layers.push(createTileLayer(2, "Above"));
        map.layers.splice(1, 0, createGroupLayer(3, "Empty"));
        map.nextLayerId = 4;
        active(history, 3);
        expectSymmetric(history, ungroupCommand(MAP, [3]));
        expect(tree(map.layers)).toBe("Tile Layer 1,Above");
        expect(active(history)).toBe(1);
        history.undo();
        map.layers.splice(0, 0, map.layers.splice(1, 1)[0]!);
        expect(tree(map.layers)).toBe("Empty[],Tile Layer 1,Above");
        expectSymmetric(history, ungroupCommand(MAP, [3]));
        expect(tree(map.layers)).toBe("Tile Layer 1,Above");
        expect(active(history)).toBe(1);
    });

    it("ungroup of a layer inside a group moves it out above the group", () => {
        const history = setup();
        const map = furnish(history);
        expectSymmetric(history, ungroupCommand(MAP, [3]));
        expect(tree(map.layers)).toBe("Tile Layer 1,Group[Upper],Lower,Markers");
        expect(active(history)).toBe(3);
    });

    it("duplicate copies layers, children, cells and markers with new IDs", () => {
        const history = setup();
        const map = furnish(history);
        const command = expectSymmetric(history, (session) =>
            duplicateLayersCommand(session.project, MAP, [2, 5]),
        );
        expect(command.label).toBe(LAYER_LABELS.duplicate);
        expect(command.projectBytes).toBeGreaterThan(0);
        // Each copy right above its original, the name kept (Tiled's default).
        expect(tree(map.layers)).toBe(
            "Tile Layer 1,Group[Lower,Upper],Group[Lower,Upper],Markers,Markers",
        );
        expect(ids(map)).toEqual([1, 2, 3, 4, 6, 7, 8, 5, 9]);
        const copy = findLayer(map, 7)!.layer as TileLayer;
        expect(copy.cells.get(1, 1)).toBe(tile(1));
        expect(copy.cells.get(6, 6)).toBe(tile(0));
        expect(copy.cells).not.toBe((findLayer(map, 3)!.layer as TileLayer).cells);
        expect((findLayer(map, 9)!.layer as MarkerLayer).markers.map((m) => m.id)).toEqual([3, 4]);
        expect(map.nextLayerId).toBe(10);
        expect(map.nextMarkerId).toBe(5);
        // Layer 3 was active and is not among the chosen: the first copy becomes active.
        expect(active(history)).toBe(6);
    });

    it("duplicate makes the copy of the active layer active", () => {
        const history = setup();
        furnish(history);
        expectSymmetric(history, (session) => duplicateLayersCommand(session.project, MAP, [3]));
        expect(active(history)).toBe(6);
        expect(tree(mapOf(history).layers)).toBe("Tile Layer 1,Group[Lower,Lower,Upper],Markers");
    });

    it("delete passes the active layer to the layer below, else above, else the group", () => {
        const history = setup();
        const map = furnish(history);
        active(history, 4);
        const command = expectSymmetric(history, (session) =>
            deleteLayersCommand(session.project, MAP, [4]),
        );
        expect(command.label).toBe(LAYER_LABELS.delete);
        expect(active(history)).toBe(3);
        // Lower is now alone in Group: nothing below or above, so the group.
        expectSymmetric(history, (session) => deleteLayersCommand(session.project, MAP, [3]));
        expect(active(history)).toBe(2);
        expect(tree(map.layers)).toBe("Tile Layer 1,Group[],Markers");
        // The bottom layer: the one above takes its place.
        active(history, 1);
        expectSymmetric(history, (session) => deleteLayersCommand(session.project, MAP, [1]));
        expect(active(history)).toBe(2);
        history.undo();
        expect(active(history)).toBe(1);
    });

    it("delete of a group takes its children and their markers' selection", () => {
        const history = setup();
        const map = furnish(history);
        history.session.perMap.get(MAP)!.markerSelection = [1];
        expectSymmetric(history, (session) => deleteLayersCommand(session.project, MAP, [5, 2]));
        expect(tree(map.layers)).toBe("Tile Layer 1");
        expect(active(history)).toBe(1);
        expect(history.session.perMap.get(MAP)!.markerSelection).toEqual([]);
        history.undo();
        expect(history.session.perMap.get(MAP)!.markerSelection).toEqual([1]);
    });

    it("rename", () => {
        const history = setup();
        const map = furnish(history);
        const command = expectSymmetric(history, (session) =>
            setLayerValuesCommand(session.project, MAP, [3], { name: "Ground" }),
        );
        expect(command.label).toBe(LAYER_LABELS.rename);
        expect(findLayer(map, 3)!.layer.name).toBe("Ground");
        expect(command.touched).toMatchObject({ layerIds: [3], structure: false });
    });

    it("move up and down: past siblings, into and out of groups (Tiled's MoveLayer)", () => {
        const history = setup();
        const map = furnish(history);
        const steps: [number, -1 | 1, string][] = [
            [1, 1, "Group[Tile Layer 1,Lower,Upper],Markers"], // into the group, at its bottom
            [1, 1, "Group[Lower,Tile Layer 1,Upper],Markers"], // past a sibling
            [1, 1, "Group[Lower,Upper,Tile Layer 1],Markers"],
            [1, 1, "Group[Lower,Upper],Tile Layer 1,Markers"], // out of the group, above it
            [1, 1, "Group[Lower,Upper],Markers,Tile Layer 1"],
            [5, -1, "Group[Lower,Upper,Markers],Tile Layer 1"], // into the group, at its top
            [3, -1, "Lower,Group[Upper,Markers],Tile Layer 1"], // out of the group, below it
        ];
        for (const [id, step, expected] of steps) {
            const command = expectSymmetric(history, moveLayerCommand(MAP, id, step));
            expect(command.label).toBe(step > 0 ? LAYER_LABELS.moveUp : LAYER_LABELS.moveDown);
            expect(tree(map.layers)).toBe(expected);
        }
        expect(active(history)).toBe(3);
    });

    it("move to a place (a drag)", () => {
        const history = setup();
        const map = furnish(history);
        expectSymmetric(history, moveLayerToCommand(MAP, 5, 2, 1));
        expect(tree(map.layers)).toBe("Tile Layer 1,Group[Lower,Markers,Upper]");
        expectSymmetric(history, moveLayerToCommand(MAP, 3, null, 0));
        expect(tree(map.layers)).toBe("Lower,Tile Layer 1,Group[Markers,Upper]");
    });

    it("the setters: visible, locked, opacity, offset, parallax and class", () => {
        const history = setup();
        const map = furnish(history);
        const cases: [Parameters<typeof setLayerValuesCommand>[3], string][] = [
            [{ visible: false }, LAYER_LABELS.hide],
            [{ visible: true }, LAYER_LABELS.show],
            [{ locked: true }, LAYER_LABELS.lock],
            [{ locked: false }, LAYER_LABELS.unlock],
            [{ opacity: 128 }, LAYER_LABELS.opacity],
            [{ offsetX: -12, offsetY: 30 }, LAYER_LABELS.offset],
            [{ parallaxX: 0.5, parallaxY: 2 }, LAYER_LABELS.parallax],
            [{ class: "ground" }, LAYER_LABELS.class],
            [{ opacity: 64, offsetX: 3 }, LAYER_LABELS.values],
        ];
        for (const [values, label] of cases) {
            const command = expectSymmetric(history, (session) =>
                setLayerValuesCommand(session.project, MAP, [2], values),
            );
            expect(command.label).toBe(label);
            expect(findLayer(map, 2)!.layer).toMatchObject(values);
        }
        // A group's drawing changes its children's: they are in `touched`.
        const command = setLayerValuesCommand(history.session.project, MAP, [2], { opacity: 9 });
        expect(command.touched.layerIds).toEqual([2, 3, 4]);
        expect(
            effectiveValues(findLayer(map, 3)!.layer, findLayer(map, 3)!.ancestors),
        ).toMatchObject({ offsetX: 3, offsetY: 30, parallaxX: 0.5, parallaxY: 2 });
    });

    it("show/hide and lock/unlock other layers (Tiled's toggleOtherLayers)", () => {
        const history = setup();
        const map = furnish(history);
        // Others of layer 3: its sibling 4, its group's siblings 1 and 5; not the group itself.
        expect(otherLayers(map, [3]).map((layer) => layer.id)).toEqual([1, 4, 5]);
        const hide = toggleOtherLayersCommand(history.session.project, MAP, [3], "visible")!;
        expectSymmetric(history, hide);
        expect(hide.label).toBe(LAYER_LABELS.hideOthers);
        expect([1, 4, 5].map((id) => findLayer(map, id)!.layer.visible)).toEqual([
            false,
            false,
            false,
        ]);
        const show = toggleOtherLayersCommand(history.session.project, MAP, [3], "visible")!;
        expectSymmetric(history, show);
        expect(show.label).toBe(LAYER_LABELS.showOthers);
        expect([1, 4, 5].every((id) => findLayer(map, id)!.layer.visible)).toBe(true);

        findLayer(map, 4)!.layer.locked = true;
        const lock = toggleOtherLayersCommand(history.session.project, MAP, [3], "locked")!;
        expectSymmetric(history, lock);
        expect(lock.label).toBe(LAYER_LABELS.lockOthers);
        // Only the layers that change are in the entry.
        expect(lock.touched.layerIds).toEqual([1, 5]);
        const unlock = toggleOtherLayersCommand(history.session.project, MAP, [3], "locked")!;
        expectSymmetric(history, unlock);
        expect(unlock.label).toBe(LAYER_LABELS.unlockOthers);
        expect([1, 4, 5].some((id) => findLayer(map, id)!.layer.locked)).toBe(false);
    });

    it("no other layers: no command", () => {
        const history = setup();
        expect(toggleOtherLayersCommand(history.session.project, MAP, [1], "visible")).toBeNull();
    });
});

describe("IDs are never reused", () => {
    it("undo does not give layer or marker IDs back (Tiled)", () => {
        const history = setup();
        const map = furnish(history);
        history.execute(newLayerCommand(MAP, "tile"));
        expect(active(history)).toBe(6);
        history.undo();
        expect(map.nextLayerId).toBe(7);
        history.execute(newLayerCommand(MAP, "marker"));
        expect(active(history)).toBe(7);
        history.execute(duplicateLayersCommand(history.session.project, MAP, [5]));
        expect(map.nextMarkerId).toBe(5);
        history.undo();
        expect(map.nextMarkerId).toBe(5);
        history.execute(duplicateLayersCommand(history.session.project, MAP, [5]));
        const copy = findLayer(map, active(history))!.layer as MarkerLayer;
        expect(copy.markers.map((marker) => marker.id)).toEqual([5, 6]);
    });

    it("undo past several steps and redo keeps the highest counters", () => {
        const history = setup();
        const map = furnish(history);
        history.execute(newLayerCommand(MAP, "tile"));
        history.execute(newLayerCommand(MAP, "tile"));
        history.undo();
        history.undo();
        history.redo();
        // Layer 7 was given out by the step still undone: the next layer is 8.
        expect(map.nextLayerId).toBe(8);
        history.execute(newLayerCommand(MAP, "group"));
        expect(active(history)).toBe(8);
    });

    it("a new layer after a delete takes a new ID, and a redo the same one", () => {
        const history = setup();
        const map = furnish(history);
        history.execute(deleteLayersCommand(history.session.project, MAP, [5]));
        history.execute(newLayerCommand(MAP, "marker"));
        expect(active(history)).toBe(6);
        history.undo();
        history.redo();
        expect(active(history)).toBe(6);
        expect(ids(map)).toEqual([1, 2, 3, 6, 4]);
        // Every command that adds a layer takes from the counter; none goes below it.
        history.execute(duplicateLayersCommand(history.session.project, MAP, [6]));
        history.execute(groupLayersCommand(MAP, [1]));
        expect(new Set(ids(map)).size).toBe(ids(map).length);
        expect(Math.max(...ids(map))).toBe(8);
        expect(map.nextLayerId).toBe(9);
    });

    it("duplicated markers take IDs above every marker of the map", () => {
        const history = setup();
        const map = furnish(history);
        history.execute(duplicateLayersCommand(history.session.project, MAP, [5]));
        history.execute(duplicateLayersCommand(history.session.project, MAP, [5]));
        const all = [...walkLayers(map.layers)].flatMap(({ layer }) =>
            layer.type === "marker" ? layer.markers.map((marker) => marker.id) : [],
        );
        expect(all.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(map.nextMarkerId).toBe(7);
    });
});

describe("limits and refusals leave the project unchanged", () => {
    /** Fills the map up to `count` layers with tile layers at its top. */
    function fill(map: ProjectMap, count: number): void {
        while ([...walkLayers(map.layers)].length < count) {
            map.layers.push(createTileLayer(map.nextLayerId, `L${map.nextLayerId}`));
            map.nextLayerId += 1;
        }
    }

    it("a 257th layer is refused, by New, Duplicate and Group Layers", () => {
        const history = setup();
        const map = mapOf(history);
        fill(map, MAX_LAYERS);
        assertInvariants(history.session.project);
        const { project } = history.session;
        expectRefused(history, () => history.execute(newLayerCommand(MAP, "tile")), "limit");
        expectRefused(
            history,
            () => history.execute(duplicateLayersCommand(project, MAP, [1])),
            "limit",
        );
        expectRefused(history, () => history.execute(groupLayersCommand(MAP, [1])), "limit");
    });

    it("a group 17 levels deep is refused, by Group Layers and by moves", () => {
        const history = setup();
        const map = mapOf(history);
        // Groups 16 deep, the deepest holding layer 1.
        let list = map.layers;
        const tileLayer = map.layers.pop()!;
        for (let depth = 1; depth <= MAX_GROUP_DEPTH; depth++) {
            const group = createGroupLayer(map.nextLayerId++, `G${depth}`);
            list.push(group);
            list = group.layers;
        }
        list.push(tileLayer);
        const side = createGroupLayer(map.nextLayerId++, "Side");
        map.layers.push(side);
        assertInvariants(history.session.project);
        expectRefused(history, () => history.execute(groupLayersCommand(MAP, [1])), "limit");
        // The innermost group moved into "Side" would be 2 deep: fine; "Side" into the
        // innermost group would be 17 deep: refused.
        const innermost = findLayer(map, 1)!.ancestors.at(-1)!;
        expectRefused(
            history,
            () => history.execute(moveLayerToCommand(MAP, side.id, innermost.id, 0)),
            "limit",
        );
        // Move down from the top: "Side" enters the group below it, at depth 2, … fine, but
        // a new group made in the innermost group would be 17 deep.
        active(history, 1);
        expectRefused(history, () => history.execute(newLayerCommand(MAP, "group")), "limit");
    });

    it("an effective offset or parallax out of range is refused", () => {
        const history = setup();
        const map = furnish(history);
        findLayer(map, 3)!.layer.offsetX = MAX_LAYER_OFFSET;
        const { project } = history.session;
        expectRefused(
            history,
            () => history.execute(setLayerValuesCommand(project, MAP, [2], { offsetX: 1 })),
            "range",
        );
        findLayer(map, 3)!.layer.offsetX = 0;
        findLayer(map, 2)!.layer.parallaxX = 20;
        findLayer(map, 1)!.layer.parallaxX = 20;
        // Layer 1 into the group: 20 × 20 = 400, past ±100.
        expectRefused(history, () => history.execute(moveLayerCommand(MAP, 1, 1)), "range");
    });

    it("values out of range are refused before a command exists", () => {
        const history = setup();
        const { project } = history.session;
        const bad = [
            { opacity: 256 },
            { opacity: 1.5 },
            { offsetX: MAX_LAYER_OFFSET + 1 },
            { offsetY: 0.5 },
            { parallaxX: 101 },
            { parallaxY: Number.NaN },
            { name: "x".repeat(256) },
            { class: "x".repeat(256) },
        ];
        for (const values of bad) {
            expectRefused(
                history,
                () => setLayerValuesCommand(project, MAP, [1], values),
                "values",
            );
        }
    });

    it("the last layer is not deleted; moves past the ends and into itself are refused", () => {
        const history = setup();
        const { project } = history.session;
        expectRefused(
            history,
            () => history.execute(deleteLayersCommand(project, MAP, [1])),
            "last",
        );
        expectRefused(history, () => history.execute(moveLayerCommand(MAP, 1, 1)), "move");
        expectRefused(history, () => history.execute(moveLayerCommand(MAP, 1, -1)), "move");
        furnish(history);
        expectRefused(history, () => history.execute(moveLayerToCommand(MAP, 2, 2, 0)), "move");
        expectRefused(history, () => history.execute(moveLayerToCommand(MAP, 3, 2, 0)), "move");
        expectRefused(history, () => history.execute(ungroupCommand(MAP, [1])), "move");
        expectRefused(history, () => history.execute(newLayerCommand("nope", "tile")), "missing");
        expectRefused(history, () => history.execute(groupLayersCommand(MAP, [99])), "missing");
    });
});

describe("layer order, names and the highlight", () => {
    it("select above and below follow Tiled's LayerIterator: a group after its children", () => {
        const history = setup();
        const map = furnish(history);
        expect(layerOrder(map.layers).map((layer) => layer.id)).toEqual([1, 3, 4, 2, 5]);
        expect(adjacentLayer(map, 1, 1)!.id).toBe(3);
        expect(adjacentLayer(map, 4, 1)!.id).toBe(2);
        expect(adjacentLayer(map, 2, -1)!.id).toBe(4);
        expect(adjacentLayer(map, 5, 1)).toBeNull();
        expect(adjacentLayer(map, 1, -1)).toBeNull();
    });

    it("new layer and group names as Tiled's", () => {
        const history = setup();
        const map = furnish(history);
        // Three tile layers: the next is 4.
        expect(newLayerName(map, "tile")).toBe("Tile Layer 4");
        findLayer(map, 4)!.layer.name = "Tile Layer 4";
        expect(newLayerName(map, "tile")).toBe("Tile Layer 5");
        expect(newLayerName(map, "marker")).toBe("Marker Layer 2");
        expect(newLayerName(map, "group")).toBe("Group Layer 2");
        expect(groupName(map)).toBe("Group 2");
    });

    it("the highlight draws other layers at its factor, the current one and its children not", () => {
        const history = setup();
        const map = furnish(history);
        const highlight = { layerId: 2, factor: 0.25 };
        const opacity = (id: number) => {
            const { layer, ancestors } = findLayer(map, id)!;
            return drawnOpacity(layer, ancestors, effectiveValues(layer, ancestors), highlight);
        };
        expect([1, 2, 3, 4, 5].map(opacity)).toEqual([64, 255, 255, 255, 64]);
        expect(drawnOpacity(map.layers[0]!, [], effectiveValues(map.layers[0]!, []))).toBe(255);
    });

    it("the scene's highlight: the preference's percent, none when off or without a layer", () => {
        const history = setup();
        const map = furnish(history);
        expect(layerHighlight(history.session, map, true, 25)).toEqual({
            layerId: 3,
            factor: 0.25,
        });
        expect(layerHighlight(history.session, map, false, 25)).toBeNull();
        active(history, 99);
        expect(layerHighlight(history.session, map, true, 25)).toBeNull();
    });
});

describe("the D1 envelope warning", () => {
    it("names what a map exceeds", () => {
        const history = setup();
        const map = mapOf(history);
        expect(envelopeProblems(map)).toEqual([]);
        expect(envelopeWarning(map)).toBeNull();
        for (let n = 1; n <= ENVELOPE.layers; n++) {
            map.layers.push(createTileLayer(map.nextLayerId++, `L${n}`));
        }
        map.width = 512;
        map.height = 512;
        expect(envelopeProblems(map)).toEqual(["cells", "layers"]);
        expect(envelopeWarning(map)).toBe(
            "This map is beyond the editor's tested envelope: more than 65,536 cells per " +
                "layer, more than 16 layers.",
        );
    });

    it("is reported once per map", () => {
        const history = setup();
        const store = createSessionStore(history.session);
        const messages: string[] = [];
        const stop = watchEnvelope(store, { info: (message) => messages.push(message) });
        const { history: storeHistory } = store.getState();
        for (let n = 0; n < ENVELOPE.layers; n++) {
            storeHistory.execute(newLayerCommand(MAP, "tile"));
        }
        expect(messages).toEqual([
            "This map is beyond the editor's tested envelope: more than 16 layers.",
        ]);
        storeHistory.execute(newLayerCommand(MAP, "tile"));
        storeHistory.undo();
        storeHistory.undo();
        storeHistory.redo();
        store.getState().touch();
        expect(messages).toHaveLength(1);
        stop();
    });

    it("is reported again for another map beyond the envelope", () => {
        const history = setup();
        const store = createSessionStore(history.session);
        const messages: string[] = [];
        const stop = watchEnvelope(store, { info: (message) => messages.push(message) });
        const { history: storeHistory } = store.getState();
        storeHistory.execute(newMapCommand(history.session.project, { ...BIG_MAP, name: "Big" }));
        expect(messages).toEqual([
            "This map is beyond the editor's tested envelope: more than 65,536 cells per layer.",
        ]);
        storeHistory.execute(newMapCommand(history.session.project, { ...BIG_MAP, name: "Big 2" }));
        expect(messages).toHaveLength(2);
        // Back to a map already reported: nothing more.
        storeHistory.undo();
        storeHistory.redo();
        expect(messages).toHaveLength(2);
        stop();
    });
});
