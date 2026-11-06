// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { activateMap } from "../../../src/app/tabs/tabs";
import { fitActiveView, zoomTo } from "../../../src/app/view/viewNavigation";
import { duplicateMapCommand } from "../../../src/core/maps";
import { createProjectSession, sequentialIds } from "../../../src/core/model";
import { createReferenceProject } from "../../support/referenceProject";

// TE-031 benchmark page module (tests/perf/te-031-tab-switch.perf.ts): two open tabs, each the
// reference map of ENGINE §6 (the second a duplicate of the first), shown at the view `mode`
// names. A switch makes the other map the active one, as a click on its tab does, and is timed
// from that call to the return of the first frame submitted after it (`Viewport.renderNow`,
// called from the viewport's animation-frame callback, which the switch requested before this
// module requests its own).

export type ViewMode = "fit" | "100";

export interface Prepared {
    canvas: [number, number];
    maps: [string, string];
}

export interface SwitchRecord {
    /** Milliseconds from the switch to the return of the first frame submitted after it. */
    switchMs: number[];
    /** Of each first frame: milliseconds from the start of its draw to the return of `render`. */
    drawMs: number[];
    /** The tier of each first frame (ENGINE §4) and its sprites. */
    tiers: string[];
    sprites: number[];
}

function probe() {
    const viewport = window.__ngneTest?.viewport;
    if (!viewport) throw new Error("te-031 tab switch: no viewport");
    return viewport;
}

const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Loads the reference project with a duplicate of its map, both open, each at the view `mode`
 * names: fitted, or 100% (one device pixel per map pixel) at the map's centre. Resolves once
 * both tileset textures and the checkerboard are uploaded.
 */
export async function prepare(mode: ViewMode): Promise<Prepared> {
    const hooks = window.__ngneTest!;
    const viewport = probe();
    const session = createProjectSession(createReferenceProject());
    const first = session.project.maps[0]!.id;
    duplicateMapCommand(session.project, first, sequentialIds("copy")).do(session);
    const second = session.activeMapId;
    hooks.session.getState().replace(session);
    for (const id of [first, second]) {
        activateMap(id);
        if (mode === "fit") fitActiveView();
        else zoomTo(1);
    }
    for (;;) {
        const ids = viewport.textureIds();
        const tilesets = ids.filter((id) => id.startsWith("ed:ts:")).length;
        if (ids.includes("ed:checker") && tilesets === 2) break;
        await wait(20);
    }
    await frame();
    return { canvas: [viewport.canvas.width, viewport.canvas.height], maps: [first, second] };
}

/**
 * Switches between the two maps `count` times, `gapMs` apart so that the background work a
 * switch starts (the chunk tier's build) has run before the next one.
 */
export async function switches(maps: [string, string], count: number, gapMs: number) {
    const viewport = probe();
    const record: SwitchRecord = { switchMs: [], drawMs: [], tiers: [], sprites: [] };
    for (let k = 0; k < count; k += 1) {
        await wait(gapMs);
        await frame();
        const frames = viewport.stats.frames;
        const started = performance.now();
        const target = window.__ngneTest!.session.getState().session.activeMapId === maps[0];
        if (!activateMap(maps[target ? 1 : 0])) throw new Error("the switch was refused");
        let submitted = await frame().then(() => performance.now());
        while (viewport.stats.frames === frames) {
            submitted = await frame().then(() => performance.now());
        }
        record.switchMs.push(submitted - started);
        record.drawMs.push(viewport.stats.lastDrawMs);
        record.tiers.push(viewport.stats.tier);
        record.sprites.push(viewport.stats.sprites);
    }
    return record;
}
