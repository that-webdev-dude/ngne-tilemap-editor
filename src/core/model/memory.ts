import { CHUNK_SIZE } from "../cells";
import type { Project } from "./types";
import { walkLayers } from "./layers";

// Memory accounting of SPEC §2.2: 4 bytes per tileset pixel and per allocated cell (a chunk
// allocates all its 32 × 32 cells). Image pixels count with the tilesets: they live in the
// same buffers. The app warns above `MEMORY_WARN_BYTES` and refuses an operation that would
// pass `MEMORY_LIMIT_BYTES`.

export const BYTES_PER_PIXEL = 4;
export const BYTES_PER_CELL = 4;
export const BYTES_PER_CHUNK = CHUNK_SIZE * CHUNK_SIZE * BYTES_PER_CELL;
/** 512 MB. */
export const MEMORY_WARN_BYTES = 512 * 1024 * 1024;
/** 1 GB. */
export const MEMORY_LIMIT_BYTES = 1024 * 1024 * 1024;

export interface MemoryAccount {
    /** Pixels of every tileset and image, 4 bytes each. */
    pixelBytes: number;
    /** Allocated cells of every tile layer of every map, 4 bytes each. */
    cellBytes: number;
    total: number;
}

/** Thrown by `assertMemoryWithin`; the project is unchanged. */
export class MemoryLimitError extends Error {
    override readonly name = "MemoryLimitError";
    readonly bytes: number;

    constructor(bytes: number) {
        super(
            `The project would need ${bytes} bytes of tileset and cell memory; ` +
                `the limit is ${MEMORY_LIMIT_BYTES}.`,
        );
        this.bytes = bytes;
    }
}

/** The bytes of a tileset's or image's pixels. */
export function pixelBytes(pixels: { width: number; height: number }): number {
    return pixels.width * pixels.height * BYTES_PER_PIXEL;
}

/** What the project holds now. */
export function accountMemory(project: Project): MemoryAccount {
    let pixels = 0;
    for (const tileset of project.tilesets) pixels += pixelBytes(tileset.pixels);
    for (const image of project.images) pixels += pixelBytes(image.pixels);
    let cells = 0;
    for (const map of project.maps) {
        for (const { layer } of walkLayers(map.layers)) {
            if (layer.type === "tile") cells += layer.cells.chunkCount * BYTES_PER_CHUNK;
        }
    }
    return { pixelBytes: pixels, cellBytes: cells, total: pixels + cells };
}

/** Whether `bytes` is past the warning threshold. */
export function memoryWarns(bytes: number): boolean {
    return bytes > MEMORY_WARN_BYTES;
}

/**
 * Throws `MemoryLimitError` when the project's memory plus `extraBytes` (what an operation
 * would add) would exceed the limit. Call it before the operation changes the project.
 */
export function assertMemoryWithin(project: Project, extraBytes = 0): void {
    const bytes = accountMemory(project).total + extraBytes;
    if (bytes > MEMORY_LIMIT_BYTES) throw new MemoryLimitError(bytes);
}
