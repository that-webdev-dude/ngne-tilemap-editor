// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { updateTilesetFromFiles } from "../../../src/app/tilesets/update/updateFromSource";
import { encodePng } from "../../../src/core/codec";
import { createProjectSession } from "../../../src/core/model";
import type { PixelBuffer, Tile, Tileset } from "../../../src/core/model";
import { createReferenceProject, REFERENCE } from "../../support/referenceProject";
import { sha256Hex } from "../../support/sha256";

// TE-028 benchmark page module (tests/perf/te-028-update.perf.ts): the reference map with its
// first tileset replaced by one of 1,024 tiles of 16 px (32 × 32, imported from a grid PNG),
// which the map's cells use. Each update gives the tileset a source whose first 64 tiles
// changed and two tiles swapped (or back to the original), so it applies at once. An update is
// timed from the call that takes the picked file (the read, the worker's match, the apply)
// to the first frame the viewport submits after the tileset's new texture is uploaded.

const TILES = 1024;
const COLUMNS = 32;
const SIZE = REFERENCE.tileWidth;
const CHANGED = 64;

function viewport() {
    const probe = window.__ngneTest?.viewport;
    if (!probe) throw new Error("te-028 update: no viewport");
    return probe;
}

/** Resolves when `condition` holds, checked between tasks; rejects after `timeoutMs`. */
function until(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
    const end = performance.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
            if (condition()) {
                channel.port1.close();
                resolve();
            } else if (performance.now() > end) {
                channel.port1.close();
                reject(new Error("te-028 update: timed out"));
            } else {
                channel.port2.postMessage(null);
            }
        };
        channel.port2.postMessage(null);
    });
}

/** Tile `k`'s pixels in variant `variant` (0: as imported; 1: changed). */
function tilePixels(k: number, variant: number): Uint8ClampedArray {
    const data = new Uint8ClampedArray(SIZE * SIZE * 4);
    const changed = variant === 1 && k < CHANGED;
    for (let i = 0; i < SIZE * SIZE; i++) {
        const x = i % SIZE;
        const y = Math.floor(i / SIZE);
        data.set(
            [
                (k * 5 + x * 8) & 0xff,
                ((k >> 3) * 9 + y * 8) & 0xff,
                changed ? 255 - (k & 0xff) : (k * 13) & 0xff,
                255,
            ],
            i * 4,
        );
    }
    return data;
}

/** The source image of `variant`: tile `k` at grid cell `k`, tiles 100 and 101 swapped in 1. */
function sourceImage(variant: number): PixelBuffer {
    const width = COLUMNS * SIZE;
    const height = (TILES / COLUMNS) * SIZE;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let cell = 0; cell < TILES; cell++) {
        const k = variant === 1 && (cell === 100 || cell === 101) ? 201 - cell : cell;
        const tile = tilePixels(k, variant);
        const left = (cell % COLUMNS) * SIZE;
        const top = Math.floor(cell / COLUMNS) * SIZE;
        for (let y = 0; y < SIZE; y++) {
            data.set(
                tile.subarray(y * SIZE * 4, (y + 1) * SIZE * 4),
                ((top + y) * width + left) * 4,
            );
        }
    }
    return { width, height, data };
}

function bigTileset(base: Tileset): Tileset {
    const pixels = sourceImage(0);
    const tiles: Tile[] = [];
    for (let k = 0; k < TILES; k++) {
        tiles.push({
            id: k,
            sourceKey: [k % COLUMNS, Math.floor(k / COLUMNS)],
            fingerprint: sha256Hex(tilePixels(k, 0)),
            class: "",
            collision: [],
            animation: [],
            properties: [],
        });
    }
    return {
        ...base,
        columns: COLUMNS,
        pixels,
        nextTileId: TILES,
        source: { kind: "image", fileName: "big.png", margin: 0, spacing: 0 },
        tiles,
        terrainSets: [],
    };
}

/** The PNG files of the two sources. */
const files: Uint8Array[] = [];
let tilesetId = "";

export interface Opened {
    canvas: [number, number];
    tiles: number;
}

/** Opens the reference map at 100% with its first tileset of 1,024 tiles. */
export async function openReference(): Promise<Opened> {
    const probe = viewport();
    const project = createReferenceProject();
    project.tilesets[0] = bigTileset(project.tilesets[0]!);
    tilesetId = project.tilesets[0].id;
    const session = createProjectSession(project);
    const side = REFERENCE.width * REFERENCE.tileWidth;
    const mapSession = session.perMap.get(session.activeMapId)!;
    Object.assign(mapSession.view, { centreX: side / 2, centreY: side / 2, zoom: 1 });
    window.__ngneTest!.session.getState().replace(session);
    files.push(encodePng(sourceImage(0)), encodePng(sourceImage(1)));
    await until(() => probe.textureIds().filter((id) => id.startsWith("ed:ts:")).length === 2);
    await until(() => probe.stats.frames > 0);
    return { canvas: [probe.canvas.width, probe.canvas.height], tiles: TILES };
}

export interface UpdateSample {
    /** Call → the history entry made. */
    appliedMs: number;
    /** Call → the first frame submitted after the new texture is uploaded. */
    shownMs: number;
    undo: string | null;
}

/** Updates the tileset from source `variant` (alternate 1 and 0) and times it. */
export async function update(variant: number): Promise<UpdateSample> {
    const probe = viewport();
    const bytes = files[variant]!;
    const picked = { name: "big.png", read: async () => bytes };
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const start = performance.now();
    const applied = await updateTilesetFromFiles(tilesetId, [picked]);
    const appliedMs = performance.now() - start;
    if (!applied) throw new Error("te-028 update: nothing was applied");
    // The apply's own frame, then the one the texture upload asks for.
    const frames = probe.stats.frames;
    await until(() => probe.stats.frames >= frames + 2);
    const shownMs = performance.now() - start;
    const { history } = window.__ngneTest!.session.getState();
    return { appliedMs, shownMs, undo: history.undoLabel };
}
