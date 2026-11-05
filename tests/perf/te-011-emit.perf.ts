import { performance } from "node:perf_hooks";
import { describe, it } from "vitest";
import { cellValue } from "../../src/core/cells";
import type { Orientation } from "../../src/core/cells";
import { FlatCells, QuadEmitter } from "../../src/core/runtime/emit";
import type { EmitTileset, SpriteLike } from "../../src/core/runtime/emit";
import { record } from "./record";

// TE-011: quad emission for 65,536 visible cells (the live tier's budget, ENGINE §4), in slot
// values and in GIDs, through a sink that does nothing. Report-only: the number that counts is
// taken on reference hardware (RULES 8).

const SIDE = 256;
const GRID = 16;
const RUNS = 100;
const WARMUP = 20;

function tileset(key: number, texture: string): EmitTileset {
    const tiles = 64;
    const uv = new Float32Array(tiles * 4);
    for (let i = 0; i < tiles; i += 1)
        uv.set([(i % 8) / 8, Math.floor(i / 8) / 8, 1 / 8, 1 / 8], i * 4);
    return {
        texture,
        tileWidth: GRID,
        tileHeight: GRID,
        offsetX: 0,
        offsetY: 0,
        key,
        ids: Array.from({ length: tiles }, (_, i) => i),
        uv,
        span: tiles,
    };
}

/** A full layer of two tilesets with 12.5% of cells flipped or rotated (the reference map). */
function layer(mode: "slot" | "gid"): { cells: FlatCells; tilesets: EmitTileset[] } {
    const tilesets = [tileset(1, "a"), tileset(mode === "slot" ? 2 : 65, "b")];
    const data = new Uint32Array(SIDE * SIDE);
    let seed = 12345;
    for (let i = 0; i < data.length; i += 1) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const set = (seed >>> 8) & 1;
        const tile = (seed >>> 9) & 63;
        const orientation = (seed >>> 16) % 8 === 0 ? 1 + ((seed >>> 20) % 7) : 0;
        data[i] =
            mode === "slot"
                ? cellValue(set + 1, tile, orientation as Orientation)
                : ((orientation << 29) | (set === 0 ? 1 + tile : 65 + tile)) >>> 0;
    }
    return { cells: new FlatCells(data, SIDE, SIDE), tilesets };
}

function measure(mode: "slot" | "gid"): { median: number; p95: number; quads: number } {
    const { cells, tilesets } = layer(mode);
    const emitter = new QuadEmitter(mode, tilesets);
    let quads = 0;
    const sink = {
        sprite(s: SpriteLike) {
            quads += s.width === 0 ? 0 : 1;
        },
    };
    const options = {
        width: SIDE,
        height: SIDE,
        gridWidth: GRID,
        gridHeight: GRID,
        viewX: 0,
        viewY: 0,
        viewWidth: SIDE * GRID,
        viewHeight: SIDE * GRID,
        translateX: 0,
        translateY: 0,
        scale: 1,
        alpha: 1,
        color: 0xffffffff,
        layer: 0,
        depth: 0,
    };
    const samples: number[] = [];
    for (let run = 0; run < WARMUP + RUNS; run += 1) {
        quads = 0;
        const start = performance.now();
        emitter.emitLayer(sink, cells, options);
        const elapsed = performance.now() - start;
        if (run >= WARMUP) samples.push(elapsed);
    }
    samples.sort((a, b) => a - b);
    return {
        median: samples[Math.floor(samples.length / 2)]!,
        p95: samples[Math.floor(samples.length * 0.95)]!,
        quads,
    };
}

describe("te-011 emit", () => {
    for (const mode of ["slot", "gid"] as const) {
        it(`emits 65,536 cells in ${mode} values`, () => {
            const { median, p95, quads } = measure(mode);
            record({
                id: `te-011-emit-${mode}`,
                ticket: "TE-011",
                measurement: `emitLayer of a full 256 × 256 layer, two tilesets, ${mode} values, null sink`,
                statistic: `median of ${RUNS} runs after ${WARMUP} warm-up runs`,
                resultMs: median,
                details: { p95Ms: p95, quads, runs: RUNS },
            });
        });
    }
});
