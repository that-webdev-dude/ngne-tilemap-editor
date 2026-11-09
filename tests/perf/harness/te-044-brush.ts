// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { toolState } from "../../../src/app/tools/activeTool";
import { chooseBrushTerrain } from "../../../src/app/tools/terrain/brushTerrain";
import { resetTerrainBrush } from "../../../src/app/tools/terrain/terrainBrush.tools";
import { currentViewMapping } from "../../../src/app/view/viewNavigation";
import { cellValue } from "../../../src/core/cells";
import { createProjectSession } from "../../../src/core/model";
import type { TileLayer } from "../../../src/core/model";
import { createReferenceProject, REFERENCE } from "../../support/referenceProject";

// TE-044 benchmark page module (tests/perf/te-044-brush.perf.ts): the reference map at 100% in
// the editor's viewport, its first tileset given a complete corner terrain set of 4 terrains
// (tile t has the base-4 digits of t at its four corners: the 256 tiles are the 4^4
// combinations), and the tile layer under the parallax layer (TE-017's) filled with the tile
// of terrain 1 at every corner. The terrain brush paints terrain 2 there. Every pointer down or
// move of a stroke is timed from the event's time stamp to the first frame the viewport submits
// after it, which contains the cells the event painted. The page imports it into the running
// editor.

function viewport() {
    const probe = window.__ngneTest?.viewport;
    if (!probe) throw new Error("te-044 brush: no viewport");
    return probe;
}

/** Resolves when `condition` holds, checked between tasks. */
function until(condition: () => boolean): Promise<void> {
    return new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
            if (condition()) {
                channel.port1.close();
                resolve();
            } else {
                channel.port2.postMessage(null);
            }
        };
        channel.port2.postMessage(null);
    });
}

/** Milliseconds from each timed event to the frame containing it. */
const samples: number[] = [];
/** The tier of each sample's frame. */
const tiers: string[] = [];

export interface Opened {
    canvas: [number, number];
    tier: string;
    layerId: number;
}

/** The corner terrains of tile `t`: its base-4 digits plus 1, as a WangId. */
function wangIdOf(t: number): number[] {
    const corner = (k: number) => (Math.floor(t / 4 ** k) % 4) + 1;
    // Top, top-right, right, bottom-right, bottom, bottom-left, left, top-left.
    return [0, corner(0), 0, corner(1), 0, corner(2), 0, corner(3)];
}

/**
 * Opens the reference map at 100% in its middle with the terrain set and layer described above,
 * the terrain brush selected on terrain 2, and times every press and drag sample of the stroke
 * from then on.
 */
export async function openReference(): Promise<Opened> {
    const probe = viewport();
    const project = createReferenceProject();
    const tileset = project.tilesets[0]!;
    const colours = ["#5a9e3aff", "#e2c275ff", "#3b78c9ff", "#8a8a8aff"];
    tileset.terrainSets = [
        {
            name: "Reference corners",
            type: "corner",
            colors: ["One", "Two", "Three", "Four"].map((name, index) => ({
                name,
                color: colours[index]!,
                tile: null,
            })),
            tiles: tileset.tiles.map((tile) => ({ tile: tile.id, wangId: wangIdOf(tile.id) })),
        },
    ];
    const session = createProjectSession(project);
    const map = session.project.maps[0]!;
    const layer = map.layers[REFERENCE.parallaxLayer - 1] as TileLayer;
    const one = cellValue(tileset.slot, 0);
    for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) layer.cells.set(x, y, one);
    }
    const side = REFERENCE.width * REFERENCE.tileWidth;
    const mapSession = session.perMap.get(session.activeMapId)!;
    Object.assign(mapSession.view, { centreX: side / 2, centreY: side / 2, zoom: 1 });
    mapSession.activeLayerId = layer.id;
    window.__ngneTest!.session.getState().replace(session);
    window.__ngneTest!.assertInvariants();
    await until(() => probe.textureIds().filter((id) => id.startsWith("ed:ts:")).length === 2);
    if (!toolState.select("terrain")) throw new Error("te-044 brush: no terrain brush");
    resetTerrainBrush();
    chooseBrushTerrain(2);

    const time = (event: PointerEvent) => {
        if ((event.buttons & 1) === 0 || !window.__ngneTest!.tools?.stroking) return;
        const frames = probe.stats.frames;
        void until(() => probe.stats.frames > frames).then(() => {
            samples.push(performance.now() - event.timeStamp);
            tiers.push(probe.stats.tier);
        });
    };
    // After the tools' own listeners on the overlay: the event has painted when this runs.
    window.addEventListener("pointerdown", time);
    window.addEventListener("pointermove", time);
    await until(() => probe.stats.frames > 0);
    return {
        canvas: [probe.canvas.width, probe.canvas.height],
        tier: probe.stats.tier,
        layerId: layer.id,
    };
}

/** The client position of the centre of cell `(x, y)` as the map is on screen. */
export function cellClient(x: number, y: number): { x: number; y: number } {
    const mapping = currentViewMapping()!;
    return mapping.mapToClient((x + 0.5) * REFERENCE.tileWidth, (y + 0.5) * REFERENCE.tileHeight);
}

/** Resolves when `count` samples are in, and one more animation frame has gone by. */
export async function recorded(count: number): Promise<number> {
    await until(() => samples.length >= count);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return samples.length;
}

export interface BrushRecord {
    ms: number[];
    tiers: string[];
    /** History entries the stroke made: one. */
    undo: string | null;
    /** Cells of the layer the stroke changed. */
    painted: number;
}

export function result(layerId: number): BrushRecord {
    const { session, history } = window.__ngneTest!.session.getState();
    const map = session.project.maps[0]!;
    const layer = map.layers.find((each) => each.id === layerId) as TileLayer;
    const one = cellValue(session.project.tilesets[0]!.slot, 0);
    let painted = 0;
    for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) if (layer.cells.get(x, y) !== one) painted++;
    }
    return { ms: [...samples], tiers: [...tiers], undo: history.undoLabel, painted };
}
