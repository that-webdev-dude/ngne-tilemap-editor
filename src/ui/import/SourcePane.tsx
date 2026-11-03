import { gridCount } from "../../core/tileset";
import type { GridOptions } from "../../core/tileset";
import type { PixelBuffer } from "../../core/codec";
import { PixelCanvas } from "./PixelCanvas";

/** The box the source is fitted into, in CSS pixels. */
const BOX = { width: 420, height: 260 };
/** Most cells the grid overlay draws. */
const MAX_CELLS = 1024;

/** The CSS scale the source is shown at: whole numbers up to 8 when it fits, otherwise less. */
export function sourceScale(width: number, height: number): number {
    const fit = Math.min(BOX.width / width, BOX.height / height);
    return fit >= 1 ? Math.min(8, Math.floor(fit)) : fit;
}

interface PixelRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** The tiles of the grid over the image, in source pixels; none when no whole tile fits. */
function cellRects(width: number, height: number, grid: GridOptions): PixelRect[] {
    const { tileWidth, tileHeight, margin, spacing } = grid;
    if (tileWidth < 1 || tileHeight < 1 || margin < 0 || spacing < 0) return [];
    const columns = gridCount(width, tileWidth, margin, spacing);
    const rows = gridCount(height, tileHeight, margin, spacing);
    const rects: PixelRect[] = [];
    for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
            if (rects.length >= MAX_CELLS) return rects;
            rects.push({
                x: margin + column * (tileWidth + spacing),
                y: margin + row * (tileHeight + spacing),
                width: tileWidth,
                height: tileHeight,
            });
        }
    }
    return rects;
}

/**
 * The source pane of Import Tileset (DESIGN §9): the source image and the tiles of the grid
 * over it, as the import cuts them (Tiled's grid, SPEC §6.1: from the margin at the left and
 * top, stepping by the tile size plus the spacing, whole tiles only). The form's fields set
 * the grid.
 */
export function SourcePane({ pixels, grid }: { pixels: PixelBuffer; grid: GridOptions | null }) {
    const { width, height } = pixels;
    const scale = sourceScale(width, height);
    const shown = { width: width * scale, height: height * scale };

    return (
        <div className="import-source" data-import-source-pane="">
            <div className="import-source__frame" style={shown}>
                <PixelCanvas
                    pixels={pixels}
                    className="import-source__image"
                    style={shown}
                    data-import-source=""
                />
                <svg
                    className="import-source__overlay"
                    viewBox={`0 0 ${width} ${height}`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                    data-import-overlay=""
                >
                    {grid
                        ? cellRects(width, height, grid).map((rect) => (
                              <rect
                                  key={`${rect.x},${rect.y}`}
                                  className="import-source__cell"
                                  x={rect.x}
                                  y={rect.y}
                                  width={rect.width}
                                  height={rect.height}
                                  data-import-cell={`${rect.x},${rect.y},${rect.width},${rect.height}`}
                              />
                          ))
                        : null}
                </svg>
            </div>
        </div>
    );
}
