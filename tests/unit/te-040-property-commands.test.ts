import { describe, expect, it } from "vitest";
import type { History } from "../../src/core/history";
import { MAX_PROPERTIES, createMarkerLayer } from "../../src/core/model";
import type { Project, Property } from "../../src/core/model";
import {
    BUILTIN_LABELS,
    PROPERTY_LABELS,
    PropertyEditError,
    addPropertyCommand,
    changePropertyTypeCommand,
    commonProperties,
    propertyOwners,
    removePropertyCommand,
    renamePropertyCommand,
    setProjectFieldsCommand,
    setPropertyValueCommand,
    setTilesClassCommand,
} from "../../src/core/properties";
import type { PropertyTarget } from "../../src/core/properties";
import { expectSymmetric, snapshotProject } from "./support/symmetry";
import { LAYER, MAP, setup } from "./te-006-support";

// TE-040: the property commands of SPEC §9 (add, rename, change type, set, remove) on every
// kind of target, and the built-in fields no other module sets (project name and export name,
// tile class). Every command passes the TE-006 symmetry harness; several items change together
// in one entry; refusals leave the project and the history unchanged.
//
// `setup` gives an 8 × 8 map (MAP) with one tile layer (LAYER) and a 2-tile tileset "ts";
// `furnish` adds a marker layer (2) with markers 1 and 2.

function furnish(history: History): Project {
    const { project } = history.session;
    const layer = createMarkerLayer(2, "Markers");
    const base = { name: "", class: "", properties: [] as Property[] };
    layer.markers.push(
        { ...base, id: 1, shape: "point", x: 1, y: 1 },
        { ...base, id: 2, shape: "point", x: 2, y: 2 },
    );
    project.maps[0]!.layers.push(layer);
    project.maps[0]!.nextLayerId = 3;
    project.maps[0]!.nextMarkerId = 3;
    return project;
}

const TARGETS: [string, PropertyTarget][] = [
    ["project", { kind: "project" }],
    ["tileset", { kind: "tileset", tilesetId: "ts" }],
    ["tiles", { kind: "tiles", tilesetId: "ts", tileIds: [0, 1] }],
    ["map", { kind: "map", mapId: MAP }],
    ["layer", { kind: "layer", mapId: MAP, layerId: LAYER }],
    ["markers", { kind: "markers", mapId: MAP, markerIds: [1, 2] }],
];

const lists = (history: History, target: PropertyTarget) =>
    propertyOwners(history.session.project, target).map((owner) => owner.properties);

describe("every property command passes the symmetry harness", () => {
    for (const [kind, target] of TARGETS) {
        it(`on a ${kind} target`, () => {
            const history = setup();
            furnish(history);
            const run = (make: (project: Project) => ReturnType<typeof addPropertyCommand>) =>
                expectSymmetric(history, (session) => make(session.project));

            expect(run((p) => addPropertyCommand(p, target, "speed", "int", 4)).label).toBe(
                PROPERTY_LABELS.add,
            );
            run((p) => addPropertyCommand(p, target, "alive", "bool"));
            run((p) => renamePropertyCommand(p, target, "speed", "velocity"));
            run((p) => changePropertyTypeCommand(p, target, "velocity", "string"));
            run((p) => setPropertyValueCommand(p, target, "velocity", "string", "fast"));
            run((p) => removePropertyCommand(p, target, "alive"));

            for (const list of lists(history, target)) {
                expect(list).toEqual([{ name: "velocity", type: "string", value: "fast" }]);
            }
            expect(history.undoCount).toBe(6);
        });
    }
});

describe("several items", () => {
    const markers: PropertyTarget = { kind: "markers", mapId: MAP, markerIds: [1, 2] };

    it("change together in one entry", () => {
        const history = setup();
        furnish(history);
        history.execute(addPropertyCommand(history.session.project, markers, "hp", "int", 1));
        expect(history.undoCount).toBe(1);
        expect(lists(history, markers)).toEqual([
            [{ name: "hp", type: "int", value: 1 }],
            [{ name: "hp", type: "int", value: 1 }],
        ]);
    });

    it("show a property common to all, mixed when the values differ", () => {
        const list = (value: number, extra: Property[] = []): Property[] => [
            { name: "hp", type: "int", value },
            ...extra,
        ];
        expect(commonProperties([list(1), list(1)])).toEqual([
            { name: "hp", type: "int", value: 1, mixed: false },
        ]);
        expect(commonProperties([list(1), list(2)])).toEqual([
            { name: "hp", type: "int", value: 1, mixed: true },
        ]);
        // Only on one item, or of another type on one: not common.
        const only: Property = { name: "a", type: "bool", value: true };
        expect(commonProperties([list(1, [only]), list(1)]).map((each) => each.name)).toEqual([
            "hp",
        ]);
        expect(
            commonProperties([
                [{ name: "hp", type: "int", value: 1 }],
                [{ name: "hp", type: "float", value: 1 }],
            ]),
        ).toEqual([]);
    });

    it("convert each item's own value on Change Type", () => {
        const history = setup();
        const project = furnish(history);
        const layer = project.maps[0]!.layers[1]!;
        if (layer.type !== "marker") throw new Error("not a marker layer");
        layer.markers[0]!.properties = [{ name: "v", type: "string", value: "12" }];
        layer.markers[1]!.properties = [{ name: "v", type: "string", value: "abc" }];
        expectSymmetric(history, (session) =>
            changePropertyTypeCommand(session.project, markers, "v", "int"),
        );
        expect(lists(history, markers)).toEqual([
            [{ name: "v", type: "int", value: 12 }],
            [{ name: "v", type: "int", value: 0 }],
        ]);
    });
});

describe("lists stay sorted by name in UTF-16 code-unit order", () => {
    it("after add and rename", () => {
        const history = setup();
        const target: PropertyTarget = { kind: "map", mapId: MAP };
        for (const name of ["b", "a", "B", "é"]) {
            history.execute(addPropertyCommand(history.session.project, target, name, "bool"));
        }
        history.execute(renamePropertyCommand(history.session.project, target, "a", "c"));
        expect(lists(history, target)[0]!.map((each) => each.name)).toEqual(["B", "b", "c", "é"]);
    });
});

describe("refusals change nothing", () => {
    const target: PropertyTarget = { kind: "layer", mapId: MAP, layerId: LAYER };

    function expectRefused(history: History, make: (project: Project) => unknown): void {
        const before = snapshotProject(history.session.project);
        const undoCount = history.undoCount;
        expect(() => {
            const command = make(history.session.project);
            history.execute(command as Parameters<History["execute"]>[0]);
        }).toThrow(PropertyEditError);
        expect(snapshotProject(history.session.project)).toStrictEqual(before);
        expect(history.undoCount).toBe(undoCount);
    }

    it("a blank, too long or taken name", () => {
        const history = setup();
        history.execute(addPropertyCommand(history.session.project, target, "a", "bool"));
        history.execute(addPropertyCommand(history.session.project, target, "b", "bool"));
        expectRefused(history, (p) => addPropertyCommand(p, target, "  ", "bool"));
        expectRefused(history, (p) => addPropertyCommand(p, target, "x".repeat(256), "bool"));
        expectRefused(history, (p) => addPropertyCommand(p, target, "a", "int"));
        expectRefused(history, (p) => renamePropertyCommand(p, target, "a", "b"));
        expectRefused(history, (p) => renamePropertyCommand(p, target, "a", ""));
    });

    it("a value not of its type or too long", () => {
        const history = setup();
        history.execute(addPropertyCommand(history.session.project, target, "s", "string"));
        history.execute(addPropertyCommand(history.session.project, target, "f", "file"));
        history.execute(addPropertyCommand(history.session.project, target, "i", "int"));
        history.execute(addPropertyCommand(history.session.project, target, "c", "color"));
        history.execute(addPropertyCommand(history.session.project, target, "n", "float"));
        const set = (name: string, type: Property["type"], value: Property["value"]) =>
            expectRefused(history, (p) => setPropertyValueCommand(p, target, name, type, value));
        set("s", "string", "x".repeat(65_536));
        set("f", "file", "x".repeat(1025));
        set("i", "int", 1.5);
        set("i", "int", 9_007_199_254_740_992);
        set("c", "color", "#fff");
        set("n", "float", Number.NaN);
        set("n", "float", Number.POSITIVE_INFINITY);
        // The type given must be the property's.
        set("s", "int", 3);
        // The longest values are taken.
        history.execute(
            setPropertyValueCommand(
                history.session.project,
                target,
                "s",
                "string",
                "x".repeat(65_535),
            ),
        );
        history.execute(
            setPropertyValueCommand(history.session.project, target, "f", "file", "x".repeat(1024)),
        );
    });

    it("a 257th property", () => {
        const history = setup();
        const { project } = history.session;
        project.maps[0]!.layers[0]!.properties = Array.from({ length: MAX_PROPERTIES }, (_, k) => ({
            name: `p${String(k).padStart(3, "0")}`,
            type: "bool" as const,
            value: false,
        }));
        expectRefused(history, (p) => addPropertyCommand(p, target, "one-more", "bool"));
    });

    it("a 257th property on one of several items", () => {
        const history = setup();
        const project = furnish(history);
        const layer = project.maps[0]!.layers[1]!;
        if (layer.type !== "marker") throw new Error("not a marker layer");
        layer.markers[1]!.properties = Array.from({ length: MAX_PROPERTIES }, (_, k) => ({
            name: `p${k}`,
            type: "bool" as const,
            value: false,
        }));
        const markers: PropertyTarget = { kind: "markers", mapId: MAP, markerIds: [1, 2] };
        expectRefused(history, (p) => addPropertyCommand(p, markers, "x", "bool"));
    });

    it("an unknown item or property", () => {
        const history = setup();
        expectRefused(history, (p) =>
            addPropertyCommand(p, { kind: "layer", mapId: MAP, layerId: 99 }, "a", "bool"),
        );
        expectRefused(history, (p) =>
            addPropertyCommand(p, { kind: "tiles", tilesetId: "ts", tileIds: [5] }, "a", "bool"),
        );
        expectRefused(history, (p) => removePropertyCommand(p, target, "nope"));
    });
});

describe("built-in fields", () => {
    it("project name and export name pass the symmetry harness", () => {
        const history = setup();
        const name = expectSymmetric(history, setProjectFieldsCommand({ name: "World" }));
        expect(name.label).toBe(BUILTIN_LABELS.projectName);
        const slug = expectSymmetric(history, setProjectFieldsCommand({ exportName: "world" }));
        expect(slug.label).toBe(BUILTIN_LABELS.projectExportName);
        expect(history.session.project).toMatchObject({ name: "World", exportName: "world" });
        expect(() => setProjectFieldsCommand({ name: " " })).toThrow(PropertyEditError);
        expect(() => setProjectFieldsCommand({ exportName: "Bad Name" })).toThrow(
            PropertyEditError,
        );
    });

    it("tile class passes the symmetry harness for several tiles", () => {
        const history = setup();
        expectSymmetric(history, (session) =>
            setTilesClassCommand(session.project, "ts", [0, 1], "solid"),
        );
        expect(history.session.project.tilesets[0]!.tiles.map((tile) => tile.class)).toEqual([
            "solid",
            "solid",
        ]);
        expect(() =>
            setTilesClassCommand(history.session.project, "ts", [0], "x".repeat(256)),
        ).toThrow(PropertyEditError);
    });
});
