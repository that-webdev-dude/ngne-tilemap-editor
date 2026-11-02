import type { ProjectMap } from "../../core/model";
import type { DeviceSize } from "../../engine/viewport/geometry";
import type { Point, ViewMapping } from "../view/coordinates";

// The overlay of the viewport (ENGINE §4, TE-014): a Canvas2D element stacked over the NGNE
// canvas that draws editor chrome. What it draws comes from draw layers; this file holds the
// types a feature needs to add one (see `overlayLayers.ts` for how a layer is registered).

/** The colours the overlay takes from the theme (DESIGN §1, §4), as 0xRRGGBB. */
export interface OverlayTheme {
    /** The grid lines: white in the dark theme, black in the light one (DESIGN §4). */
    ink: number;
    /** `--accent`: the outline of a stamp preview (DESIGN §4). */
    accent: number;
    /** `--danger`: the outline of an erase preview (DESIGN §4). */
    danger: number;
}

/** The dark theme's colours (`tokens.css`), until the interface reports the theme in use. */
export const DEFAULT_OVERLAY_THEME: Readonly<OverlayTheme> = {
    ink: 0xffffff,
    accent: 0x83e8e1,
    danger: 0xff6b6b,
};

/** The pointer over the viewport, as a draw layer sees it. */
export interface OverlayCursor {
    /** Client position, CSS pixels, as the pointer event reported it. */
    client: Point;
    /** Position in the overlay canvas's pixels, with its fraction. */
    device: Point;
    /** The map position under it, with its fraction. */
    map: Point;
    /** The cell under it: whole numbers, also outside the map. */
    cell: Point;
}

/** Everything a draw layer draws from, made for one redraw and not kept. */
export interface OverlayFrame {
    /**
     * The overlay's context. Each layer draws between a `save()` and a `restore()`, so state
     * it sets does not reach the next layer. Coordinates are device pixels of the canvas.
     */
    readonly context: CanvasRenderingContext2D;
    /** The canvas backing size: the viewport element's size in device pixels. */
    readonly size: Readonly<DeviceSize>;
    /** The active map, as the project holds it. */
    readonly map: ProjectMap;
    /** Its mapping as the image is on screen now (`currentViewMapping`, read at this redraw). */
    readonly mapping: ViewMapping;
    /** The pointer over the viewport; null when it is not over it. */
    readonly cursor: Readonly<OverlayCursor> | null;
    readonly theme: Readonly<OverlayTheme>;
}

/**
 * One draw layer of the overlay. The overlay clears its canvas and calls every layer in
 * ascending `order` at each redraw. A redraw happens only when the view or the cursor changed
 * or a layer asked for one (`watch`), at most once per animation frame.
 */
export interface OverlayLayer {
    /** Stable and unique: "tile-grid". */
    id: string;
    /**
     * Position in the stack, ascending: drawn bottom to top. TE-014 uses 300 (the cell grid);
     * chrome that belongs over the grid takes higher values.
     */
    order: number;
    /** Draws the layer. Called only while a map is open and the viewport is on the page. */
    draw(frame: OverlayFrame): void;
    /**
     * Follows what the layer draws from, other than the view and the cursor: calls `redraw`
     * whenever that changed (a setting, a selection, the phase of an animation). Called when
     * the overlay is mounted; returns the function that stops following.
     */
    watch?(redraw: () => void): () => void;
}

/** What a `*.overlay.ts` module exports. */
export interface OverlayLayerModule {
    overlayLayers?: readonly OverlayLayer[];
}
