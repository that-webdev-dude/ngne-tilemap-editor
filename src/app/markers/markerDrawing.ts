import { effectiveValues, shapeBox, walkLayers } from "../../core/model";
import type { Marker, MarkerLayer, ProjectMap } from "../../core/model";
import { layerShift } from "../../engine/viewport/geometry";
import { cssColour } from "../overlay/draw";
import type { OverlayFrame } from "../overlay/types";

// How markers look on the overlay (DESIGN §4, SPEC §8; TE-037): outlines 1.5 CSS px in their
// layer's colour on a 1 px black halo; rectangles, ellipses and polygons filled with the colour
// at 15%; points as lucide's `MapPin` at 16 px anchored at its tip; names in 11 px `--text` on a
// `--bg-panel` chip at 80% beside the shape, above a zoom of 1. Every visible marker layer is
// drawn, bottom to top in the tree, above every tile layer: layer order and opacity do not
// matter (ENGINE §7: NGNE has no line or polygon primitives). A hidden marker layer, or one in a
// hidden group, draws nothing. Offsets and parallax move the markers as they move a tile layer
// (FORMAT §3.4, `layerShift`). The colour's alpha scales the outline, the halo and the fill.
//
// Cost (SPEC §8: 2,000 markers redraw within the pan budget). Building a canvas path of 2,000
// markers took over 15 ms, and stroking it each frame held the pan to about 35 frames a second
// (the raster runs after the frame's script). So each layer's shapes are built once, in map pixels,
// into one `Path2D` for the fills and one for the outlines (`markerPaths`, until the history takes
// a step), and painted once, with their pins and chips, into a canvas of the layer's own that
// covers the view and a quarter of it on each side (a raster). A redraw copies the raster; it is
// painted again only after a step of the history, a change of zoom, colour or theme, or when the
// view leaves it. Pins keep their size on screen: a pin is drawn once per colour and copied to each
// point. Closed shapes all wind one way, so where two of them overlap the fill shows once, at 15%.
// Chips are painted with their layer, so a later layer's shapes cover an earlier layer's chips.

/** Outline width in CSS pixels, and the halo on each side of it. */
export const OUTLINE_WIDTH = 1.5;
export const HALO_WIDTH = 1;
/** The fill of rectangles, ellipses and polygons: the colour at this alpha. */
export const FILL_ALPHA = 0.15;
/** The size the `MapPin` icon is drawn at, CSS pixels (its 24-unit box). */
export const PIN_SIZE = 16;
/** Name chips: text size, height, padding and gap to the shape, CSS pixels; chip alpha. */
export const NAME_FONT_SIZE = 11;
export const CHIP_HEIGHT = 16;
export const CHIP_PADDING = 4;
export const CHIP_GAP = 4;
export const CHIP_ALPHA = 0.8;
/** Names show above this zoom (CSS pixels per map pixel; SPEC §8). */
export const NAME_ZOOM = 1;

/** The `MapPin` icon's box, its tip in it, and the part of the box its outline covers. */
const PIN_UNITS = 24;
const PIN_TIP = { x: 12, y: 22 };
const PIN_BOX = { left: 4, top: 2, right: 20 };

/** A marker layer as it is drawn: the layer and where its markers land. */
export interface DrawnMarkerLayer {
    layer: MarkerLayer;
    /** Map pixels the layer is drawn from its markers' positions (offset and parallax). */
    shift: { x: number; y: number };
}

/** The marker layers of `map` that are drawn, bottom to top, each with its shift for `centre`. */
export function drawnMarkerLayers(
    map: ProjectMap,
    centre: { centreX: number; centreY: number },
): DrawnMarkerLayer[] {
    const out: DrawnMarkerLayer[] = [];
    for (const { layer, ancestors } of walkLayers(map.layers)) {
        if (layer.type !== "marker" || layer.markers.length === 0) continue;
        const values = effectiveValues(layer, ancestors);
        if (!values.visible) continue;
        out.push({ layer, shift: layerShift(map, centre, values) });
    }
    return out;
}

/** Whether names are drawn at `zoom` (CSS pixels per map pixel). */
export function namesShown(zoom: number): boolean {
    return zoom > NAME_ZOOM;
}

/** The calls a path is built with: a canvas context and a `Path2D` both have them. */
export type PathSink = Pick<
    CanvasPath,
    | "moveTo"
    | "lineTo"
    | "bezierCurveTo"
    | "quadraticCurveTo"
    | "arc"
    | "ellipse"
    | "rect"
    | "closePath"
>;

/**
 * Adds the outline of lucide's `MapPin` (24-unit box, `unit` pixels a unit) with its tip on
 * `(x, y)`: the head's arc, the two curves down to the tip, and the inner circle. The path data
 * is the icon's (lucide-react 1.55.0, `map-pin`).
 */
export function tracePin(path: PathSink, x: number, y: number, unit: number): void {
    const at = (u: number, v: number): [number, number] => [
        x + (u - PIN_TIP.x) * unit,
        y + (v - PIN_TIP.y) * unit,
    ];
    path.moveTo(...at(20, 10));
    path.bezierCurveTo(...at(20, 14.993), ...at(14.461, 20.193), ...at(12.601, 21.799));
    // The icon's 1-unit arc round the tip.
    path.quadraticCurveTo(...at(12, 22.317), ...at(11.399, 21.799));
    path.bezierCurveTo(...at(9.539, 20.193), ...at(4, 14.993), ...at(4, 10));
    const [cx, cy] = at(12, 10);
    path.arc(cx, cy, 8 * unit, Math.PI, 2 * Math.PI);
    path.closePath();
    path.moveTo(cx + 3 * unit, cy);
    path.arc(cx, cy, 3 * unit, 0, 2 * Math.PI);
}

/** Adds the outline of a marker other than a point, in map pixels. */
export function traceShape(path: PathSink, marker: Exclude<Marker, { shape: "point" }>): void {
    switch (marker.shape) {
        case "rectangle":
            path.rect(marker.x, marker.y, marker.width, marker.height);
            return;
        case "ellipse": {
            const rx = marker.width / 2;
            const ry = marker.height / 2;
            path.moveTo(marker.x + marker.width, marker.y + ry);
            path.ellipse(marker.x + rx, marker.y + ry, rx, ry, 0, 0, 2 * Math.PI);
            return;
        }
        case "polygon":
        case "polyline": {
            // A layer's closed shapes are filled as one path by the nonzero rule: a polygon goes
            // the way `rect` and `ellipse` go, or it would cancel the fill where it overlaps one.
            const points =
                marker.shape === "polygon" && signedArea(marker.points) < 0
                    ? [...marker.points].reverse()
                    : marker.points;
            points.forEach(([px, py], index) => {
                if (index === 0) path.moveTo(marker.x + px, marker.y + py);
                else path.lineTo(marker.x + px, marker.y + py);
            });
            if (marker.shape === "polygon") path.closePath();
            return;
        }
    }
}

/** Twice the signed area of a polygon, y down: positive the way `rect` traces (clockwise on screen). */
function signedArea(points: readonly (readonly [number, number])[]): number {
    let sum = 0;
    for (let k = 0; k < points.length; k++) {
        const [x, y] = points[k]!;
        const [nx, ny] = points[(k + 1) % points.length]!;
        sum += x * ny - nx * y;
    }
    return sum;
}

/** A name to show, with what places its chip, in map pixels before the layer's shift. */
export interface MarkerName {
    name: string;
    /** A point: the chip goes beside its pin. */
    point: boolean;
    /** The right and top of the shape's box; a point's position for a point. */
    right: number;
    top: number;
}

/** What a layer's markers are drawn from, in map pixels, built once per history step. */
export interface MarkerPaths {
    /** Rectangles, ellipses and polygons. */
    fill: Path2D;
    /** Every marker but the points. */
    outline: Path2D;
    /** The points, as `x, y` pairs. */
    points: Float64Array;
    /** The named markers. */
    names: MarkerName[];
    /** The bounds of the shapes, for leaving out a layer that lies out of view. */
    bounds: { left: number; top: number; right: number; bottom: number };
}

/** The paths of each layer and the step of the history they were built at. */
const built = new WeakMap<MarkerLayer, { step: number; paths: MarkerPaths }>();

/**
 * The paths of `layer`'s markers. Markers change only through the history, so the paths of a
 * layer are built again only when `step` (the history's step counter) moved since they were built.
 */
export function markerPaths(layer: MarkerLayer, step: number): MarkerPaths {
    const cached = built.get(layer);
    if (cached?.step === step) return cached.paths;
    const fill = new Path2D();
    const outline = new Path2D();
    const points: number[] = [];
    const names: MarkerName[] = [];
    const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const marker of layer.markers) {
        const box = shapeBox(marker);
        bounds.left = Math.min(bounds.left, box.x);
        bounds.top = Math.min(bounds.top, box.y);
        bounds.right = Math.max(bounds.right, box.x + box.width);
        bounds.bottom = Math.max(bounds.bottom, box.y + box.height);
        if (marker.shape === "point") points.push(marker.x, marker.y);
        else {
            traceShape(outline, marker);
            if (marker.shape !== "polyline") traceShape(fill, marker);
        }
        if (marker.name !== "") {
            names.push({
                name: marker.name,
                point: marker.shape === "point",
                right: box.x + box.width,
                top: box.y,
            });
        }
    }
    const paths = { fill, outline, points: Float64Array.from(points), names, bounds };
    built.set(layer, { step, paths });
    return paths;
}

interface PinSprite {
    image: HTMLCanvasElement | OffscreenCanvas;
    /** Where the tip lies in the image, device pixels. */
    tipX: number;
    tipY: number;
}

/** Pins drawn once per colour and scale. */
const pins = new Map<string, PinSprite>();
const MAX_PINS = 64;

/** The pin of colour `rgb` at `alpha` for `dpr` device pixels per CSS pixel, on its halo. */
function pinSprite(rgb: number, alpha: number, dpr: number): PinSprite {
    const key = `${rgb}/${alpha}/${dpr}`;
    let sprite = pins.get(key);
    if (sprite) return sprite;
    if (pins.size >= MAX_PINS) pins.clear();
    const unit = (PIN_SIZE / PIN_UNITS) * dpr;
    const margin = Math.ceil((OUTLINE_WIDTH / 2 + HALO_WIDTH) * dpr) + 1;
    const width = Math.ceil((PIN_BOX.right - PIN_BOX.left) * unit) + 2 * margin;
    const height = Math.ceil((PIN_TIP.y - PIN_BOX.top) * unit) + 2 * margin;
    // A whole pixel plus a half: the tip lands on a pixel's centre, as an outline drawn there.
    const tipX = margin + Math.round((PIN_TIP.x - PIN_BOX.left) * unit) + 0.5;
    const tipY = margin + Math.round((PIN_TIP.y - PIN_BOX.top) * unit);
    const image = new OffscreenCanvas(width, height);
    const context = image.getContext("2d");
    if (context) {
        context.lineJoin = "round";
        context.lineCap = "round";
        context.beginPath();
        tracePin(context, tipX, tipY, unit);
        context.strokeStyle = cssColour(0x000000, alpha);
        context.lineWidth = (OUTLINE_WIDTH + 2 * HALO_WIDTH) * dpr;
        context.stroke();
        context.strokeStyle = cssColour(rgb, alpha);
        context.lineWidth = OUTLINE_WIDTH * dpr;
        context.stroke();
    }
    sprite = { image, tipX, tipY };
    pins.set(key, sprite);
    return sprite;
}

/** Text widths by font and name: measuring is the cost of a name, and names rarely change. */
const widths = new Map<string, Map<string, number>>();
const MAX_WIDTHS = 8192;

function nameWidth(
    context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    font: string,
    name: string,
): number {
    let byName = widths.get(font);
    if (!byName) {
        widths.clear();
        byName = new Map();
        widths.set(font, byName);
    }
    let width = byName.get(name);
    if (width === undefined) {
        if (byName.size >= MAX_WIDTHS) byName.clear();
        width = context.measureText(name).width;
        byName.set(name, width);
    }
    return width;
}

/** A 2D context of the overlay or of an offscreen canvas. */
type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** How a layer is painted: its colour, the view's scale, and the chips' look. */
interface Look {
    rgb: number;
    alpha: number;
    dpr: number;
    scale: number;
    names: boolean;
    theme: OverlayFrame["theme"];
}

/** A rectangle of device pixels, `[left, right) × [top, bottom)`. */
interface Area {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/** The chips of `paths`: their left middle, device pixels from the layer's map origin. */
function chipsOf(paths: MarkerPaths, look: Look): { name: string; x: number; y: number }[] {
    const unit = (PIN_SIZE / PIN_UNITS) * look.dpr;
    return paths.names.map((each) => {
        const x = each.right * look.scale;
        const y = each.top * look.scale;
        return each.point
            ? // Beside the pin, centred on its head.
              {
                  name: each.name,
                  x: x + (PIN_BOX.right - PIN_TIP.x) * unit + CHIP_GAP * look.dpr,
                  y: y - (PIN_TIP.y - 10) * unit,
              }
            : { name: each.name, x: x + CHIP_GAP * look.dpr, y };
    });
}

/**
 * What a layer paints, device pixels from its map origin: its shapes' bounds widened by a pin and
 * a halo, and its chips when names show.
 */
function paintedArea(context: Context2D, paths: MarkerPaths, look: Look): Area {
    const unit = (PIN_SIZE / PIN_UNITS) * look.dpr;
    const reach = (PIN_TIP.y - PIN_BOX.top) * unit + (OUTLINE_WIDTH + 2 * HALO_WIDTH) * look.dpr;
    const { bounds } = paths;
    const area = {
        left: bounds.left * look.scale - reach,
        top: bounds.top * look.scale - reach,
        right: bounds.right * look.scale + reach,
        bottom: bounds.bottom * look.scale + reach,
    };
    if (look.names && paths.names.length > 0) {
        const font = `${NAME_FONT_SIZE * look.dpr}px ${look.theme.font}`;
        context.font = font;
        const half = (CHIP_HEIGHT * look.dpr) / 2;
        for (const chip of chipsOf(paths, look)) {
            const width = nameWidth(context, font, chip.name) + 2 * CHIP_PADDING * look.dpr;
            area.right = Math.max(area.right, chip.x + width);
            area.top = Math.min(area.top, chip.y - half);
            area.bottom = Math.max(area.bottom, chip.y + half);
        }
    }
    return area;
}

/**
 * Paints a layer on `context` with its map origin at `(ox, oy)`: the shapes under the view's
 * transform (the fills, then every outline on its halo, line widths in map pixels), the pins, and
 * the chips that meet `width × height` (one fill for the chips, then the names).
 */
function paintLayer(
    context: Context2D,
    paths: MarkerPaths,
    look: Look,
    ox: number,
    oy: number,
    width: number,
    height: number,
): void {
    const { rgb, alpha, dpr, scale } = look;
    context.save();
    context.setTransform(scale, 0, 0, scale, ox, oy);
    context.lineJoin = "round";
    context.lineCap = "round";
    context.fillStyle = cssColour(rgb, FILL_ALPHA * alpha);
    context.fill(paths.fill);
    context.strokeStyle = cssColour(0x000000, alpha);
    context.lineWidth = ((OUTLINE_WIDTH + 2 * HALO_WIDTH) * dpr) / scale;
    context.stroke(paths.outline);
    context.strokeStyle = cssColour(rgb, alpha);
    context.lineWidth = (OUTLINE_WIDTH * dpr) / scale;
    context.stroke(paths.outline);
    context.restore();
    if (paths.points.length > 0) {
        const pin = pinSprite(rgb, alpha, dpr);
        const { points } = paths;
        for (let k = 0; k < points.length; k += 2) {
            // Whole device pixels, so the pin is copied without blurring.
            const x = Math.floor(ox + points[k]! * scale - pin.tipX + 0.5);
            const y = Math.floor(oy + points[k + 1]! * scale - pin.tipY + 0.5);
            if (x > width || y > height) continue;
            if (x + pin.image.width < 0 || y + pin.image.height < 0) continue;
            context.drawImage(pin.image, x, y);
        }
    }
    if (!look.names || paths.names.length === 0) return;
    const { theme } = look;
    const font = `${NAME_FONT_SIZE * dpr}px ${theme.font}`;
    context.font = font;
    const chipHeight = CHIP_HEIGHT * dpr;
    const padding = CHIP_PADDING * dpr;
    const placed: { name: string; x: number; y: number }[] = [];
    context.beginPath();
    for (const chip of chipsOf(paths, look)) {
        const x = ox + chip.x;
        const y = oy + chip.y;
        const top = y - chipHeight / 2;
        if (x > width || top > height || top + chipHeight < 0) continue;
        const chipWidth = nameWidth(context, font, chip.name) + 2 * padding;
        if (x + chipWidth < 0) continue;
        context.roundRect(x, top, chipWidth, chipHeight, 2 * dpr);
        placed.push({ name: chip.name, x, y });
    }
    context.fillStyle = cssColour(theme.panel, CHIP_ALPHA);
    context.fill();
    context.fillStyle = cssColour(theme.text);
    context.textBaseline = "middle";
    context.textAlign = "left";
    for (const chip of placed) context.fillText(chip.name, chip.x + padding, chip.y);
}

/** A layer painted once into a canvas of its own, which each redraw copies. */
interface Raster {
    /** What the picture depends on besides where the view is. */
    key: string;
    /** What the layer paints, device pixels from its map origin. */
    painted: Area;
    canvas: OffscreenCanvas;
    /** The canvas's top-left corner, whole device pixels from the layer's map origin. */
    left: number;
    top: number;
}

/** The rasters of the layers the last redraw drew. */
const rasters = new Map<MarkerLayer, Raster>();
/** The rasters painted since the page loaded: the benchmark reports how often a pan paints one. */
let rasterPaints = 0;

/** How many times a layer was painted into its raster since the page loaded. */
export function markerRasterPaints(): number {
    return rasterPaints;
}

/** A raster reaches this far past the view on each side, as a share of the view. */
export const RASTER_MARGIN = 0.25;
/** The longest side of a raster, device pixels. */
export const MAX_RASTER_SIDE = 4096;

/** `[from, to)` cut to `[lo, hi)`, and to at most `max` long about the middle of `need`. */
function span(
    lo: number,
    hi: number,
    from: number,
    to: number,
    need: [number, number],
    max: number,
): [number, number] {
    let start = Math.floor(Math.max(lo, from));
    let end = Math.ceil(Math.min(hi, to));
    if (end - start > max) {
        const middle = (need[0] + need[1]) / 2;
        start = Math.floor(Math.max(start, Math.min(middle - max / 2, end - max)));
        end = start + max;
    }
    return [start, end];
}

/**
 * Draws every visible marker of the frame's map (see the module comment). `step` is the history's
 * step counter: it tells when a layer's paths are out of date.
 */
export function drawMarkers(frame: OverlayFrame, step: number): void {
    const { context, map, mapping, size, theme } = frame;
    const drawn = new Set<MarkerLayer>();
    const { dpr } = mapping.frame;
    const { scale } = mapping;
    const names = namesShown(mapping.frame.view.zoom);
    for (const { layer, shift } of drawnMarkerLayers(map, mapping.frame.view)) {
        const alpha = (layer.color & 0xff) / 255;
        if (alpha === 0) continue;
        const look: Look = { rgb: layer.color >>> 8, alpha, dpr, scale, names, theme };
        const paths = markerPaths(layer, step);
        const key = [
            step,
            scale,
            dpr,
            layer.color,
            names,
            theme.text,
            theme.panel,
            theme.font,
        ].join("|");
        let raster = rasters.get(layer);
        const painted = raster?.key === key ? raster.painted : paintedArea(context, paths, look);
        // Where the layer's map origin lies on the canvas, and the part of the layer in view.
        const origin = mapping.mapToDevice(shift.x, shift.y);
        const ox = Math.round(origin.x);
        const oy = Math.round(origin.y);
        const need: Area = {
            left: Math.max(painted.left, -ox),
            top: Math.max(painted.top, -oy),
            right: Math.min(painted.right, size.width - ox),
            bottom: Math.min(painted.bottom, size.height - oy),
        };
        if (need.right <= need.left || need.bottom <= need.top) continue;
        drawn.add(layer);
        const fits =
            raster !== undefined &&
            raster.key === key &&
            need.left >= raster.left &&
            need.top >= raster.top &&
            need.right <= raster.left + raster.canvas.width &&
            need.bottom <= raster.top + raster.canvas.height;
        if (!raster || !fits) {
            // The view and a margin round it, cut to what the layer paints.
            const mx = RASTER_MARGIN * size.width;
            const my = RASTER_MARGIN * size.height;
            const [left, right] = span(
                painted.left,
                painted.right,
                -ox - mx,
                size.width - ox + mx,
                [need.left, need.right],
                MAX_RASTER_SIDE,
            );
            const [top, bottom] = span(
                painted.top,
                painted.bottom,
                -oy - my,
                size.height - oy + my,
                [need.top, need.bottom],
                MAX_RASTER_SIDE,
            );
            const width = Math.max(1, right - left);
            const height = Math.max(1, bottom - top);
            const canvas =
                raster && raster.canvas.width === width && raster.canvas.height === height
                    ? raster.canvas
                    : new OffscreenCanvas(width, height);
            const target = canvas.getContext("2d");
            if (!target) continue;
            target.setTransform(1, 0, 0, 1, 0, 0);
            target.clearRect(0, 0, width, height);
            paintLayer(target, paths, look, -left, -top, width, height);
            rasterPaints += 1;
            raster = { key, painted, canvas, left, top };
            rasters.set(layer, raster);
        }
        // The picture is copied at whole device pixels: a marker may sit up to half a device
        // pixel from where the tiles under it are drawn.
        context.drawImage(raster.canvas, ox + raster.left, oy + raster.top);
    }
    // A layer that is not drawn now gives its raster back.
    for (const layer of [...rasters.keys()]) if (!drawn.has(layer)) rasters.delete(layer);
}
