import { describe, expect, it } from "vitest";
import {
    PREVIEW_BACKGROUND,
    layerCutoff,
    layerFilter,
    previewBackground,
    previewCamera,
    previewDisplay,
} from "../../src/app/preview/previewView";
import { createMapSession, createProjectSession } from "../../src/core/model";
import type { ProjectMap } from "../../src/core/model";
import type { TilemapLayer } from "../../src/core/runtime/runtime";
import { createConformanceProject } from "../support/conformanceProject";

// TE-056: what the Preview section shows besides the tilemap (SPEC §12, DESIGN §8.4): the
// integer scale, the camera on the viewport's centre, the background and the layer filter.

function layersMap(): { map: ProjectMap; session: ReturnType<typeof createProjectSession> } {
    const project = createConformanceProject();
    const map = project.maps.find((each) => each.exportName === "layers")!;
    const session = createProjectSession(project);
    session.activeMapId = map.id;
    return { map, session };
}

describe("the preview's scale (SPEC §12)", () => {
    it("fits the largest whole number of device pixels per game pixel", () => {
        expect(
            previewDisplay({ width: 320, height: 180 }, { width: 700, height: 400 }, 1, "fit"),
        ).toEqual({ scale: 2, width: 640, height: 360 });
        // CSS size at another device pixel ratio: the same device pixels.
        expect(
            previewDisplay({ width: 320, height: 180 }, { width: 700, height: 400 }, 1.25, "fit"),
        ).toEqual({ scale: 2, width: 512, height: 288 });
    });

    it("shows a game larger than the stage at 1/n, and 1:1 before the stage is laid out", () => {
        expect(
            previewDisplay({ width: 480, height: 270 }, { width: 246, height: 130 }, 1, "fit"),
        ).toEqual({ scale: 1 / 3, width: 160, height: 90 });
        expect(
            previewDisplay({ width: 480, height: 270 }, { width: 0, height: 0 }, 1, "fit"),
        ).toEqual({ scale: 1, width: 480, height: 270 });
    });

    it("uses a chosen scale as it is", () => {
        expect(
            previewDisplay({ width: 320, height: 180 }, { width: 246, height: 130 }, 1, "3"),
        ).toEqual({ scale: 3, width: 960, height: 540 });
    });
});

describe("the preview's camera and background", () => {
    it("centres the view on the viewport's centre, on whole map pixels", () => {
        const { map, session } = layersMap();
        const resolution = { id: "320x180", width: 320, height: 180 };
        // The default view: the map's centre (96, 64).
        expect(previewCamera(session, map, resolution)).toEqual({ x: -64, y: -26 });
        session.perMap.set(map.id, {
            ...createMapSession(map),
            view: { centreX: 100.4, centreY: 50.6, zoom: 2 },
        });
        expect(previewCamera(session, map, resolution)).toEqual({ x: -60, y: -39 });
    });

    it("clears to the map's background colour over the default one", () => {
        const { map } = layersMap();
        map.backgroundColor = null;
        expect(previewBackground(map)).toBe(PREVIEW_BACKGROUND);
        map.backgroundColor = 0x3b2b5eff;
        expect(previewBackground(map)).toBe(0x3b2b5e);
        map.backgroundColor = 0xff000080;
        expect(previewBackground(map)).toBe(0x901010);
    });
});

describe("the layer filter 'this layer and below' (SPEC §12)", () => {
    // Tilemap layers of the layers map, bottom to top: Ground 0, Sky 1, Far 2, Ghost 3, Spawns 4.
    it("cuts at the active layer, the top of a group, or under an empty group", () => {
        const { map } = layersMap();
        const id = (name: string) => {
            for (const layer of map.layers) {
                if (layer.name === name) return layer.id;
                if (layer.type === "group") {
                    const child = layer.layers.find((each) => each.name === name);
                    if (child) return child.id;
                }
            }
            throw new Error(name);
        };
        expect(layerCutoff(map, id("Ground"))).toBe(0);
        expect(layerCutoff(map, id("Far"))).toBe(2);
        expect(layerCutoff(map, id("Ghost"))).toBe(3);
        expect(layerCutoff(map, id("Veil"))).toBe(3);
        expect(layerCutoff(map, id("Spawns"))).toBe(4);
        const veil = map.layers.find((layer) => layer.name === "Veil")!;
        if (veil.type !== "group") throw new Error("Veil");
        veil.layers = [];
        expect(layerCutoff(map, veil.id)).toBe(2);
        expect(layerCutoff(map, 999)).toBe(-1);
    });

    it("draws the visible layers at or under the active layer; null for all visible", () => {
        const { map, session } = layersMap();
        expect(layerFilter(session, map, false)).toBeNull();
        const far = map.layers.find((layer) => layer.name === "Far")!;
        session.perMap.set(map.id, { ...createMapSession(map), activeLayerId: far.id });
        const filter = layerFilter(session, map, true)!;
        const layer = (visible: boolean) => ({ visible }) as TilemapLayer;
        expect([0, 1, 2, 3].map((index) => filter(layer(true), index))).toEqual([
            true,
            true,
            true,
            false,
        ]);
        expect(filter(layer(false), 0)).toBe(false);
    });
});
