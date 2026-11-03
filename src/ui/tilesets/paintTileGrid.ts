import {
    TILE_GAP,
    gridPointAt,
    shownTile,
    tileIndex,
    tileMarks,
    tileOrigin,
} from "../../app/tilesets/panel/tileGrid";
import type { GridLayout, GridRect } from "../../app/tilesets/panel/tileGrid";
import type { Tileset } from "../../core/model";

// Canvas2D painting of the Tilesets panel's grid (DESIGN §4, §8.5; ENGINE §1: secondary views
// are Canvas2D). The canvas covers the part of the grid in view, so its size follows the panel,
// not the tileset; it is painted whole on every change. In CSS pixels of the grid:
//
//   gaps       the grid's area in `--border`; hidden tiles and positions past the last tile are
//              left clear (the panel's background)
//   tile       the checkerboard, then the tile's pixels scaled by the zoom, unsmoothed
//   marks      properties or class: a 4 px corner triangle at the top right in `--text-muted`;
//              animated: a `▶` at the bottom left; collision: an outline square at the bottom
//              right, both in `--text` on a 9 px `--bg-panel` chip at 80%
//   selection  a 2 px `--accent` outline round the selection's rectangle, over its gaps

/** The colours the grid is painted with, as CSS colours. */
export interface GridColours {
    border: string;
    accent: string;
    text: string;
    textMuted: string;
    panel: string;
    checkA: string;
    checkB: string;
}

/** The part of the grid in view: its left and top in grid pixels, its size in CSS pixels. */
export interface GridView {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface PaintInput {
    tileset: Tileset;
    layout: GridLayout;
    filter: string;
    selection: GridRect | null;
    view: GridView;
    colours: GridColours;
    /** Side of a checkerboard square in tile pixels (the viewport's preference). */
    checkerSize: number;
    /** Device pixels per CSS pixel. */
    dpr: number;
    zoom: number;
}

/** Side of the corner triangle, the glyph chip, and the glyphs, in CSS pixels. */
export const MARK_TRIANGLE = 4;
export const MARK_CHIP = 9;

type TileImage = HTMLCanvasElement;

/** Tile pictures by tileset pixels, then by tile index: made once per tile when first shown. */
const pictures = new WeakMap<Tileset["pixels"], Map<number, TileImage>>();

/** The picture of the tile at display index `index`: its pixels on a canvas of its size. */
function tilePicture(tileset: Tileset, index: number): TileImage {
    let byIndex = pictures.get(tileset.pixels);
    if (!byIndex) {
        byIndex = new Map();
        pictures.set(tileset.pixels, byIndex);
    }
    const cached = byIndex.get(index);
    if (cached) return cached;
    const { tileWidth: width, tileHeight: height, columns, pixels } = tileset;
    const left = (index % columns) * width;
    const top = Math.floor(index / columns) * height;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        const from = ((top + y) * pixels.width + left) * 4;
        data.set(pixels.data.subarray(from, from + width * 4), y * width * 4);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.putImageData(new ImageData(data, width, height), 0, 0);
    byIndex.set(index, canvas);
    return canvas;
}

function paintChecker(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    square: number,
    colours: GridColours,
): void {
    context.fillStyle = colours.checkA;
    context.fillRect(x, y, width, height);
    context.fillStyle = colours.checkB;
    for (let row = 0; row * square < height; row++) {
        for (let column = row % 2 === 0 ? 1 : 0; column * square < width; column += 2) {
            const left = column * square;
            const top = row * square;
            context.fillRect(
                x + left,
                y + top,
                Math.min(square, width - left),
                Math.min(square, height - top),
            );
        }
    }
}

function paintMarks(
    context: CanvasRenderingContext2D,
    marks: ReturnType<typeof tileMarks>,
    x: number,
    y: number,
    width: number,
    height: number,
    colours: GridColours,
): void {
    if (marks.data) {
        context.fillStyle = colours.textMuted;
        context.beginPath();
        context.moveTo(x + width - MARK_TRIANGLE, y);
        context.lineTo(x + width, y);
        context.lineTo(x + width, y + MARK_TRIANGLE);
        context.closePath();
        context.fill();
    }
    const chip = (left: number) => {
        context.globalAlpha = 0.8;
        context.fillStyle = colours.panel;
        context.fillRect(left, y + height - MARK_CHIP - 1, MARK_CHIP, MARK_CHIP);
        context.globalAlpha = 1;
        context.fillStyle = colours.text;
    };
    if (marks.animated) {
        const left = x + 1;
        const top = y + height - MARK_CHIP - 1;
        chip(left);
        context.beginPath();
        context.moveTo(left + 2, top + 2);
        context.lineTo(left + 7, top + 4.5);
        context.lineTo(left + 2, top + 7);
        context.closePath();
        context.fill();
    }
    if (marks.collision) {
        const left = x + width - MARK_CHIP - 1;
        const top = y + height - MARK_CHIP - 1;
        chip(left);
        // An outline square of 5 px with 1 px sides, from rectangles so its edges stay sharp.
        context.fillRect(left + 2, top + 2, 5, 1);
        context.fillRect(left + 2, top + 6, 5, 1);
        context.fillRect(left + 2, top + 3, 1, 3);
        context.fillRect(left + 6, top + 3, 1, 3);
    }
}

/** Paints the part of the grid in `input.view` on `canvas`, sizing its backing store. */
export function paintTileGrid(canvas: HTMLCanvasElement, input: PaintInput): void {
    const { tileset, layout, filter, selection, view, colours, dpr, zoom } = input;
    const deviceWidth = Math.max(1, Math.round(view.width * dpr));
    const deviceHeight = Math.max(1, Math.round(view.height * dpr));
    if (canvas.width !== deviceWidth) canvas.width = deviceWidth;
    if (canvas.height !== deviceHeight) canvas.height = deviceHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, deviceWidth, deviceHeight);
    context.setTransform(dpr, 0, 0, dpr, -view.x * dpr, -view.y * dpr);
    context.imageSmoothingEnabled = false;

    const first = gridPointAt(layout, view.x, view.y, true);
    const last = gridPointAt(layout, view.x + view.width, view.y + view.height, true);
    if (!first || !last) return;

    context.fillStyle = colours.border;
    context.fillRect(0, 0, layout.width, layout.height);
    const square = Math.max(1, input.checkerSize * zoom);
    for (let row = first.row; row <= last.row; row++) {
        for (let column = first.column; column <= last.column; column++) {
            const point = { column, row };
            const { x, y } = tileOrigin(layout, point);
            const tile = shownTile(tileset, layout, point, filter);
            if (!tile) {
                context.clearRect(x, y, layout.tileWidth, layout.tileHeight);
                continue;
            }
            paintChecker(context, x, y, layout.tileWidth, layout.tileHeight, square, colours);
            const picture = tilePicture(tileset, tileIndex(layout, point));
            context.drawImage(picture, x, y, layout.tileWidth, layout.tileHeight);
            paintMarks(
                context,
                tileMarks(tile),
                x,
                y,
                layout.tileWidth,
                layout.tileHeight,
                colours,
            );
        }
    }

    if (selection) {
        const { x, y } = tileOrigin(layout, selection);
        const left = x - TILE_GAP;
        const top = y - TILE_GAP;
        const width = selection.columns * layout.pitchX + TILE_GAP;
        const height = selection.rows * layout.pitchY + TILE_GAP;
        const line = 2;
        context.fillStyle = colours.accent;
        context.fillRect(left, top, width, line);
        context.fillRect(left, top + height - line, width, line);
        context.fillRect(left, top + line, line, height - 2 * line);
        context.fillRect(left + width - line, top + line, line, height - 2 * line);
    }
}
