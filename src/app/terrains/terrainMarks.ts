import { isCorner } from "../../core/terrain";

// Where the Terrains panel draws a tile's terrain marks (DESIGN §8.6): a dot in each corner and
// a bar on each edge that has a terrain, in the terrain's colour. Pure, so the painter and the
// tests share it. In CSS pixels of the grid, for a tile drawn at `(x, y)`, `width × height`,
// `m` the shorter side:
//
//   size      s = round(m / 4), at least 4, but at most (m − 5) / 2 so no two marks meet
//   corner    a dot inside the s × s box 1 px in from the tile's corner
//   edge      a bar of round(s / 2) across (below s), a quarter of the side long (at least 4,
//             leaving 2 px to the corner boxes), 1 px in from the edge's middle
//
// From a shorter side of 9 px on, no two boxes of a tile overlap, a bar's 1 px halo included;
// below that (an 8 px tile at 1×) eight marks do not fit apart.

/** A mark's box on the grid. */
export interface MarkBox {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    /** A corner's dot, or an edge's bar. */
    readonly kind: "corner" | "edge";
}

/** Side of a corner dot's box for a tile drawn `width × height`. */
export function markSize(width: number, height: number): number {
    const m = Math.min(width, height);
    return Math.max(1, Math.min(Math.max(4, Math.round(m / 4)), Math.floor((m - 5) / 2)));
}

/** The length of an edge's bar along a side of `side` pixels, for corner boxes of `s`. */
function barLength(side: number, s: number): number {
    return Math.max(1, Math.min(Math.max(4, Math.round(side / 4)), side - 2 * s - 4));
}

/** The box of the mark of `index` (0..7 clockwise from the top) on a tile at `(x, y)`. */
export function markBox(
    index: number,
    x: number,
    y: number,
    width: number,
    height: number,
): MarkBox {
    const s = markSize(width, height);
    if (isCorner(index)) {
        const left = index === 1 || index === 3 ? x + width - 1 - s : x + 1;
        const top = index === 3 || index === 5 ? y + height - 1 - s : y + 1;
        return { x: left, y: top, width: s, height: s, kind: "corner" };
    }
    const thickness = Math.max(1, Math.min(Math.round(s / 2), s - 1));
    if (index === 0 || index === 4) {
        const length = barLength(width, s);
        const left = x + Math.floor((width - length) / 2);
        const top = index === 0 ? y + 1 : y + height - 1 - thickness;
        return { x: left, y: top, width: length, height: thickness, kind: "edge" };
    }
    const length = barLength(height, s);
    const top = y + Math.floor((height - length) / 2);
    const left = index === 6 ? x + 1 : x + width - 1 - thickness;
    return { x: left, y: top, width: thickness, height: length, kind: "edge" };
}

/** The middle of a mark's box, rounded down to a pixel: where its colour is read back. */
export function markCentre(box: MarkBox): { x: number; y: number } {
    return { x: Math.floor(box.x + box.width / 2), y: Math.floor(box.y + box.height / 2) };
}
