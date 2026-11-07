import { describe, expect, it } from "vitest";
import {
    changedLayerValues,
    dropPlace,
    dropZone,
    layerPropertiesCommand,
    layerPropertiesValues,
    layerRows,
} from "../../src/app/layers/layerTree";
import type { History } from "../../src/core/history";
import { LAYER_LABELS, moveLayerToCommand, setLayerValuesCommand } from "../../src/core/layers";
import {
    assertInvariants,
    createGroupLayer,
    createTileLayer,
    findLayer,
} from "../../src/core/model";
import type { Layer, ProjectMap } from "../../src/core/model";
import { collectLayerFields, extraCommands } from "../../src/ui/layers/layerFields";
import type { LayerField, LayerFieldModule } from "../../src/ui/layers/layerFields";
import { expectSymmetric } from "./support/symmetry";
import { MAP, setup } from "./te-006-support";

// TE-035: what the Layers panel shows of a layer tree (DESIGN §8.2), where a drag drops a layer
// (Tiled's `LayerModel::dropMimeData` at v1.12.2 for a drop on a group), the one history entry
// the layer properties popover makes, and the registry of kind-specific popover fields. The
// map is
//
//     Top (5, tile)                 top
//     Outer (2, group)
//       Inner (3, group)
//         Deep (6, tile)
//       Mid (4, tile)
//     Tile Layer 1 (1, tile)        bottom

function furnish(history: History): ProjectMap {
    const map = history.session.project.maps[0]!;
    const outer = createGroupLayer(2, "Outer");
    const inner = createGroupLayer(3, "Inner");
    inner.layers.push(createTileLayer(6, "Deep"));
    outer.layers.push(createTileLayer(4, "Mid"), inner);
    map.layers.push(outer, createTileLayer(5, "Top"));
    map.nextLayerId = 7;
    assertInvariants(history.session.project);
    return map;
}

function tree(layers: readonly Layer[]): string {
    return layers
        .map((layer) =>
            layer.type === "group" ? `${layer.name}[${tree(layer.layers)}]` : layer.name,
        )
        .join(",");
}

function layer(map: ProjectMap, id: number): Layer {
    return findLayer(map, id)!.layer;
}

describe("rows mirror the tree", () => {
    it("lists the layers top of the stack first, children after their group, indented", () => {
        const map = furnish(setup());
        const rows = layerRows(map.layers, new Set());
        expect(rows.map((row) => [row.name, row.depth, row.parentId])).toEqual([
            ["Top", 0, null],
            ["Outer", 0, null],
            ["Inner", 1, 2],
            ["Deep", 2, 3],
            ["Mid", 1, 2],
            ["Tile Layer 1", 0, null],
        ]);
        expect(rows.filter((row) => row.hasChildren).map((row) => row.id)).toEqual([2, 3]);
        expect(rows.every((row) => !row.muted)).toBe(true);
    });

    it("hides the children of a collapsed group", () => {
        const map = furnish(setup());
        const rows = layerRows(map.layers, new Set([3]));
        expect(rows.map((row) => row.name)).toEqual([
            "Top",
            "Outer",
            "Inner",
            "Mid",
            "Tile Layer 1",
        ]);
        expect(rows.find((row) => row.id === 3)).toMatchObject({
            hasChildren: true,
            expanded: false,
        });
        expect(layerRows(map.layers, new Set([2])).map((row) => row.name)).toEqual([
            "Top",
            "Outer",
            "Tile Layer 1",
        ]);
    });

    it("mutes every row under a hidden or a locked group, not the group itself", () => {
        const map = furnish(setup());
        layer(map, 3).visible = false;
        let rows = layerRows(map.layers, new Set());
        expect(rows.filter((row) => row.muted).map((row) => row.id)).toEqual([6]);
        layer(map, 3).visible = true;
        layer(map, 2).locked = true;
        rows = layerRows(map.layers, new Set());
        expect(rows.filter((row) => row.muted).map((row) => row.id)).toEqual([3, 6, 4]);
        // A hidden or locked layer that is no group mutes nothing.
        layer(map, 2).locked = false;
        layer(map, 4).visible = false;
        layer(map, 5).locked = true;
        expect(layerRows(map.layers, new Set()).some((row) => row.muted)).toBe(false);
    });
});

describe("drop zones and places", () => {
    it("cuts a group row in thirds and another row in halves", () => {
        expect([0, 9, 10, 18, 19, 27].map((y) => dropZone(y, 28, true))).toEqual([
            "above",
            "above",
            "into",
            "into",
            "below",
            "below",
        ]);
        expect([0, 13, 14, 27].map((y) => dropZone(y, 28, false))).toEqual([
            "above",
            "above",
            "below",
            "below",
        ]);
    });

    /** The tree after dropping `id` on `target` in `zone` through `moveLayerToCommand`. */
    function dropped(
        id: number,
        target: number,
        zone: "above" | "into" | "below",
        expanded = true,
    ) {
        const history = setup();
        const map = furnish(history);
        const place = dropPlace(map, id, target, zone, expanded);
        if (!place) return null;
        history.execute(moveLayerToCommand(MAP, id, place.parentId, place.index));
        assertInvariants(history.session.project);
        return tree(history.session.project.maps[0]!.layers);
    }

    it("puts a layer right above or below the row it is dropped on, in that row's group", () => {
        expect(dropped(1, 4, "above")).toBe("Outer[Mid,Tile Layer 1,Inner[Deep]],Top");
        expect(dropped(1, 4, "below")).toBe("Outer[Tile Layer 1,Mid,Inner[Deep]],Top");
        expect(dropped(5, 1, "below")).toBe("Top,Tile Layer 1,Outer[Mid,Inner[Deep]]");
        expect(dropped(6, 5, "above")).toBe("Tile Layer 1,Outer[Mid,Inner[]],Top,Deep");
        expect(dropped(4, 6, "below")).toBe("Tile Layer 1,Outer[Inner[Mid,Deep]],Top");
    });

    it("puts a layer dropped into a group at the bottom of its children (Tiled)", () => {
        expect(dropped(5, 3, "into")).toBe("Tile Layer 1,Outer[Mid,Inner[Top,Deep]]");
        expect(dropped(1, 2, "into")).toBe("Outer[Tile Layer 1,Mid,Inner[Deep]],Top");
    });

    it("puts a layer dropped below an expanded group at the top of its children", () => {
        expect(dropped(1, 2, "below")).toBe("Outer[Mid,Inner[Deep],Tile Layer 1],Top");
        // Collapsed: below the group, in the group's own list.
        expect(dropped(5, 2, "below", false)).toBe("Tile Layer 1,Top,Outer[Mid,Inner[Deep]]");
    });

    it("refuses a drop that moves nothing or puts a group inside itself", () => {
        const map = furnish(setup());
        expect(dropPlace(map, 4, 4, "above", true)).toBeNull();
        // Mid sits right below Inner already, and right above Tile Layer 1's place in Outer.
        expect(dropPlace(map, 4, 3, "below", false)).toBeNull();
        expect(dropPlace(map, 5, 2, "above", true)).toBeNull();
        // Mid is the bottom child of Outer already.
        expect(dropPlace(map, 4, 2, "into", true)).toBeNull();
        expect(dropPlace(map, 2, 3, "into", true)).toBeNull();
        expect(dropPlace(map, 2, 6, "above", true)).toBeNull();
        expect(dropPlace(map, 2, 4, "below", true)).toBeNull();
        // Into a layer that is no group.
        expect(dropPlace(map, 5, 4, "into", true)).toBeNull();
    });

    it("a drop is one undo step that undo reverts", () => {
        const history = setup();
        const map = furnish(history);
        const place = dropPlace(map, 1, 3, "into", true)!;
        const command = expectSymmetric(
            history,
            moveLayerToCommand(MAP, 1, place.parentId, place.index),
        );
        expect(command.label).toBe(LAYER_LABELS.move);
    });
});

describe("the layer properties popover makes one entry", () => {
    it("is null when nothing changed", () => {
        const history = setup();
        const map = furnish(history);
        const values = layerPropertiesValues(layer(map, 4));
        expect(layerPropertiesCommand(history.session.project, MAP, 4, values)).toBeNull();
    });

    it("one changed field keeps its own label", () => {
        const history = setup();
        const map = furnish(history);
        const values = { ...layerPropertiesValues(layer(map, 4)), opacity: 100 };
        const command = layerPropertiesCommand(history.session.project, MAP, 4, values)!;
        expect(command.label).toBe(LAYER_LABELS.opacity);
        expectSymmetric(history, command);
        expect(layer(history.session.project.maps[0]!, 4).opacity).toBe(100);
    });

    it("several fields are one Layer Properties entry, undone at once", () => {
        const history = setup();
        const map = furnish(history);
        const values = {
            ...layerPropertiesValues(layer(map, 2)),
            name: "Renamed",
            class: "zone",
            opacity: 200,
            offsetX: 8,
            offsetY: -4,
            parallaxX: 0.5,
            parallaxY: 2,
        };
        const command = layerPropertiesCommand(history.session.project, MAP, 2, values)!;
        expect(command.label).toBe(LAYER_LABELS.values);
        const undoCount = history.undoCount;
        expectSymmetric(history, command);
        expect(history.undoCount).toBe(undoCount + 1);
        const group = layer(history.session.project.maps[0]!, 2);
        expect(layerPropertiesValues(group)).toEqual(values);
    });

    it("keeps the layer's value for a field that cannot be set", () => {
        const map = furnish(setup());
        const tile = layer(map, 4);
        expect(
            changedLayerValues(tile, {
                ...layerPropertiesValues(tile),
                name: "x".repeat(256),
                opacity: 300,
                parallaxX: 0.25,
            }),
        ).toEqual({ parallaxX: 0.25 });
        // A blank name is a name (Tiled; SPEC §7.2 limits only its length).
        expect(changedLayerValues(tile, { ...layerPropertiesValues(tile), name: "" })).toEqual({
            name: "",
        });
    });

    it("adds the commands of kind-specific fields to the same entry", () => {
        const history = setup();
        const map = furnish(history);
        const values = { ...layerPropertiesValues(layer(map, 4)), name: "Ground" };
        const extra = setLayerValuesCommand(history.session.project, MAP, [4], { class: "x" });
        const command = layerPropertiesCommand(history.session.project, MAP, 4, values, [extra])!;
        expect(command.label).toBe(LAYER_LABELS.values);
        expectSymmetric(history, command);
        expect(layer(history.session.project.maps[0]!, 4)).toMatchObject({
            name: "Ground",
            class: "x",
        });
        // Only a kind field changed: its command alone.
        const only = layerPropertiesCommand(
            history.session.project,
            MAP,
            5,
            layerPropertiesValues(layer(history.session.project.maps[0]!, 5)),
            [extra],
        );
        expect(only).toBe(extra);
    });
});

describe("the layer popover field registry", () => {
    const field = (id: string, order: number): LayerField<string> => ({
        id,
        order,
        appliesTo: (each) => each.type === "group",
        read: (each) => each.class,
        command: (project, mapId, layerId, value) =>
            setLayerValuesCommand(project, mapId, [layerId], { class: value }),
        Field: () => null,
    });
    const module = (each: LayerField<string>): LayerFieldModule => ({
        layerField: each as unknown as LayerField<never>,
    });

    it("collects the fields in order and refuses a module without one or a repeated id", () => {
        const fields = collectLayerFields({
            "b.layerField.tsx": module(field("b", 20)),
            "a.layerField.tsx": module(field("a", 10)),
        });
        expect(fields.map((each) => each.id)).toEqual(["a", "b"]);
        expect(() => collectLayerFields({ "x.layerField.tsx": {} })).toThrow(/layerField/);
        expect(() =>
            collectLayerFields({
                "a.layerField.tsx": module(field("a", 10)),
                "c.layerField.tsx": module(field("a", 30)),
            }),
        ).toThrow(/used by/);
    });

    it("gives a command only for a changed value of a field that applies to the layer", () => {
        const history = setup();
        const map = furnish(history);
        const fields = [field("a", 10)] as unknown as LayerField[];
        const { project } = history.session;
        expect(extraCommands(fields, project, MAP, layer(map, 2), {})).toEqual([]);
        expect(extraCommands(fields, project, MAP, layer(map, 2), { a: "" })).toEqual([]);
        expect(extraCommands(fields, project, MAP, layer(map, 4), { a: "zone" })).toEqual([]);
        expect(extraCommands(fields, project, MAP, layer(map, 2), { a: "zone" })).toHaveLength(1);
    });
});
