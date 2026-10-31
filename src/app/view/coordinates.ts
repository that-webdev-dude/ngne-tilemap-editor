import type { MapView } from "../../core/model";
import { toDevice } from "../../engine/viewport/geometry";
import type { DeviceSize } from "../../engine/viewport/geometry";

// Coordinate mapping of the viewport (TE-014), shared by the tools and the overlay. Pure: no
// DOM and no store, so it is unit-tested in Node. Four spaces:
//
//   client  CSS pixels of the window, as pointer events report them (`clientX`, `clientY`)
//   device  device pixels from the top-left corner of the viewport element: the pixels of the
//           NGNE canvas and of the overlay canvas
//   map     map pixels, fractions kept; `(0, 0)` is the top-left corner of the map
//   cell    whole cells: `floor(map / tile size)`, also outside the map
//
// The transform is the viewport's own (`engine/viewport/geometry`): the view centre in the
// middle of the canvas and `zoom × dpr` device pixels per map pixel, so a position mapped here
// lands where NGNE draws it.

export interface Point {
    x: number;
    y: number;
}

/** What the mapping depends on. */
export interface ViewFrame {
    /** The view of the map: centre in map pixels, zoom in CSS pixels per map pixel. */
    view: MapView;
    /** Device pixels per CSS pixel: `window.devicePixelRatio`. */
    dpr: number;
    /** The canvas in device pixels. */
    size: DeviceSize;
    /** The map in cells and the size of a cell in map pixels. */
    mapWidth: number;
    mapHeight: number;
    tileWidth: number;
    tileHeight: number;
    /** Top-left corner of the viewport element in client coordinates, CSS pixels. */
    left: number;
    top: number;
}

/**
 * A device coordinate that is a whole number up to noise is that whole number: a position on
 * a cell edge must not fall into the cell before it. A pointer event reports its position in
 * CSS pixels with the precision of a 32-bit float (Chrome: device pixel 269 at a ratio of 1.5
 * arrives as 179.33334350585938), which puts a mouse position just below its device pixel.
 * The error stays under 0.002 device pixels up to 8192 CSS pixels and a ratio of 4; anything
 * closer than 1/128 to a whole device pixel is taken as that pixel.
 */
const NOISE = 1 / 128;
function settle(value: number): number {
    const whole = Math.round(value);
    // `+ 0`: never a negative zero.
    return Math.abs(value - whole) < NOISE ? whole + 0 : value;
}

/**
 * A map position within float noise of a whole map pixel is that pixel: `centre + (x − half) /
 * scale` lands a few ulps below a pixel edge that the view puts exactly on a device pixel, and
 * `floor` would take the pixel before it.
 */
function settleMap(value: number): number {
    const whole = Math.round(value);
    return Math.abs(value - whole) < 1e-9 ? whole + 0 : value;
}

/** Device pixels per map pixel of a view. */
export function viewScale(view: MapView, dpr: number): number {
    return view.zoom * dpr;
}

/** The mapping for one frame. */
export interface ViewMapping {
    readonly frame: Readonly<ViewFrame>;
    /** Device pixels per map pixel. */
    readonly scale: number;
    /** The device position of a client position; fractions are kept. */
    clientToDevice(x: number, y: number): Point;
    /** The client position of a device position. */
    deviceToClient(x: number, y: number): Point;
    /** The device position of a map position. */
    mapToDevice(x: number, y: number): Point;
    /** The map position of a device position, with its fraction inside the pixel. */
    deviceToMap(x: number, y: number): Point;
    /** The map position of a client position, with its fraction inside the pixel. */
    clientToMap(x: number, y: number): Point;
    /** The client position of a map position. */
    mapToClient(x: number, y: number): Point;
    /** The cell under a client position: whole numbers, also outside the map. */
    clientToCell(x: number, y: number): Point;
    /** The cell under a device position. */
    deviceToCell(x: number, y: number): Point;
    /** The map position of the top-left corner of a cell. */
    cellToMap(x: number, y: number): Point;
    /** The device position of the top-left corner of a cell. */
    cellToDevice(x: number, y: number): Point;
    /** Whether a cell lies inside the map. */
    contains(cell: Point): boolean;
}

/** The mapping between client, device, map and cell coordinates for `frame`. */
export function createViewMapping(frame: ViewFrame): ViewMapping {
    const dpr = frame.dpr > 0 && Number.isFinite(frame.dpr) ? frame.dpr : 1;
    const scale = viewScale(frame.view, dpr);
    const { centreX, centreY } = frame.view;
    const { size, tileWidth, tileHeight } = frame;
    // The browser lays the element's box out on whole device pixels.
    const deviceLeft = Math.round(frame.left * dpr);
    const deviceTop = Math.round(frame.top * dpr);
    const camera = { centreX, centreY, scale };

    const clientToDevice = (x: number, y: number): Point => ({
        x: settle(x * dpr - deviceLeft),
        y: settle(y * dpr - deviceTop),
    });
    const deviceToClient = (x: number, y: number): Point => ({
        x: (deviceLeft + x) / dpr,
        y: (deviceTop + y) / dpr,
    });
    const mapToDevice = (x: number, y: number): Point => toDevice(camera, size, x, y);
    const deviceToMap = (x: number, y: number): Point => ({
        x: settleMap(centreX + (x - size.width / 2) / scale),
        y: settleMap(centreY + (y - size.height / 2) / scale),
    });
    const deviceToCell = (x: number, y: number): Point => {
        const at = deviceToMap(x, y);
        // `+ 0`: never a negative zero.
        return { x: Math.floor(at.x / tileWidth) + 0, y: Math.floor(at.y / tileHeight) + 0 };
    };
    const cellToMap = (x: number, y: number): Point => ({ x: x * tileWidth, y: y * tileHeight });

    return {
        frame,
        scale,
        clientToDevice,
        deviceToClient,
        mapToDevice,
        deviceToMap,
        clientToMap(x, y) {
            const device = clientToDevice(x, y);
            return deviceToMap(device.x, device.y);
        },
        mapToClient(x, y) {
            const device = mapToDevice(x, y);
            return deviceToClient(device.x, device.y);
        },
        clientToCell(x, y) {
            const device = clientToDevice(x, y);
            return deviceToCell(device.x, device.y);
        },
        deviceToCell,
        cellToMap,
        cellToDevice(x, y) {
            const at = cellToMap(x, y);
            return mapToDevice(at.x, at.y);
        },
        contains: (cell) =>
            cell.x >= 0 && cell.y >= 0 && cell.x < frame.mapWidth && cell.y < frame.mapHeight,
    };
}
