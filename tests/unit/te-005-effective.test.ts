import { describe, expect, it } from "vitest";
import {
    createGroupLayer,
    createMap,
    createTileLayer,
    effectiveLayerValues,
    effectiveValues,
    findLayer,
    walkLayers,
} from "../../src/core/model";
import type { GroupLayer, Layer } from "../../src/core/model";

// Effective layer values under nested groups (FORMAT §2.5): visible and unlocked only if
// every ancestor is; opacity and parallax multiply; offsets add.

function group(id: number, layers: Layer[], values: Partial<GroupLayer> = {}): GroupLayer {
    return { ...createGroupLayer(id, `Group ${id}`), ...values, layers };
}

function tree() {
    const leaf = {
        ...createTileLayer(3, "Leaf"),
        opacity: 128,
        offsetX: 1,
        offsetY: 2,
        parallaxX: 2,
        parallaxY: 0.5,
    };
    const inner = group(2, [leaf], {
        opacity: 128,
        offsetX: 10,
        offsetY: 20,
        parallaxX: 0.5,
        parallaxY: 4,
    });
    const outer = group(1, [inner], {
        opacity: 255,
        offsetX: 100,
        offsetY: 200,
        parallaxX: 3,
        parallaxY: 1,
    });
    const map = createMap();
    map.layers = [outer];
    map.nextLayerId = 4;
    return { map, outer, inner, leaf };
}

describe("walkLayers and findLayer", () => {
    it("visits every layer depth first with its ancestors", () => {
        const { map, outer, inner, leaf } = tree();
        const entries = [...walkLayers(map.layers)];
        expect(entries.map((entry) => entry.layer.id)).toEqual([1, 2, 3]);
        expect(entries[2]!.ancestors).toEqual([outer, inner]);
        expect(findLayer(map, 3)?.layer).toBe(leaf);
        expect(findLayer(map, 9)).toBeUndefined();
    });
});

describe("effective values", () => {
    it("are the layer's own values without a group", () => {
        const layer = createTileLayer(1, "Alone");
        expect(effectiveValues(layer, [])).toEqual({
            visible: true,
            unlocked: true,
            opacity: 255,
            offsetX: 0,
            offsetY: 0,
            parallaxX: 1,
            parallaxY: 1,
        });
    });

    it("multiply opacity and parallax and add offsets through two groups", () => {
        const { map } = tree();
        const values = effectiveLayerValues(map, 3)!;
        expect(values.opacity).toBeCloseTo((255 * 128 * 128) / (255 * 255), 6);
        expect(values.offsetX).toBe(111);
        expect(values.offsetY).toBe(222);
        expect(values.parallaxX).toBe(3);
        expect(values.parallaxY).toBe(2);
        expect(values.visible).toBe(true);
        expect(values.unlocked).toBe(true);
    });

    it("hide a layer when any ancestor is hidden", () => {
        const { map, outer, inner } = tree();
        outer.visible = false;
        expect(effectiveLayerValues(map, 3)!.visible).toBe(false);
        expect(effectiveLayerValues(map, 2)!.visible).toBe(false);
        outer.visible = true;
        inner.visible = false;
        expect(effectiveLayerValues(map, 3)!.visible).toBe(false);
        expect(effectiveLayerValues(map, 1)!.visible).toBe(true);
    });

    it("lock a layer when any ancestor is locked", () => {
        const { map, outer, inner, leaf } = tree();
        inner.locked = true;
        expect(effectiveLayerValues(map, 3)!.unlocked).toBe(false);
        expect(effectiveLayerValues(map, 1)!.unlocked).toBe(true);
        inner.locked = false;
        outer.locked = true;
        expect(effectiveLayerValues(map, 3)!.unlocked).toBe(false);
        outer.locked = false;
        leaf.locked = true;
        expect(effectiveLayerValues(map, 3)!.unlocked).toBe(false);
        expect(effectiveLayerValues(map, 2)!.unlocked).toBe(true);
    });

    it("give a group its own effective values too", () => {
        const { map } = tree();
        const values = effectiveLayerValues(map, 2)!;
        expect(values.offsetX).toBe(110);
        expect(values.parallaxX).toBe(1.5);
        expect(values.opacity).toBe(128);
    });

    it("is undefined for a layer the map does not hold", () => {
        expect(effectiveLayerValues(createMap(), 42)).toBeUndefined();
    });
});
