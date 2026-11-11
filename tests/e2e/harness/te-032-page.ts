// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { mapTabsStore } from "../../../src/app/tabs/tabs";
import { mapFields } from "../../../src/core/maps";
import type { MapFields } from "../../../src/core/maps";
import {
    assertInvariants,
    createMap,
    createProject,
    createProjectSession,
    exportNames,
    sequentialIds,
} from "../../../src/core/model";
import { readCanvas } from "../../../src/engine/testing/readCanvas";
import { checkerColourAt } from "../../../src/engine/viewport/checker";

// TE-032 page module: the specs import it into the running editor, so it shares the app's
// stores. It loads "Quest" with three maps of 16 px cells, "Overworld" (40 × 30, active, the
// only tab), "Cave" (20 × 10) and "Dungeon" (64 × 64), reads maps, tabs and history back, and
// reads the viewport's canvas inside the active map for its background colour.

const hooks = () => window.__ngneTest!;
const state = () => hooks().session.getState();

/** Loads the test project as a new history. Returns the maps' IDs in list order. */
export function load(): string[] {
    const project = createProject({
        name: "Quest",
        newId: sequentialIds("p"),
        map: { name: "Overworld", width: 40, height: 30 },
    });
    for (const [name, width, height] of [
        ["Cave", 20, 10],
        ["Dungeon", 64, 64],
    ] as const) {
        project.maps.push(
            createMap({ name, width, height, takenExportNames: exportNames(project) }),
        );
    }
    project.tilesets.push({
        id: "ts",
        name: "Tiles",
        exportName: "tiles",
        class: "",
        slot: 1,
        tileWidth: 16,
        tileHeight: 16,
        offsetX: 0,
        offsetY: 0,
        columns: 1,
        pixels: { width: 16, height: 16, data: new Uint8ClampedArray(16 * 16 * 4).fill(255) },
        nextTileId: 1,
        source: { kind: "image", fileName: "tiles.png", margin: 0, spacing: 0 },
        tiles: [
            {
                id: 0,
                sourceKey: [0, 0],
                fingerprint: "0".repeat(64),
                class: "",
                collision: [],
                animation: [],
                properties: [],
            },
        ],
        terrainSets: [],
        properties: [],
    });
    assertInvariants(project);
    state().replace(createProjectSession(project));
    return project.maps.map((map) => map.id);
}

export interface MapView extends MapFields {
    id: string;
    width: number;
    height: number;
}

export interface Snapshot {
    maps: MapView[];
    active: string;
    open: string[];
    undo: number;
    undoLabel: string | null;
    redo: number;
}

export function snapshot(): Snapshot {
    const { session, history } = state();
    return {
        maps: session.project.maps.map((map) => ({
            id: map.id,
            width: map.width,
            height: map.height,
            ...mapFields(map),
        })),
        active: session.activeMapId,
        open: [...mapTabsStore.getState().open],
        undo: history.undoCount,
        undoLabel: history.undoLabel,
        redo: history.redoCount,
    };
}

function themeColour(name: string): number {
    const text = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return Number.parseInt(text.replace("#", ""), 16);
}

export interface Sample {
    /** Map pixel sampled. */
    x: number;
    y: number;
    /** What should show there: the background colour over the checkerboard. */
    expected: number[];
    actual: number[];
}

/**
 * Shows the active map at 100%, centred, submits a frame and reads the canvas back in the same
 * task. Samples the centres of 16 checker squares inside the map (the map has no tiles), each
 * with the colour it should have: the map's background colour composited over the checkerboard.
 */
export function readBackground(): { background: number | null; samples: Sample[] } {
    const viewport = hooks().viewport;
    if (!viewport) throw new Error("te-032: no viewport probe");
    const { session, touch } = state();
    const map = session.project.maps.find((each) => each.id === session.activeMapId)!;
    const own = session.perMap.get(map.id)!;
    const width = map.width * map.tileWidth;
    const height = map.height * map.tileHeight;
    own.view = { centreX: width / 2, centreY: height / 2, zoom: 1 };
    touch();
    if (!viewport.renderNow()) throw new Error("te-032: the renderer did not submit a frame");
    const image = readCanvas(viewport.canvas);
    const scale = window.devicePixelRatio;
    const checker = {
        a: themeColour("--check-a"),
        b: themeColour("--check-b"),
        size: hooks().preferences.get("checkerboard").size,
    };
    const background = map.backgroundColor;
    const samples: Sample[] = [];
    for (let row = -2; row < 2; row++) {
        for (let column = -2; column < 2; column++) {
            // The centre of a checker square near the map's centre, inside the visible map.
            const x = (Math.floor(width / 2 / checker.size) + column + 0.5) * checker.size;
            const y = (Math.floor(height / 2 / checker.size) + row + 0.5) * checker.size;
            const dx = Math.floor((x - width / 2) * scale + image.width / 2);
            const dy = Math.floor((y - height / 2) * scale + image.height / 2);
            const at = (dy * image.width + dx) * 4;
            const under = checkerColourAt(checker, Math.floor(x), Math.floor(y));
            const alpha = background === null ? 0 : (background & 255) / 255;
            const expected = [16, 8, 0].map((shift, index) => {
                const base = (under >>> shift) & 255;
                const colour = background === null ? 0 : (background >>> (24 - 8 * index)) & 255;
                return Math.round(colour * alpha + base * (1 - alpha));
            });
            const actual = [0, 1, 2].map((channel) => image.data[at + channel]!);
            samples.push({ x, y, expected, actual });
        }
    }
    return { background, samples };
}
