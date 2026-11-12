import type { FrameScheduler } from "@ngne/core";
import { compositeMap } from "../../../src/core/compositor";
import { drawnOpacity, effectiveValues, walkLayers } from "../../../src/core/model";
import type { Project } from "../../../src/core/model";
import { deserialize } from "../../../src/core/project";
import type * as Runtime from "../../../src/core/runtime/runtime";
import { validateAtlas } from "../../../src/core/sprite/export/validateAtlas";
import { decodePng } from "../../../src/core/sprite/png";
import { readCanvas } from "../../../src/engine/testing/readCanvas";
import { createTilemapGame } from "../../fixtures/game/game";
import type { TilemapGame } from "../../fixtures/game/game";
import { compareImages, roundTripDifferences } from "../../support/conformance";
import type { ImageComparison, Rgba } from "../../support/conformance";

// TE-063 game page: the last step of the golden path. The spec hands it the project file the
// editor saved (`load`) and the folder the editor exported, written into the checkout (`open`);
// the page imports that folder's `ngne-tilemap.ts` from the dev server, as a game does. Then,
// as TE-055's conformance page (te-055-game.ts) does for its fixtures:
// - `checkFiles`: every atlas passes `validateAtlas`, every tilemap the exported
//   `validateTilemap`, and the exported `readTilemap` gives back the saved project's maps.
// - `compare`: the fixture game (tests/fixtures/game) draws one frame of a map; the canvas is
//   compared with the `core/compositor` reference of the saved project for the same view.

/** Clear colour of the game; no texel of the golden path's tilesets has it. */
const CLEAR = 0x3b2b5e;
const OPAQUE = 255;

export interface MapInfo {
    name: string;
    /** In map pixels. */
    width: number;
    height: number;
}

export interface View {
    map: string;
    scale: number;
    camera: { x: number; y: number };
    width: number;
    height: number;
}

export interface FilesReport {
    atlases: number;
    tilemaps: number;
    problems: string[];
}

export interface DrawReport extends ImageComparison {
    pixelSnap: boolean | null;
    reports: string[];
    /** Pixels whose expected colour is not the clear colour. */
    drawn: number;
}

declare global {
    interface Window {
        __te063?: {
            load(base64: string): Promise<MapInfo[]>;
            open(folder: string): Promise<void>;
            checkFiles(): Promise<FilesReport>;
            compare(view: View): Promise<DrawReport>;
        };
    }
}

let project: Project | null = null;
let runtime: typeof Runtime | null = null;
let folderUrl = "";
let running: {
    game: TilemapGame;
    scheduler: ManualScheduler;
    key: string;
    diagnostics: string[];
    last: () => ImageData | null;
} | null = null;

function need<T>(value: T | null, what: string): T {
    if (value === null) throw new Error(`te-063: ${what} first.`);
    return value;
}

function describeError(error: unknown): string {
    if (error instanceof AggregateError)
        return [error.message, ...error.errors.map(describeError)].join("; ");
    if (error instanceof Error) return error.stack ?? error.message;
    return typeof error === "object" ? JSON.stringify(error) : String(error);
}

/** A scheduler in the place of `requestAnimationFrame`: the page runs each frame. */
class ManualScheduler implements FrameScheduler {
    private pending: FrameRequestCallback | undefined;
    private id = 0;

    request(callback: FrameRequestCallback): number {
        this.pending = callback;
        return ++this.id;
    }

    cancel(id: number): void {
        if (id === this.id) this.pending = undefined;
    }

    run(): void {
        const callback = this.pending;
        if (!callback) throw new Error("The game has asked for no frame.");
        this.pending = undefined;
        callback(1000);
    }
}

async function load(base64: string): Promise<MapInfo[]> {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const loaded = await deserialize(bytes);
    project = loaded;
    return loaded.maps.map((map) => ({
        name: map.exportName,
        width: map.width * map.tileWidth,
        height: map.height * map.tileHeight,
    }));
}

async function open(folder: string): Promise<void> {
    folderUrl = folder.endsWith("/") ? folder : `${folder}/`;
    runtime = (await import(/* @vite-ignore */ `${folderUrl}ngne-tilemap.ts`)) as typeof Runtime;
}

async function fetchOk(name: string): Promise<Response> {
    const response = await fetch(`${folderUrl}${name}`);
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return response;
}

async function checkFiles(): Promise<FilesReport> {
    const exported = need(runtime, "open");
    const source = need(project, "load");
    const report: FilesReport = { atlases: 0, tilemaps: 0, problems: [] };
    const atlases: Record<string, unknown> = {};
    for (const tileset of source.tilesets) {
        const name = tileset.exportName;
        try {
            const json = (await (await fetchOk(`${name}.atlas.json`)).json()) as unknown;
            const png = await (await fetchOk(`${name}.png`)).arrayBuffer();
            validateAtlas(json, await decodePng(new Uint8Array(png)));
            atlases[name] = json;
            report.atlases += 1;
        } catch (error) {
            report.problems.push(`${name}.atlas.json: ${describeError(error)}`);
        }
    }
    for (const map of source.maps) {
        const name = `${map.exportName}.tilemap.json`;
        try {
            const json = (await (await fetchOk(name)).json()) as unknown;
            exported.validateTilemap(json, atlases);
            const tilemap = exported.readTilemap(json, atlases);
            for (const difference of roundTripDifferences(source, map, tilemap))
                report.problems.push(`${name}: ${difference}`);
            report.tilemaps += 1;
        } catch (error) {
            report.problems.push(`${name}: ${describeError(error)}`);
        }
    }
    return report;
}

/** The game drawing `view.map` on a canvas of the view's size, started when needed. */
async function gameFor(view: View): Promise<NonNullable<typeof running>> {
    const key = `${view.map} ${view.width}×${view.height}`;
    if (running?.key === key) return running;
    if (running) await running.game.app.dispose();
    running = null;
    const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
    if (!canvas) throw new Error("te-063: no canvas");
    const scheduler = new ManualScheduler();
    const diagnostics: string[] = [];
    let last: ImageData | null = null;
    const game = createTilemapGame({
        canvas,
        width: view.width,
        height: view.height,
        clear: CLEAR,
        runtime: need(runtime, "open"),
        map: view.map,
        scheduler,
        diagnostic(error) {
            const overload =
                typeof error === "object" &&
                error !== null &&
                (error as { type?: unknown }).type === "overload";
            if (!overload) diagnostics.push(describeError(error));
        },
        afterFrame() {
            last = readCanvas(canvas);
        },
    });
    await game.start();
    running = { game, scheduler, key, diagnostics, last: () => last };
    return running;
}

/**
 * The `core/compositor` reference of a view at an integer scale over the clear colour, and the
 * allowance per pixel where layers blend into it: TE-055's (te-055-game.ts, `reference`), one
 * per translucent layer drawn there and one more where texel and layer are both partial.
 */
function reference(view: View): { expected: Rgba; tolerant: Uint8Array; drawn: number } {
    const source = need(project, "load");
    const map = source.maps.find((each) => each.exportName === view.map);
    if (!map) throw new Error(`te-063: no map ${view.map}`);
    const { scale, camera, width, height } = view;
    const ratio = { texels: scale, pixels: 1 };
    const request = {
        x: camera.x,
        y: camera.y,
        width,
        height,
        scaleX: ratio,
        scaleY: ratio,
        viewCentre: { x: (camera.x + width / 2) / scale, y: (camera.y + height / 2) / scale },
    };
    const cleared = { ...map, backgroundColor: ((CLEAR << 8) | OPAQUE) >>> 0 };
    const expected = compositeMap(source, cleared, { ...request, background: true });
    const tolerant = new Uint8Array(width * height);
    for (const { layer, ancestors } of walkLayers(map.layers)) {
        if (layer.type !== "tile" && layer.type !== "image") continue;
        const values = effectiveValues(layer, ancestors);
        if (!values.visible) continue;
        const opacity = drawnOpacity(layer, ancestors, values);
        const alone = compositeMap(source, map, {
            ...request,
            layerIds: new Set([layer.id]),
            background: false,
        });
        for (let i = 0; i < tolerant.length; i += 1) {
            const alpha = alone.data[i * 4 + 3]!;
            if (alpha === 0 || alpha === OPAQUE) continue;
            const both = opacity < OPAQUE && alpha < opacity - 1;
            tolerant[i] = tolerant[i]! + (both ? 2 : 1);
        }
    }
    let drawn = 0;
    const [r, g, b] = [(CLEAR >> 16) & 255, (CLEAR >> 8) & 255, CLEAR & 255];
    for (let i = 0; i < width * height; i += 1) {
        const o = i * 4;
        if (expected.data[o] !== r || expected.data[o + 1] !== g || expected.data[o + 2] !== b)
            drawn += 1;
    }
    return { expected, tolerant, drawn };
}

async function compare(view: View): Promise<DrawReport> {
    const current = await gameFor(view);
    const { stage } = current.game;
    current.game.moveCamera(view.camera.x, view.camera.y);
    stage.scale = view.scale;
    stage.layers = null;
    const before = current.last();
    current.scheduler.run();
    const image = current.last();
    if (!image || image === before)
        throw new Error(`te-063: the game drew no frame: ${current.diagnostics.join(" | ")}`);
    const { expected, tolerant, drawn } = reference(view);
    return {
        ...compareImages(image, expected, tolerant),
        pixelSnap: stage.pixelSnap,
        reports: [...stage.reports, ...current.diagnostics],
        drawn,
    };
}

const status = document.querySelector("#status");
window.__te063 = { load, open, checkFiles, compare };
if (status) status.textContent = "ready";
