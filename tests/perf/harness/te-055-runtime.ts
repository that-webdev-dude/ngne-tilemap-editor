import { exportFiles } from "../../../src/core/export";
import type * as Runtime from "../../../src/core/runtime/runtime";
import { createTilemapGame } from "../../fixtures/game/game";
import { REFERENCE, createReferenceProject } from "../../support/referenceProject";

// TE-055 benchmark page module (tests/perf/te-055-runtime.perf.ts): the game runtime budget of
// ENGINE §6. The reference project (ENGINE §6's reference map, 8 full layers, 2 tilesets, one
// parallax layer) with animated tiles is exported as the editor exports it; the benchmark writes
// the files into a folder of the checkout, and the fixture game (tests/fixtures/game) imports
// that folder's `ngne-tilemap.ts` and runs on `requestAnimationFrame`: the map scene with
// `pixelSnap` on, tile animations playing and the camera panning, and a HUD scene stacked above
// it. Every frame's `game.stats.renderMs` is kept.

/** Tiles of each tileset that are animated, from ID 0: two frames each. */
export const ANIMATED_TILES = 32;
/** Sprites of the HUD scene. */
export const HUD_SPRITES = 200;
/** Pan of the camera, world units per second. */
const PAN = { x: 48, y: 27 };

export interface FileData {
    name: string;
    base64: string;
}

export interface RuntimeConfig {
    /** Logical size of the game. */
    width: number;
    height: number;
    /** CSS pixels per game pixel: the canvas is shown this much larger. */
    cssScale: number;
    warmupMs: number;
    measureMs: number;
}

export interface RuntimeRecord {
    renderMs: number[];
    frameMs: number[];
    sprites: number;
    drawCalls: number;
    pixelSnap: boolean | null;
    reports: string[];
    canvas: [number, number];
}

function base64(bytes: Uint8Array): string {
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
        text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(text);
}

/** The export of the reference project with `ANIMATED_TILES` animated tiles per tileset. */
export function exportReference(): FileData[] {
    const project = createReferenceProject();
    for (const tileset of project.tilesets) {
        for (let id = 0; id < ANIMATED_TILES; id += 1) {
            tileset.tiles[id]!.animation = [
                { tile: id, ms: 150 },
                { tile: (id + 1) % REFERENCE.tilesPerTileset, ms: 150 },
            ];
        }
    }
    return exportFiles(project).map((file) => ({ name: file.name, base64: base64(file.bytes) }));
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs the game on the export in `folder` and keeps the stats of every measured frame. */
export async function run(folder: string, config: RuntimeConfig): Promise<RuntimeRecord> {
    const runtime = (await import(/* @vite-ignore */ `${folder}ngne-tilemap.ts`)) as typeof Runtime;
    const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
    if (!canvas) throw new Error("te-055: no canvas");
    canvas.style.width = `${config.width * config.cssScale}px`;
    canvas.style.height = `${config.height * config.cssScale}px`;
    const diagnostics: string[] = [];
    const record: RuntimeRecord = {
        renderMs: [],
        frameMs: [],
        sprites: 0,
        drawCalls: 0,
        pixelSnap: null,
        reports: [],
        canvas: [0, 0],
    };
    let measuring = false;
    const game = createTilemapGame({
        canvas,
        width: config.width,
        height: config.height,
        clear: 0x000000,
        runtime,
        map: "reference",
        hud: HUD_SPRITES,
        diagnostic(error) {
            const overload =
                typeof error === "object" &&
                error !== null &&
                (error as { type?: unknown }).type === "overload";
            if (!overload) diagnostics.push(String(error));
        },
        afterFrame(stats) {
            if (!measuring) return;
            record.renderMs.push(stats.renderMs);
            record.frameMs.push(stats.frameMs);
            record.sprites = Math.max(record.sprites, stats.sprites);
            record.drawCalls = Math.max(record.drawCalls, stats.drawCalls);
        },
    });
    await game.start();
    // Start well inside the map, so the pan stays in it.
    game.moveCamera(1024, 1024);
    game.stage.animate = true;
    game.stage.pan = PAN;
    await wait(config.warmupMs);
    measuring = true;
    await wait(config.measureMs);
    measuring = false;
    record.pixelSnap = game.stage.pixelSnap;
    record.reports = [...game.stage.reports, ...diagnostics];
    record.canvas = [canvas.width, canvas.height];
    await game.app.dispose();
    return record;
}
