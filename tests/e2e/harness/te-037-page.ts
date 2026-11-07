// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { currentViewMapping } from "../../../src/app/view/viewNavigation";
import { viewPreferences } from "../../../src/app/view/viewPreferences";
import { setLayerValuesCommand } from "../../../src/core/layers";
import type { LayerValues } from "../../../src/core/layers";
import {
    assertInvariants,
    createGroupLayer,
    createMarkerLayer,
    createProject,
    createProjectSession,
    effectiveValues,
    findLayer,
    sequentialIds,
} from "../../../src/core/model";
import type { MarkerLayer } from "../../../src/core/model";
import { layerShift } from "../../../src/engine/viewport/geometry";

// TE-037 page module: the specs import it into the running editor, so it shares the app's
// stores. It loads "Markers" with one map, 40 × 30 cells of 16 px, whose layers are
//
//     Group (4, group)                              top
//       Inner (5, marker, blue): a rectangle
//     Areas (3, marker, green): "Door" rectangle, "Pond" ellipse, "Zone" polygon, "Road"
//                               polyline, "Spawn" point
//     Ground (1, tile, active)                      bottom
//
// with the view at zoom 2 about map (170, 130) and Show Grid off, and reads the overlay canvas back: which device
// pixels show a layer's colour, the pixel under a map point, the chip beside a marker.

const hooks = () => window.__ngneTest!;
const state = () => hooks().session.getState();

export const GREEN = 0x20e040;
export const BLUE = 0x4060ff;

export function load(): void {
    const project = createProject({
        name: "Markers",
        newId: sequentialIds("m"),
        map: { name: "Field", width: 40, height: 30, tileWidth: 16, tileHeight: 16 },
    });
    const map = project.maps[0]!;
    map.layers[0]!.name = "Ground";
    const areas = createMarkerLayer(3, "Areas");
    areas.color = ((GREEN << 8) | 0xff) >>> 0;
    const base = { class: "", properties: [] };
    areas.markers.push(
        { ...base, id: 1, name: "Door", shape: "rectangle", x: 40, y: 40, width: 48, height: 24 },
        { ...base, id: 2, name: "Pond", shape: "ellipse", x: 140, y: 40, width: 40, height: 30 },
        {
            ...base,
            id: 3,
            name: "Zone",
            shape: "polygon",
            x: 40,
            y: 110,
            points: [
                [0, 0],
                [60, 0],
                [30, 50],
            ],
        },
        {
            ...base,
            id: 4,
            name: "Road",
            shape: "polyline",
            x: 140,
            y: 110,
            points: [
                [0, 0],
                [30, 40],
                [60, 0],
            ],
        },
        { ...base, id: 5, name: "Spawn", shape: "point", x: 250, y: 80 },
    );
    const group = createGroupLayer(4, "Group");
    const inner = createMarkerLayer(5, "Inner");
    inner.color = ((BLUE << 8) | 0xff) >>> 0;
    inner.markers.push({
        ...base,
        id: 6,
        name: "",
        shape: "rectangle",
        x: 40,
        y: 190,
        width: 40,
        height: 20,
    });
    group.layers.push(inner);
    map.layers.push(areas, group);
    map.nextLayerId = 6;
    map.nextMarkerId = 7;
    // At the view centre a parallax factor of 0.5 moves a layer by 10 map pixels on each axis.
    map.parallaxOriginX = 150;
    map.parallaxOriginY = 110;
    assertInvariants(project);
    const session = createProjectSession(project);
    session.perMap.get(session.activeMapId)!.view = { centreX: 170, centreY: 130, zoom: 2 };
    // The cell grid would draw on the pixels read back.
    viewPreferences.getState().set("grid", false);
    state().replace(session);
}

/** The overlay canvas's size in device pixels. */
export function canvasSize(): { width: number; height: number } {
    const canvas = hooks().overlay!.canvas;
    return { width: canvas.width, height: canvas.height };
}

/** Sets the view's zoom (CSS pixels per map pixel), keeping its centre. */
export function setZoom(zoom: number): void {
    const { session } = state();
    session.perMap.get(session.activeMapId)!.view.zoom = zoom;
    state().touch();
}

/** Sets `values` on layer `id` through the history (one step). */
export function setLayer(id: number, values: Partial<LayerValues>): void {
    const { session, history } = state();
    history.execute(setLayerValuesCommand(session.project, session.activeMapId, [id], values));
}

/** The label of the next undo. */
export function undoLabel(): string | null {
    return state().history.undoLabel;
}

/** The colour of marker layer `id`, 0xRRGGBBAA. */
export function layerColour(id: number): number {
    const map = activeMap();
    return (findLayer(map, id)!.layer as MarkerLayer).color;
}

function activeMap() {
    const { session } = state();
    return session.project.maps.find((map) => map.id === session.activeMapId)!;
}

function pixels(): { data: Uint8ClampedArray; width: number; height: number } {
    const canvas = hooks().overlay!.canvas;
    const image = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    return { data: image.data, width: image.width, height: image.height };
}

/** The device position of map point `(x, y)` of layer `id`: moved by its offset and parallax. */
function device(id: number, x: number, y: number): { x: number; y: number } {
    const map = activeMap();
    const mapping = currentViewMapping()!;
    const entry = findLayer(map, id)!;
    const shift = layerShift(
        map,
        mapping.frame.view,
        effectiveValues(entry.layer, entry.ancestors),
    );
    return mapping.mapToDevice(x + shift.x, y + shift.y);
}

/**
 * Whether pixel `at` of `data` shows colour `rgb` drawn as an outline: opaque and close to `k ×
 * rgb` with `k` from 0.6 to 1 (an anti-aliased edge of the outline over its black halo).
 */
function isOutline(data: Uint8ClampedArray, at: number, rgb: number): boolean {
    if (data[at + 3]! < 200) return false;
    const c = [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255];
    const p = [data[at]!, data[at + 1]!, data[at + 2]!];
    const k =
        (p[0]! * c[0]! + p[1]! * c[1]! + p[2]! * c[2]!) / (c[0]! ** 2 + c[1]! ** 2 + c[2]! ** 2);
    if (k < 0.6 || k > 1.05) return false;
    return p.every((value, index) => Math.abs(value - k * c[index]!) <= 14);
}

/**
 * For each map point of layer `id`: whether a pixel within `radius` device pixels of it shows the
 * layer's outline colour `rgb`.
 */
export function outlineNear(
    id: number,
    rgb: number,
    points: [number, number][],
    radius = 2,
): boolean[] {
    const { data, width, height } = pixels();
    return points.map(([mx, my]) => {
        const at = device(id, mx, my);
        const cx = Math.floor(at.x);
        const cy = Math.floor(at.y);
        for (let y = cy - radius; y <= cy + radius; y++) {
            for (let x = cx - radius; x <= cx + radius; x++) {
                if (x < 0 || y < 0 || x >= width || y >= height) continue;
                if (isOutline(data, (y * width + x) * 4, rgb)) return true;
            }
        }
        return false;
    });
}

/** The RGBA of the device pixel under map point `(x, y)` of layer `id`. */
export function pixelAt(id: number, x: number, y: number): number[] {
    const { data, width } = pixels();
    const at = device(id, x, y);
    const index = (Math.floor(at.y) * width + Math.floor(at.x)) * 4;
    return [...data.slice(index, index + 4)];
}

/** How many pixels of the canvas show outline colour `rgb`. */
export function countOutline(rgb: number): number {
    const { data } = pixels();
    let count = 0;
    for (let at = 0; at < data.length; at += 4) if (isOutline(data, at, rgb)) count += 1;
    return count;
}

/**
 * The pixel 1 device pixel inside the left end of the name chip of a marker whose box's top-right
 * corner is map `(right, top)` on layer `id` (DESIGN §4: the chip starts 4 CSS px right of the
 * box and is centred on its top), and whether any pixel of the chip's first 40 CSS px shows text:
 * brighter than the chip by more than 60 on every channel.
 */
export function chipAt(id: number, right: number, top: number): { pixel: number[]; text: boolean } {
    const { data, width } = pixels();
    const dpr = currentViewMapping()!.frame.dpr;
    const at = device(id, right, top);
    const x0 = Math.floor(at.x + 4 * dpr) + 1;
    const y0 = Math.floor(at.y);
    const index = (y0 * width + x0) * 4;
    const pixel = [...data.slice(index, index + 4)];
    let text = false;
    for (let y = Math.floor(y0 - 6 * dpr); y <= y0 + 6 * dpr && !text; y++) {
        for (let x = x0; x < x0 + 40 * dpr; x++) {
            const i = (y * width + x) * 4;
            if (data[i + 3]! > 150 && [0, 1, 2].every((c) => data[i + c]! > pixel[c]! + 60)) {
                text = true;
                break;
            }
        }
    }
    return { pixel, text };
}
