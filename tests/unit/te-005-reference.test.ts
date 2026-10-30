import { describe, expect, it } from "vitest";
import { cellOrientation, cellSlot, cellTileId } from "../../src/core/cells";
import {
    BYTES_PER_CHUNK,
    MEMORY_LIMIT_BYTES,
    MEMORY_WARN_BYTES,
    MemoryLimitError,
    accountMemory,
    assertInvariants,
    assertMemoryWithin,
    memoryWarns,
} from "../../src/core/model";
import type { TileLayer } from "../../src/core/model";
import { REFERENCE, createReferenceProject } from "../support/referenceProject";
import { sha256Hex } from "../support/sha256";

// The reference project has the ENGINE §6 shape (BRIEF D1 worst case) and is deterministic.

describe("sha256Hex", () => {
    it("matches the FIPS 180-4 vectors", () => {
        expect(sha256Hex(new Uint8Array(0))).toBe(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        );
        expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        );
        expect(sha256Hex(new Uint8Array(1000).fill(0x61))).toBe(
            "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3",
        );
    });
});

describe("the reference project", () => {
    const project = createReferenceProject();
    const map = project.maps[0]!;
    const layers = map.layers as TileLayer[];

    it("is 256 × 256 cells of 16 px with 8 tile layers, every cell filled", () => {
        expect(project.maps).toHaveLength(1);
        expect([map.width, map.height]).toEqual([REFERENCE.width, REFERENCE.height]);
        expect([map.tileWidth, map.tileHeight]).toEqual([16, 16]);
        expect(layers).toHaveLength(8);
        for (const layer of layers) {
            expect(layer.type).toBe("tile");
            expect(layer.cells.count).toBe(REFERENCE.width * REFERENCE.height);
        }
    });

    it("has two tilesets of 256 tiles that every layer uses", () => {
        expect(project.tilesets).toHaveLength(2);
        for (const tileset of project.tilesets) {
            expect(tileset.tiles).toHaveLength(REFERENCE.tilesPerTileset);
            expect(tileset.pixels.width).toBe(REFERENCE.columns * 16);
        }
        const slots = new Set(project.tilesets.map((tileset) => tileset.slot));
        for (const layer of layers) {
            const used = new Set<number>();
            for (let y = 0; y < map.height; y += 1) {
                for (let x = 0; x < map.width; x += 1) {
                    const value = layer.cells.get(x, y);
                    used.add(cellSlot(value));
                    expect(cellTileId(value)).toBeLessThan(REFERENCE.tilesPerTileset);
                }
            }
            expect(used).toEqual(slots);
        }
    });

    it("has exactly 12.5% of cells flipped or rotated in every layer", () => {
        for (const layer of layers) {
            let oriented = 0;
            for (let y = 0; y < map.height; y += 1) {
                for (let x = 0; x < map.width; x += 1) {
                    if (cellOrientation(layer.cells.get(x, y)) !== 0) oriented += 1;
                }
            }
            expect(oriented).toBe((REFERENCE.width * REFERENCE.height) / 8);
        }
    });

    it("has one parallax layer", () => {
        const parallax = layers.filter((layer) => layer.parallaxX !== 1 || layer.parallaxY !== 1);
        expect(parallax).toHaveLength(1);
        expect(parallax[0]).toBe(layers[REFERENCE.parallaxLayer]);
    });

    it("passes assertInvariants", () => {
        expect(() => assertInvariants(project)).not.toThrow();
    });

    it("is deterministic", () => {
        const again = createReferenceProject();
        expect(again.id).toBe(project.id);
        expect(again.tilesets.map((t) => t.tiles.map((tile) => tile.fingerprint))).toEqual(
            project.tilesets.map((t) => t.tiles.map((tile) => tile.fingerprint)),
        );
        const cells = (layer: TileLayer) =>
            [...layer.cells.chunksIn({ x: 0, y: 0, width: map.width, height: map.height })]
                .sort((a, b) => a.cy - b.cy || a.cx - b.cx)
                .map((chunk) => chunk.cells);
        for (let index = 0; index < layers.length; index += 1) {
            expect(cells(again.maps[0]!.layers[index] as TileLayer)).toEqual(cells(layers[index]!));
        }
    });

    it("accounts 2 MB of cells and 512 KB of tileset pixels", () => {
        const account = accountMemory(project);
        expect(account.cellBytes).toBe(8 * 64 * BYTES_PER_CHUNK);
        expect(account.pixelBytes).toBe(2 * 256 * 256 * 4);
        expect(account.total).toBe(account.cellBytes + account.pixelBytes);
    });

    it("warns above 512 MB and refuses an operation past 1 GB, project unchanged", () => {
        const { total } = accountMemory(project);
        expect(memoryWarns(total)).toBe(false);
        expect(memoryWarns(MEMORY_WARN_BYTES)).toBe(false);
        expect(memoryWarns(MEMORY_WARN_BYTES + 1)).toBe(true);
        expect(() => assertMemoryWithin(project)).not.toThrow();
        expect(() => assertMemoryWithin(project, MEMORY_LIMIT_BYTES - total)).not.toThrow();
        let error: unknown;
        try {
            assertMemoryWithin(project, MEMORY_LIMIT_BYTES - total + 1);
        } catch (thrown) {
            error = thrown;
        }
        expect(error).toBeInstanceOf(MemoryLimitError);
        expect((error as MemoryLimitError).bytes).toBe(MEMORY_LIMIT_BYTES + 1);
        expect(accountMemory(project).total).toBe(total);
    });
});
