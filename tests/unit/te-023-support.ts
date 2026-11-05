import { readFileSync } from "node:fs";
import { packNgsprite } from "../support/ngsprite";
import { celKey, createDocument } from "../../src/core/sprite/model";
import type { PixelBuffer, SpriteDoc, Tag } from "../../src/core/sprite/model";
import type { Tileset } from "../../src/core/model";

// Shared by the TE-023 tests: sprites made in memory from cells of one colour each, the
// fixture pair of `tests/fixtures/sprite/`, and the pixels of a tile of an imported tileset.

/** RGBA of one colour. */
export type Color = [number, number, number, number];

/** A colour told apart by `n`. */
export const color = (n: number): Color => [n * 16, 255 - n * 16, n, 255];

/**
 * A sprite of one pixel layer, `columns × rows` cells of `cellWidth × cellHeight` with no
 * margin, its grid set to the cells. `frames[f][cell]` is the colour number of that cell of
 * frame `f`, cells row by row. Frame IDs are `frame-0`, `frame-1`, …; durations 10, 20, ….
 */
export function cellSprite(
    cellWidth: number,
    cellHeight: number,
    columns: number,
    frames: number[][],
): SpriteDoc {
    const rows = Math.ceil(frames[0]!.length / columns);
    const width = cellWidth * columns;
    const height = cellHeight * rows;
    const ids = ["sprite", "layer", "frame-0"];
    const { doc } = createDocument(
        { name: "cells", width, height, grid: { width: cellWidth, height: cellHeight } },
        () => ids.shift()!,
    );
    doc.frames = frames.map((_, f) => ({ id: `frame-${f}`, durationMs: (f + 1) * 10 }));
    frames.forEach((cells, f) => {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const cell = Math.floor(y / cellHeight) * columns + Math.floor(x / cellWidth);
                data.set(color(cells[cell]!), (y * width + x) * 4);
            }
        }
        doc.images.set(`image-${f}`, { width, height, data });
        doc.cels.set(celKey("layer", `frame-${f}`), { imageId: `image-${f}`, opacity: 255 });
    });
    return doc;
}

/** A tag over frames `from..to` of a `cellSprite`. */
export function tag(
    name: string,
    from: number,
    to: number,
    direction: Tag["direction"] = "forward",
    repeat = 0,
): Tag {
    return {
        id: `tag-${name}`,
        name,
        color: 0xff0000ff,
        fromFrameId: `frame-${from}`,
        toFrameId: `frame-${to}`,
        direction,
        repeat,
    };
}

/** The pixels of tile `k` of `tileset`, rows top to bottom. */
export function tilePixels(tileset: Tileset, k: number): Uint8ClampedArray {
    const { tileWidth, tileHeight, columns, pixels } = tileset;
    const x = (k % columns) * tileWidth;
    const y = Math.floor(k / columns) * tileHeight;
    const out = new Uint8ClampedArray(tileWidth * tileHeight * 4);
    for (let dy = 0; dy < tileHeight; dy++) {
        const from = ((y + dy) * pixels.width + x) * 4;
        out.set(pixels.data.subarray(from, from + tileWidth * 4), dy * tileWidth * 4);
    }
    return out;
}

/** The pixels of the `width × height` area at `(x, y)` of `image`. */
export function area(
    image: PixelBuffer,
    x: number,
    y: number,
    width: number,
    height: number,
): Uint8ClampedArray {
    const out = new Uint8ClampedArray(width * height * 4);
    for (let dy = 0; dy < height; dy++) {
        const from = ((y + dy) * image.width + x) * 4;
        out.set(image.data.subarray(from, from + width * 4), dy * width * 4);
    }
    return out;
}

const FIXTURES = new URL("../fixtures/sprite/", import.meta.url);

/**
 * The fixture pair: `tiles.ngsprite` and the atlas the sprite editor at `ea5c91d` exported from
 * it (frames all, no trim). The atlas JSON keeps the exported bytes under a `.golden` ending,
 * as the sprite editor's own export goldens do, so that Prettier leaves it alone.
 */
export function spriteFixture(): { sprite: Uint8Array; atlasJson: unknown; atlasPng: Uint8Array } {
    const read = (name: string) => new Uint8Array(readFileSync(new URL(name, FIXTURES)));
    return {
        sprite: packNgsprite(new URL("tiles.ngsprite.d/", FIXTURES)),
        atlasJson: JSON.parse(new TextDecoder().decode(read("tiles.atlas.json.golden"))),
        atlasPng: read("tiles.png"),
    };
}
