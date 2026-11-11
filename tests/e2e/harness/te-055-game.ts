import type { FrameScheduler } from "@ngne/core";
import { compositeMap } from "../../../src/core/compositor";
import { exportFiles } from "../../../src/core/export";
import { drawnOpacity, effectiveValues, walkLayers } from "../../../src/core/model";
import type { Project, ProjectMap } from "../../../src/core/model";
import { deserialize } from "../../../src/core/project";
import type * as Runtime from "../../../src/core/runtime/runtime";
import { validateAtlas } from "../../../src/core/sprite/export/validateAtlas";
import { decodePng } from "../../../src/core/sprite/png";
import { readCanvas } from "../../../src/engine/testing/readCanvas";
import { createTilemapGame } from "../../fixtures/game/game";
import type { TilemapGame } from "../../fixtures/game/game";
import { compareImages, roundTripDifferences } from "../../support/conformance";
import type { ImageComparison, Rgba } from "../../support/conformance";
import { createConformanceProject } from "../../support/conformanceProject";
import { createExportProject } from "../../support/exportProject";
import { createReferenceProject } from "../../support/referenceProject";

// TE-055 conformance page (SPEC §10.3). `exportFixture` exports a fixture project in the browser
// as the editor does (`exportFiles`); the spec writes the files into a folder of the checkout
// and calls `open` with its URL, and the page imports that folder's `ngne-tilemap.ts` from the
// dev server, which compiles it as it does for a game that imports it. Then:
// - `checkFiles`: condition 1 (every atlas passes `validateAtlas`, every tilemap the exported
//   `validateTilemap`) and condition 2 (the exported `readTilemap` gives back the project).
// - `compare`: condition 3 at an integer scale. The fixture game (tests/fixtures/game) loads the
//   map with the exported `loadTilemap` and draws one frame; the canvas, read back in
//   `afterFrame`, is compared with the `core/compositor` reference of the same view.
// - `checkColours`: condition 3 at a fractional scale. One tile layer drawn alone; every pixel
//   has the clear colour or a colour of a tile whose quad lies under it.
//
// Animated tiles are drawn at `elapsedMs` 0, their first frame; the compositor draws the tile
// itself. Every animated tile of the fixtures starts with itself, so the two agree.

/** The fixtures, by ID. */
export const FIXTURES = ["conformance", "format-golden", "export-test", "reference"] as const;
export type FixtureId = (typeof FIXTURES)[number];

/** Clear colour of the game; no texel of the reference export project has it. */
export const CLEAR = 0x3b2b5e;

export interface MapInfo {
    name: string;
    /** In map pixels. */
    width: number;
    height: number;
    /** Indexes in the exported tilemap's `layers` of the visible tile layers. */
    tileLayers: number[];
}

export interface FileData {
    name: string;
    base64: string;
}

/** One view of a map: the camera in world units, the canvas size, the scale. */
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
    /** Reports of `drawTilemap` and the game's diagnostics. */
    reports: string[];
    /** Pixels whose expected colour is not the clear colour. */
    drawn: number;
}

export interface ColourReport {
    pixelSnap: boolean | null;
    reports: string[];
    /** Pixels not of the clear colour. */
    drawn: number;
    /** Pixels whose colour belongs to no tile under them. */
    wrong: number;
    examples: string[];
}

declare global {
    interface Window {
        __te055?: {
            exportFixture(id: FixtureId): Promise<{ files: FileData[]; maps: MapInfo[] }>;
            open(folder: string): Promise<string>;
            checkFiles(): Promise<FilesReport>;
            compare(view: View): Promise<DrawReport>;
            checkColours(view: View, layer: number): Promise<ColourReport>;
        };
    }
}

async function projectOf(id: FixtureId): Promise<Project> {
    switch (id) {
        case "conformance":
            return createConformanceProject();
        case "format-golden": {
            const response = await fetch("/tests/fixtures/format/golden-v1.ngtilemap");
            return deserialize(new Uint8Array(await response.arrayBuffer()));
        }
        case "export-test":
            return createExportProject();
        case "reference":
            return createReferenceProject();
    }
}

function base64(bytes: Uint8Array): string {
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
        text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(text);
}

/** A scheduler in the place of `requestAnimationFrame`: the page runs each frame. */
class ManualScheduler implements FrameScheduler {
    private pending: FrameRequestCallback | undefined;
    private id = 0;
    private now = 1000;

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
        callback(this.now);
    }
}

function describeError(error: unknown): string {
    if (error instanceof AggregateError) {
        return [error.message, ...error.errors.map(describeError)].join("; ");
    }
    if (error instanceof Error) return error.stack ?? error.message;
    return typeof error === "object" ? JSON.stringify(error) : String(error);
}

let project: Project | null = null;
let runtime: typeof Runtime | null = null;
let folderUrl = "";

/** The running game, its map and its canvas size. */
let running: {
    game: TilemapGame;
    scheduler: ManualScheduler;
    map: string;
    width: number;
    height: number;
    diagnostics: string[];
    last: () => ImageData | null;
} | null = null;

function need<T>(value: T | null, what: string): T {
    if (value === null) throw new Error(`te-055: ${what} first.`);
    return value;
}

function mapOf(name: string): ProjectMap {
    const map = need(project, "exportFixture").maps.find((item) => item.exportName === name);
    if (!map) throw new Error(`te-055: no map ${name}.`);
    return map;
}

async function exportFixture(id: FixtureId): Promise<{ files: FileData[]; maps: MapInfo[] }> {
    project = await projectOf(id);
    const files = exportFiles(project).map((file) => ({
        name: file.name,
        base64: base64(file.bytes),
    }));
    const maps = project.maps.map((map): MapInfo => {
        const tileLayers: number[] = [];
        let index = 0;
        for (const { layer, ancestors } of walkLayers(map.layers)) {
            if (layer.type === "group") continue;
            const visible = layer.visible && ancestors.every((group) => group.visible);
            if (layer.type === "tile" && visible) tileLayers.push(index);
            index += 1;
        }
        return {
            name: map.exportName,
            width: map.width * map.tileWidth,
            height: map.height * map.tileHeight,
            tileLayers,
        };
    });
    return { files, maps };
}

async function open(folder: string): Promise<string> {
    folderUrl = folder.endsWith("/") ? folder : `${folder}/`;
    runtime = (await import(/* @vite-ignore */ `${folderUrl}ngne-tilemap.ts`)) as typeof Runtime;
    // The tables of the export name its files beside the module.
    return Object.values(runtime.TILEMAP_URLS).join(", ");
}

async function fetchJson(name: string): Promise<unknown> {
    const response = await fetch(`${folderUrl}${name}`);
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return JSON.parse(await response.text()) as unknown;
}

async function checkFiles(): Promise<FilesReport> {
    const exported = need(runtime, "open");
    const source = need(project, "exportFixture");
    const report: FilesReport = { atlases: 0, tilemaps: 0, problems: [] };
    const atlases: Record<string, unknown> = {};
    for (const tileset of source.tilesets) {
        const name = tileset.exportName;
        try {
            const json = await fetchJson(`${name}.atlas.json`);
            const response = await fetch(`${folderUrl}${name}.png`);
            const image = await decodePng(new Uint8Array(await response.arrayBuffer()));
            validateAtlas(json, image);
            const named = (json as { image?: unknown }).image;
            if (named !== `${name}.png`) report.problems.push(`${name}: image ${String(named)}`);
            atlases[name] = json;
            report.atlases += 1;
        } catch (error) {
            report.problems.push(`${name}.atlas.json: ${describeError(error)}`);
        }
    }
    for (const map of source.maps) {
        const name = `${map.exportName}.tilemap.json`;
        try {
            const json = await fetchJson(name);
            exported.validateTilemap(json, atlases);
            const tilemap = exported.readTilemap(json, atlases);
            for (const difference of roundTripDifferences(source, map, tilemap)) {
                report.problems.push(`${name}: ${difference}`);
            }
            report.tilemaps += 1;
        } catch (error) {
            report.problems.push(`${name}: ${describeError(error)}`);
        }
    }
    return report;
}

/** The game drawing `view.map` on a canvas of the view's size, started when needed. */
async function gameFor(view: View): Promise<NonNullable<typeof running>> {
    const { map, width, height } = view;
    if (running && running.map === map && running.width === width && running.height === height) {
        return running;
    }
    if (running) await running.game.app.dispose();
    running = null;
    const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
    if (!canvas) throw new Error("te-055: no canvas");
    const scheduler = new ManualScheduler();
    const diagnostics: string[] = [];
    let last: ImageData | null = null;
    const game = createTilemapGame({
        canvas,
        width,
        height,
        clear: CLEAR,
        runtime: need(runtime, "open"),
        map,
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
    running = { game, scheduler, map, width, height, diagnostics, last: () => last };
    return running;
}

/** Draws one frame of `view`, with only the layer `layer` when given, and reads it back. */
async function draw(
    view: View,
    layer?: number,
): Promise<{ image: ImageData; game: TilemapGame; reports: string[] }> {
    const current = await gameFor(view);
    const { stage } = current.game;
    current.game.moveCamera(view.camera.x, view.camera.y);
    stage.scale = view.scale;
    stage.layers = layer === undefined ? null : (_item, index) => index === layer;
    const before = current.last();
    current.scheduler.run();
    const image = current.last();
    if (!image || image === before) {
        throw new Error(`te-055: the game drew no frame: ${current.diagnostics.join(" | ")}`);
    }
    return { image, game: current.game, reports: [...stage.reports, ...current.diagnostics] };
}

const OPAQUE = 255;

/** The `core/compositor` reference of a view at an integer scale, over the clear colour. */
function reference(view: View): { expected: Rgba; tolerant: Uint8Array; drawn: number } {
    const source = need(project, "exportFixture");
    const map = mapOf(view.map);
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
    // The game clears to CLEAR and draws no background colour: the reference starts from it.
    const cleared = { ...map, backgroundColor: ((CLEAR << 8) | OPAQUE) >>> 0 };
    const expected = compositeMap(source, cleared, { ...request, background: true });
    // An allowance per channel where layers blend into the pixel. The compositor blends as the
    // sprite editor does, in integers: it rounds a texel's alpha times the layer's opacity to an
    // integer, then truncates the blended colour; the GPU does both in floating point and rounds
    // once. So each layer drawn translucently over the pixel may differ by 1, and by 1 more when
    // both the texel's alpha and the layer's opacity are partial (two roundings). Opaque
    // pixels of opaque layers have no allowance.
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
            // Below the layer's opacity, the texel's own alpha is partial as well.
            const both = opacity < OPAQUE && alpha < opacity - 1;
            tolerant[i] = tolerant[i]! + (both ? 2 : 1);
        }
    }
    let drawn = 0;
    const r = (CLEAR >> 16) & 255;
    const g = (CLEAR >> 8) & 255;
    const b = CLEAR & 255;
    for (let i = 0; i < width * height; i += 1) {
        const o = i * 4;
        if (expected.data[o] !== r || expected.data[o + 1] !== g || expected.data[o + 2] !== b) {
            drawn += 1;
        }
    }
    return { expected, tolerant, drawn };
}

async function compare(view: View): Promise<DrawReport> {
    const { image, game, reports } = await draw(view);
    const { expected, tolerant, drawn } = reference(view);
    return {
        ...compareImages(image, expected, tolerant),
        pixelSnap: game.stage.pixelSnap,
        reports,
        drawn,
    };
}

/** RGB as one number. */
const key = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;

/**
 * Per tile of a tileset (by tile ID), the colours it can give a pixel when its layer is drawn
 * alone over the clear colour with opacity `alpha` (0..1): each texel blended over CLEAR.
 */
function tileColours(exportName: string, alpha: number): Map<number, Set<number>> {
    const tileset = need(project, "exportFixture").tilesets.find(
        (t) => t.exportName === exportName,
    );
    if (!tileset) throw new Error(`te-055: no tileset ${exportName}`);
    const { columns, tileWidth, tileHeight, pixels } = tileset;
    const clear = [(CLEAR >> 16) & 255, (CLEAR >> 8) & 255, CLEAR & 255];
    const out = new Map<number, Set<number>>();
    tileset.tiles.forEach((tile, index) => {
        const colours = new Set<number>([key(clear[0]!, clear[1]!, clear[2]!)]);
        const left = (index % columns) * tileWidth;
        const top = Math.floor(index / columns) * tileHeight;
        for (let y = 0; y < tileHeight; y += 1) {
            for (let x = 0; x < tileWidth; x += 1) {
                const o = ((top + y) * pixels.width + left + x) * 4;
                const a = (pixels.data[o + 3]! / OPAQUE) * alpha;
                const c = [0, 1, 2].map((n) =>
                    Math.round(pixels.data[o + n]! * a + clear[n]! * (1 - a)),
                );
                colours.add(key(c[0]!, c[1]!, c[2]!));
            }
        }
        out.set(tile.id, colours);
    });
    return out;
}

/** Canvas pixels a quad may cover beyond its exact place: centre rounding and edge pixels. */
const SLACK = 1.5;

async function checkColours(view: View, layerIndex: number): Promise<ColourReport> {
    const { image, game, reports } = await draw(view, layerIndex);
    const tilemap = game.tilemap();
    const layer = tilemap.layers[layerIndex];
    if (!layer || layer.type !== "tile")
        throw new Error(`te-055: layer ${layerIndex} is no tile layer`);
    const { scale, camera, width, height } = view;
    const alpha = layer.opacity / OPAQUE;
    const coloursOf = new Map(tilemap.tilesets.map((t) => [t.name, tileColours(t.name, alpha)]));

    // Every tile's colours, listed on the pixels its quad may cover.
    const candidates: (Set<number>[] | undefined)[] = new Array(width * height);
    const centreX = (camera.x + width / 2) / scale - tilemap.parallaxOriginX;
    const centreY = (camera.y + height / 2) / scale - tilemap.parallaxOriginY;
    const shiftX = layer.offsetX + centreX * (1 - layer.parallaxX);
    const shiftY = layer.offsetY + centreY * (1 - layer.parallaxY);
    for (let cy = 0; cy < tilemap.height; cy += 1) {
        for (let cx = 0; cx < tilemap.width; cx += 1) {
            const value = layer.data[cy * tilemap.width + cx]!;
            const gid = value & 0x0fffffff;
            if (gid === 0) continue;
            let tileset: (typeof tilemap.tilesets)[number] | undefined;
            for (const candidate of tilemap.tilesets)
                if (candidate.firstGid <= gid) tileset = candidate;
            if (!tileset) continue;
            const colours = coloursOf.get(tileset.name)?.get(gid - tileset.firstGid);
            if (!colours) continue;
            // FORMAT §1.3: the box as drawn has its bottom-left corner on the cell's.
            const diagonal = (value & 0x20000000) !== 0;
            const boxW = diagonal ? tileset.tileHeight : tileset.tileWidth;
            const boxH = diagonal ? tileset.tileWidth : tileset.tileHeight;
            const left = cx * tilemap.tileWidth + tileset.offsetX + shiftX;
            const bottom = (cy + 1) * tilemap.tileHeight + tileset.offsetY + shiftY;
            const x0 = Math.max(0, Math.floor(left * scale - camera.x - SLACK));
            const x1 = Math.min(width, Math.ceil((left + boxW) * scale - camera.x + SLACK));
            const y0 = Math.max(0, Math.floor((bottom - boxH) * scale - camera.y - SLACK));
            const y1 = Math.min(height, Math.ceil(bottom * scale - camera.y + SLACK));
            for (let y = y0; y < y1; y += 1) {
                for (let x = x0; x < x1; x += 1) {
                    const at = y * width + x;
                    (candidates[at] ??= []).push(colours);
                }
            }
        }
    }

    const report: ColourReport = {
        pixelSnap: game.stage.pixelSnap,
        reports,
        drawn: 0,
        wrong: 0,
        examples: [],
    };
    const clearKey = CLEAR;
    for (let i = 0; i < width * height; i += 1) {
        const o = i * 4;
        const r = image.data[o]!;
        const g = image.data[o + 1]!;
        const b = image.data[o + 2]!;
        if (key(r, g, b) === clearKey) continue;
        report.drawn += 1;
        const sets = candidates[i] ?? [];
        let found = false;
        for (let dr = -1; dr <= 1 && !found; dr += 1) {
            for (let dg = -1; dg <= 1 && !found; dg += 1) {
                for (let db = -1; db <= 1 && !found; db += 1) {
                    const [rr, gg, bb] = [r + dr, g + dg, b + db];
                    if (Math.min(rr, gg, bb) < 0 || Math.max(rr, gg, bb) > 255) continue;
                    const k = key(rr, gg, bb);
                    found = sets.some((set) => set.has(k));
                }
            }
        }
        if (found) continue;
        report.wrong += 1;
        if (report.examples.length < 12) {
            report.examples.push(
                `(${i % width}, ${Math.floor(i / width)}) [${r}, ${g}, ${b}] under ${sets.length} tiles`,
            );
        }
    }
    return report;
}

const status = document.querySelector("#status");
window.__te055 = { exportFixture, open, checkFiles, compare, checkColours };
if (status) status.textContent = "ready";
