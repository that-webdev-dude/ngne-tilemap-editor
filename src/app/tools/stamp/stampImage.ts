import type { Stamp } from "../../../core/cells";
import { compositeMap } from "../../../core/compositor";
import { createTileLayer } from "../../../core/model";
import type { PixelBuffer, Project, ProjectMap, Tileset } from "../../../core/model";

// The picture of the current stamp (SPEC §4.2): its tiles on a grid of the map's cell size, as
// `core/compositor` draws a map, on a canvas the overlay preview and the rail's stamp preview
// draw from. A tile larger than the cell is cut at the stamp's edge. Made again only when the
// stamp, the cell size or a tileset's pixels changed.

interface Made {
    readonly stamp: Stamp;
    readonly tileWidth: number;
    readonly tileHeight: number;
    /** The pixels of the project's tilesets the picture was made from, in list order. */
    readonly pixels: readonly PixelBuffer[];
    readonly canvas: HTMLCanvasElement;
}

let made: Made | null = null;

/** The stamp's tiles on a cell grid of `map`, as straight RGBA8 (pure: no DOM). */
export function stampPixels(project: Project, map: ProjectMap, stamp: Stamp): PixelBuffer {
    const layer = createTileLayer(1, "Stamp");
    for (let y = 0; y < stamp.height; y++) {
        for (let x = 0; x < stamp.width; x++) {
            const value = stamp.cells[y * stamp.width + x]!;
            if (value !== 0) layer.cells.set(x, y, value);
        }
    }
    const grid: ProjectMap = {
        ...map,
        width: stamp.width,
        height: stamp.height,
        backgroundColor: null,
        parallaxOriginX: 0,
        parallaxOriginY: 0,
        layers: [layer],
    };
    return compositeMap(project, grid, {
        x: 0,
        y: 0,
        width: stamp.width * map.tileWidth,
        height: stamp.height * map.tileHeight,
        background: false,
    });
}

function samePixels(a: readonly PixelBuffer[], tilesets: readonly Tileset[]): boolean {
    return a.length === tilesets.length && a.every((pixels, n) => pixels === tilesets[n]!.pixels);
}

/**
 * A canvas of the stamp's picture at one canvas pixel per map pixel: `stamp.width ×
 * map.tileWidth` by `stamp.height × map.tileHeight`. The same canvas comes back while nothing
 * it shows changed; do not draw on it.
 */
export function stampCanvas(project: Project, map: ProjectMap, stamp: Stamp): HTMLCanvasElement {
    const known = made;
    if (
        known &&
        known.stamp === stamp &&
        known.tileWidth === map.tileWidth &&
        known.tileHeight === map.tileHeight &&
        samePixels(known.pixels, project.tilesets)
    ) {
        return known.canvas;
    }
    const image = stampPixels(project, map, stamp);
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (context && image.width > 0 && image.height > 0) {
        context.putImageData(
            new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height),
            0,
            0,
        );
    }
    made = {
        stamp,
        tileWidth: map.tileWidth,
        tileHeight: map.tileHeight,
        pixels: project.tilesets.map((tileset) => tileset.pixels),
        canvas,
    };
    return canvas;
}
