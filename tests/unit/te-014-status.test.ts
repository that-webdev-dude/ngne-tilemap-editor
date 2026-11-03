import { describe, expect, it } from "vitest";
import { createStatusStore } from "../../src/app/state/status";
import { StatusFieldError, collectStatusFields } from "../../src/ui/status/statusFields";
import type { StatusField, StatusFieldInput } from "../../src/ui/status/statusFields";
import { tileUnderCursor } from "../../src/ui/status/view.status";
import { newSession, tile, tileLayer } from "./te-006-support";

// The status bar's field registry and the tile field (TE-014).

const field = (id: string, order: number): StatusField => ({ id, order, text: () => id });

describe("status field registry", () => {
    it("orders the fields of all modules by order, then id", () => {
        const fields = collectStatusFields({
            "a.status.ts": { statusFields: [field("b", 200), field("a", 200)] },
            "b.status.ts": { statusFields: [field("first", 100)] },
        });
        expect(fields.map((each) => each.id)).toEqual(["first", "a", "b"]);
    });

    it("names the module of a duplicate id, a missing export and a missing order", () => {
        expect(() =>
            collectStatusFields({
                "a.status.ts": { statusFields: [field("x", 1)] },
                "b.status.ts": { statusFields: [field("x", 2)] },
            }),
        ).toThrow(/"x" is used by a\.status\.ts and b\.status\.ts/);
        expect(() => collectStatusFields({ "c.status.ts": {} })).toThrow(StatusFieldError);
        expect(() =>
            collectStatusFields({ "d.status.ts": { statusFields: [field("y", NaN)] } }),
        ).toThrow(/d\.status\.ts/);
        expect(() =>
            collectStatusFields({ "e.status.ts": { statusFields: [field(" ", 1)] } }),
        ).toThrow(/no id/);
    });

    it("finds the fields of this ticket in the app's own registry", async () => {
        const { statusFields } = await import("../../src/ui/status/statusFields");
        expect(statusFields.map((each) => each.id)).toEqual([
            "cell",
            "tile",
            "panelTile",
            "zoom",
            "size",
            "selection",
        ]);
    });
});

describe("tile under the cursor", () => {
    function setup() {
        const session = newSession(8, 8);
        const map = session.project.maps[0]!;
        const layer = tileLayer(session.project);
        session.perMap.get(map.id)!.activeLayerId = layer.id;
        layer.cells.set(2, 3, tile(1));
        const input = (cursor: { x: number; y: number } | null): StatusFieldInput => ({
            session,
            map,
            cursor,
        });
        return { session, map, layer, input };
    }

    it("shows tileset#id", () => {
        const { input } = setup();
        expect(tileUnderCursor(input({ x: 2, y: 3 }))).toBe("Tileset 1#1");
    });

    it("adds the tile's class", () => {
        const { session, input } = setup();
        session.project.tilesets[0]!.tiles.find((each) => each.id === 1)!.class = "grass";
        expect(tileUnderCursor(input({ x: 2, y: 3 }))).toBe("Tileset 1#1 (grass)");
    });

    it("is blank off the map and on an empty cell", () => {
        const { input } = setup();
        expect(tileUnderCursor(input(null))).toBe("");
        expect(tileUnderCursor(input({ x: 0, y: 0 }))).toBe("");
    });

    it("is blank when the active layer is not a tile layer", () => {
        const { session, map, input } = setup();
        map.layers.push({
            id: 99,
            type: "marker",
            name: "Markers",
            class: "",
            visible: true,
            locked: false,
            opacity: 255,
            offsetX: 0,
            offsetY: 0,
            parallaxX: 1,
            parallaxY: 1,
            properties: [],
            color: 0xff0000ff,
            markers: [],
        });
        session.perMap.get(map.id)!.activeLayerId = 99;
        expect(tileUnderCursor(input({ x: 2, y: 3 }))).toBe("");
    });

    it("is blank without a map", () => {
        const { session } = setup();
        expect(tileUnderCursor({ session, map: null, cursor: { x: 2, y: 3 } })).toBe("");
    });
});

describe("status store", () => {
    it("holds the cursor, the hint and the feedback", () => {
        const store = createStatusStore();
        expect(store.getState()).toMatchObject({ cursor: null, hint: null, feedback: null });
        store.getState().setCursor({ x: 1, y: 2 });
        store.getState().setHint("Shift: line");
        store.getState().setFeedback("Layer is locked");
        expect(store.getState()).toMatchObject({
            cursor: { x: 1, y: 2 },
            hint: "Shift: line",
            feedback: "Layer is locked",
        });
    });
});
