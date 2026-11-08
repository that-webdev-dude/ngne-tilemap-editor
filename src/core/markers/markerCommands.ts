import type { Command, Touched } from "../history";
import {
    MAX_MARKERS,
    MAX_MARKER_COORD,
    MAX_MARKER_ID,
    MAX_MARKER_POINTS,
    MAX_SHAPE_POINTS,
    MAX_TEXT_LENGTH,
    MIN_POLYGON_POINTS,
    MIN_POLYLINE_POINTS,
    cloneShape,
    createMapSession,
    findLayer,
    fitShape,
    moveShape,
    walkLayers,
} from "../model";
import type {
    MapSession,
    Marker,
    MarkerLayer,
    Project,
    ProjectMap,
    ProjectSession,
    Property,
    Shape,
    ShapeBox,
    ShapePoint,
} from "../model";

// The marker commands of SPEC §8 (TE-037): add, delete, move, resize, set points, rename, class,
// and the colour a marker layer draws its markers in; paste of several markers (TE-039). The tools (TE-038, TE-039) and the
// Properties panel (TE-040) build them.
//
// Each command checks what it would make against FORMAT §1.5 and §2.8 before it changes anything
// and throws `MarkerEditError` with the map unchanged: coordinates within ±1 048 576, polygons of
// 3 to 1024 points and polylines of 2 to 1024, at most 16 384 markers and 262 144 points in a
// map, names and classes of at most 255 UTF-16 code units, marker IDs below 2 147 483 647.
//
// A new marker takes the map's `nextMarkerId` at its first `do`; redo puts back the same marker
// with the same ID. Undo does not give the ID back (SPEC §7.2, as in Tiled): `nextMarkerId` stays
// at the highest value it has had. A command that removes markers takes them out of the marker
// selection (SPEC §3: session state the commands restore); undo puts the selection back.
//
// Markers draw on the overlay, not in the viewport's tiers: `touched` names the map (an undo of
// another map's entry shows that map first, SPEC §3) and the marker layers, never cells or
// structure.

export type MarkerEditErrorCode =
    /** The command names a map, layer or marker that does not exist. */
    | "missing"
    /** The layer is not a marker layer, or the shape is not a polygon or polyline. */
    | "kind"
    /** The map would hold more than 16 384 markers or 262 144 points, or run out of IDs. */
    | "limit"
    /** A value out of its range: a coordinate, a size, the points of a shape, a text, a colour. */
    | "values";

export class MarkerEditError extends Error {
    override readonly name = "MarkerEditError";
    readonly code: MarkerEditErrorCode;

    constructor(code: MarkerEditErrorCode, message: string) {
        super(message);
        this.code = code;
    }
}

/** Labels of the history entries; Delete and Move count their markers (`markerLabel`). */
export const MARKER_LABELS = {
    add: "Add Marker",
    paste: "Paste",
    delete: "Delete Marker",
    deleteMany: "Delete Markers",
    move: "Move Marker",
    moveMany: "Move Markers",
    resize: "Resize Marker",
    points: "Edit Marker Points",
    rename: "Rename Marker",
    class: "Marker Class",
    color: "Marker Layer Colour",
} as const;

/** What a new marker is made of: its shape, and its name, class and properties when it has them. */
export type NewMarker = Shape & { name?: string; class?: string; properties?: Property[] };

/** Bytes a command claims besides its markers. */
const OVERHEAD_BYTES = 256;
/** Bytes counted per marker, and per point of a polygon or polyline. */
const MARKER_BYTES = 96;
const POINT_BYTES = 16;

function markerBytes(markers: Iterable<Shape>): number {
    let bytes = 0;
    for (const marker of markers) {
        bytes += MARKER_BYTES + ("points" in marker ? marker.points.length * POINT_BYTES : 0);
    }
    return bytes;
}

function touched(mapId: string, layerIds: Iterable<number>): Touched {
    return {
        mapId,
        layerIds: [...new Set(layerIds)].sort((a, b) => a - b),
        cellRects: [],
        tilesetIds: [],
        structure: false,
    };
}

function mapOf(project: Project, id: string): ProjectMap {
    const map = project.maps.find((each) => each.id === id);
    if (!map) throw new MarkerEditError("missing", `The project has no map "${id}".`);
    return map;
}

function mapSessionOf(session: ProjectSession, map: ProjectMap): MapSession {
    let mapSession = session.perMap.get(map.id);
    if (!mapSession) {
        mapSession = createMapSession(map);
        session.perMap.set(map.id, mapSession);
    }
    return mapSession;
}

/** The marker layer `layerId` of `map`; throws `MarkerEditError` for another kind or none. */
export function markerLayerOf(map: ProjectMap, layerId: number): MarkerLayer {
    const layer = findLayer(map, layerId)?.layer;
    if (!layer) throw new MarkerEditError("missing", `The map has no layer ${layerId}.`);
    if (layer.type !== "marker") {
        throw new MarkerEditError("kind", `“${layer.name}” is not a marker layer.`);
    }
    return layer;
}

/** Where a marker is: its layer and its index in the layer's list. */
export interface MarkerPlace {
    layer: MarkerLayer;
    index: number;
    marker: Marker;
}

/** The marker with `id` in `map`, with its layer and index; undefined when none. */
export function findMarker(map: ProjectMap, id: number): MarkerPlace | undefined {
    for (const { layer } of walkLayers(map.layers)) {
        if (layer.type !== "marker") continue;
        const index = layer.markers.findIndex((marker) => marker.id === id);
        if (index >= 0) return { layer, index, marker: layer.markers[index]! };
    }
    return undefined;
}

function placeOf(map: ProjectMap, id: number): MarkerPlace {
    const place = findMarker(map, id);
    if (!place) throw new MarkerEditError("missing", `The map has no marker ${id}.`);
    return place;
}

/** The places of markers `ids` of `map`, each once; throws for none or an unknown one. */
function placesOf(map: ProjectMap, ids: readonly number[]): MarkerPlace[] {
    if (ids.length === 0) throw new MarkerEditError("missing", "No marker is chosen.");
    return [...new Set(ids)].map((id) => placeOf(map, id));
}

// ---------------------------------------------------------------------------------------------
// Checks

const inRange = (value: number) => Number.isFinite(value) && Math.abs(value) <= MAX_MARKER_COORD;

const RANGE = `−${MAX_MARKER_COORD.toLocaleString("en")} to ${MAX_MARKER_COORD.toLocaleString("en")}`;

/** Why `shape` cannot be a marker's shape (FORMAT §1.5, §2.5); null when it can. */
export function markerShapeProblem(shape: Shape): string | null {
    if (!inRange(shape.x) || !inRange(shape.y)) {
        return `A marker's position lies within ${RANGE} px.`;
    }
    switch (shape.shape) {
        case "rectangle":
        case "ellipse":
            if (
                !(shape.width >= 0 && shape.height >= 0) ||
                shape.width > 2 * MAX_MARKER_COORD ||
                shape.height > 2 * MAX_MARKER_COORD
            ) {
                return "A rectangle or ellipse has a width and height of 0 or more within the coordinate range.";
            }
            return null;
        case "point":
            return null;
        case "polygon":
        case "polyline": {
            const polygon = shape.shape === "polygon";
            const min = polygon ? MIN_POLYGON_POINTS : MIN_POLYLINE_POINTS;
            const kind = polygon ? "polygon" : "polyline";
            if (shape.points.length < min) return `A ${kind} has at least ${min} points.`;
            if (shape.points.length > MAX_SHAPE_POINTS) {
                return `A ${kind} has at most ${MAX_SHAPE_POINTS} points.`;
            }
            if (!shape.points.every(([px, py]) => inRange(px) && inRange(py))) {
                return `A ${kind}'s points lie within ${RANGE} px of its position.`;
            }
            return null;
        }
        default:
            return `Unknown shape "${(shape as { shape: unknown }).shape}".`;
    }
}

/** Why `text` cannot be a marker's name or class; null when it can. */
function textProblem(text: string, what: string): string | null {
    if (typeof text !== "string") return `${what} is text.`;
    if (text.length > MAX_TEXT_LENGTH) return `${what} has at most ${MAX_TEXT_LENGTH} characters.`;
    return null;
}

function assertShape(shape: Shape): void {
    const problem = markerShapeProblem(shape);
    if (problem) throw new MarkerEditError("values", problem);
}

/** The markers and points of `map`. */
function markerCounts(map: ProjectMap): { markers: number; points: number } {
    let markers = 0;
    let points = 0;
    for (const { layer } of walkLayers(map.layers)) {
        if (layer.type !== "marker") continue;
        markers += layer.markers.length;
        for (const marker of layer.markers) {
            if ("points" in marker) points += marker.points.length;
        }
    }
    return { markers, points };
}

const pointsOf = (shape: Shape) => ("points" in shape ? shape.points.length : 0);

/** Throws when `map` with `markers` more markers and `points` more points breaks §2.8. */
function assertRoom(map: ProjectMap, markers: number, points: number): void {
    const counts = markerCounts(map);
    if (counts.markers + markers > MAX_MARKERS || counts.points + points > MAX_MARKER_POINTS) {
        throw new MarkerEditError(
            "limit",
            `A map holds at most ${MAX_MARKERS.toLocaleString("en")} markers with ` +
                `${MAX_MARKER_POINTS.toLocaleString("en")} points.`,
        );
    }
}

/** Whether `color` is a colour 0xRRGGBBAA. */
function isColor(color: number): boolean {
    return Number.isInteger(color) && color >= 0 && color <= 0xffffffff;
}

// ---------------------------------------------------------------------------------------------
// Commands

/** A new marker made from `input` with `id`; deep copies, so the input is not kept. */
function markerFrom(input: NewMarker, id: number): Marker {
    const { name = "", class: markerClass = "", properties = [], ...shape } = input;
    return {
        ...cloneShape(shape as Shape),
        id,
        name,
        class: markerClass,
        properties: structuredClone(properties),
    } as Marker;
}

/** The marker command `addMarkerCommand` returns: the new marker's ID once it has one. */
export interface AddMarkerCommand extends Command {
    /** The ID the marker took at the first `do`; null before. */
    readonly markerId: number | null;
}

/**
 * The command that adds `marker` at the top of marker layer `layerId` of map `mapId` (the end of
 * its list, as Tiled's `AddMapObjects`), with the ID `nextMarkerId` gives at its first `do`.
 * Throws `MarkerEditError` for a shape, name or class out of range, now or at `do`; its `do`
 * throws for a layer that is gone or of another kind, a map full of markers or points, or a
 * map out of marker IDs.
 */
export function addMarkerCommand(
    mapId: string,
    layerId: number,
    marker: NewMarker,
): AddMarkerCommand {
    const problem =
        markerShapeProblem(marker) ??
        textProblem(marker.name ?? "", "A marker name") ??
        textProblem(marker.class ?? "", "A class");
    if (problem) throw new MarkerEditError("values", problem);
    let added: Marker | null = null;
    let selection: { before: number[]; after: number[] } | null = null;
    return {
        label: MARKER_LABELS.add,
        bytes: OVERHEAD_BYTES + markerBytes([marker]),
        touched: touched(mapId, [layerId]),
        get markerId() {
            return added?.id ?? null;
        },
        do(session) {
            const map = mapOf(session.project, mapId);
            const layer = markerLayerOf(map, layerId);
            const mapSession = mapSessionOf(session, map);
            if (added && selection) {
                layer.markers.push(structuredClone(added));
                map.nextMarkerId = Math.max(map.nextMarkerId, added.id + 1);
                mapSession.markerSelection = [...selection.after];
                return;
            }
            assertRoom(map, 1, pointsOf(marker));
            const id = map.nextMarkerId;
            if (id >= MAX_MARKER_ID) {
                throw new MarkerEditError("limit", "The map has used up its marker IDs.");
            }
            const made = markerFrom(marker, id);
            layer.markers.push(made);
            map.nextMarkerId = id + 1;
            added = structuredClone(made);
            selection = {
                before: [...mapSession.markerSelection],
                after: [...mapSession.markerSelection],
            };
        },
        undo(session) {
            if (!added || !selection) return;
            const map = mapOf(session.project, mapId);
            const layer = markerLayerOf(map, layerId);
            const index = layer.markers.findIndex((each) => each.id === added!.id);
            if (index >= 0) layer.markers.splice(index, 1);
            mapSessionOf(session, map).markerSelection = [...selection.before];
        },
    };
}

/** The marker command `pasteMarkersCommand` returns: the new markers' IDs once they have them. */
export interface PasteMarkersCommand extends Command {
    /** The IDs the markers took at the first `do`, in the order given; empty before. */
    readonly markerIds: readonly number[];
}

/**
 * The command that adds `markers` at the top of marker layer `layerId` of map `mapId`, in their
 * order, one entry labelled `label` (Paste of markers, SPEC §8; Tiled's `AddMapObjects` of
 * pasted objects): each keeps its geometry, name, class and properties and takes the next ID of
 * `nextMarkerId` at the first `do`; redo puts back the same markers with the same IDs. The
 * marker selection is kept, as `addMarkerCommand` keeps it. Throws `MarkerEditError` for no
 * marker, or a shape, name or class out of range, now or at `do`; its `do` throws for a layer
 * that is gone or of another kind, a map that would hold too many markers or points, or a map
 * out of marker IDs.
 */
export function pasteMarkersCommand(
    mapId: string,
    layerId: number,
    markers: readonly NewMarker[],
    label: string = MARKER_LABELS.paste,
): PasteMarkersCommand {
    if (markers.length === 0) throw new MarkerEditError("missing", "No marker is chosen.");
    for (const marker of markers) {
        const problem =
            markerShapeProblem(marker) ??
            textProblem(marker.name ?? "", "A marker name") ??
            textProblem(marker.class ?? "", "A class");
        if (problem) throw new MarkerEditError("values", problem);
    }
    const inputs = markers.map((marker) => structuredClone(marker));
    let added: Marker[] | null = null;
    let selection: number[] = [];
    return {
        label,
        bytes: OVERHEAD_BYTES + markerBytes(inputs),
        touched: touched(mapId, [layerId]),
        get markerIds() {
            return added?.map((marker) => marker.id) ?? [];
        },
        do(session) {
            const map = mapOf(session.project, mapId);
            const layer = markerLayerOf(map, layerId);
            const mapSession = mapSessionOf(session, map);
            if (added) {
                for (const marker of added) layer.markers.push(structuredClone(marker));
                map.nextMarkerId = Math.max(map.nextMarkerId, added[added.length - 1]!.id + 1);
                mapSession.markerSelection = [...selection];
                return;
            }
            assertRoom(
                map,
                inputs.length,
                inputs.reduce((sum, marker) => sum + pointsOf(marker), 0),
            );
            const first = map.nextMarkerId;
            if (first + inputs.length > MAX_MARKER_ID) {
                throw new MarkerEditError("limit", "The map has used up its marker IDs.");
            }
            const made = inputs.map((marker, k) => markerFrom(marker, first + k));
            layer.markers.push(...made);
            map.nextMarkerId = first + made.length;
            added = structuredClone(made);
            selection = [...mapSession.markerSelection];
        },
        undo(session) {
            if (!added) return;
            const map = mapOf(session.project, mapId);
            const layer = markerLayerOf(map, layerId);
            const gone = new Set(added.map((marker) => marker.id));
            for (let index = layer.markers.length - 1; index >= 0; index--) {
                if (gone.has(layer.markers[index]!.id)) layer.markers.splice(index, 1);
            }
            mapSessionOf(session, map).markerSelection = [...selection];
        },
    };
}

/** A removed marker: its layer, index and value. */
interface Removed {
    layerId: number;
    index: number;
    marker: Marker;
}

/**
 * The command that deletes markers `ids` of `project`'s map `mapId` from their layers (Tiled's
 * `RemoveMapObjects`); they leave the marker selection. Throws `MarkerEditError` ("missing") for
 * no marker or an unknown one, now or at `do`.
 */
export function deleteMarkersCommand(
    project: Project,
    mapId: string,
    ids: readonly number[],
): Command {
    const places = placesOf(mapOf(project, mapId), ids);
    const layerIds = places.map((place) => place.layer.id);
    const wanted = [...new Set(ids)];
    let removed: Removed[] = [];
    let selection: number[] = [];
    return {
        label: wanted.length === 1 ? MARKER_LABELS.delete : MARKER_LABELS.deleteMany,
        bytes: OVERHEAD_BYTES + markerBytes(places.map((place) => place.marker)),
        touched: touched(mapId, layerIds),
        do(session) {
            const map = mapOf(session.project, mapId);
            const found = placesOf(map, wanted);
            const mapSession = mapSessionOf(session, map);
            selection = [...mapSession.markerSelection];
            // Taken out from the last index of each layer down, so the indices stay true.
            found.sort((a, b) => a.layer.id - b.layer.id || a.index - b.index);
            removed = found.map(({ layer, index, marker }) => ({
                layerId: layer.id,
                index,
                marker,
            }));
            for (const { layer, index } of [...found].reverse()) layer.markers.splice(index, 1);
            const gone = new Set(wanted);
            mapSession.markerSelection = mapSession.markerSelection.filter((id) => !gone.has(id));
        },
        undo(session) {
            const map = mapOf(session.project, mapId);
            for (const { layerId, index, marker } of removed) {
                markerLayerOf(map, layerId).markers.splice(index, 0, marker);
            }
            mapSessionOf(session, map).markerSelection = [...selection];
        },
    };
}

/**
 * A command that gives markers `ids` of map `mapId` the shapes `edit` makes of them, checked
 * before anything changes; undo puts back their shapes. The markers keep their ID, name, class,
 * properties and kind.
 */
function geometryCommand(
    label: string,
    project: Project,
    mapId: string,
    ids: readonly number[],
    edit: (marker: Marker) => Shape,
): Command {
    const places = placesOf(mapOf(project, mapId), ids);
    const wanted = [...new Set(ids)];
    let before: Shape[] = [];
    return {
        label,
        bytes: OVERHEAD_BYTES + 2 * markerBytes(places.map((place) => place.marker)),
        touched: touched(
            mapId,
            places.map((place) => place.layer.id),
        ),
        do(session) {
            const map = mapOf(session.project, mapId);
            const found = placesOf(map, wanted);
            const after = found.map(({ marker }) => edit(marker));
            for (const shape of after) assertShape(shape);
            const added = after.reduce(
                (sum, shape, k) => sum + pointsOf(shape) - pointsOf(found[k]!.marker),
                0,
            );
            if (added > 0) assertRoom(map, 0, added);
            before = found.map(({ marker }) => geometryOf(marker));
            found.forEach(({ marker }, k) => setGeometry(marker, after[k]!));
        },
        undo(session) {
            const map = mapOf(session.project, mapId);
            placesOf(map, wanted).forEach(({ marker }, k) => setGeometry(marker, before[k]!));
        },
    };
}

/** The shape of a marker alone, copied. */
function geometryOf(marker: Marker): Shape {
    switch (marker.shape) {
        case "rectangle":
        case "ellipse":
            return {
                shape: marker.shape,
                x: marker.x,
                y: marker.y,
                width: marker.width,
                height: marker.height,
            };
        case "point":
            return { shape: "point", x: marker.x, y: marker.y };
        case "polygon":
        case "polyline":
            return cloneShape({
                shape: marker.shape,
                x: marker.x,
                y: marker.y,
                points: marker.points,
            });
    }
}

/** Gives `marker` the geometry of `shape` (of the same kind), copied. */
function setGeometry(marker: Marker, shape: Shape): void {
    const copy = cloneShape(shape);
    marker.x = copy.x;
    marker.y = copy.y;
    if ("width" in copy && "width" in marker) {
        marker.width = copy.width;
        marker.height = copy.height;
    }
    if ("points" in copy && "points" in marker) marker.points = copy.points;
}

/**
 * The command that moves markers `ids` of `project`'s map `mapId` by `(dx, dy)` map pixels, one
 * entry however many (Tiled's `MoveMapObject`). Throws `MarkerEditError` for an unknown marker or
 * a position past ±1 048 576, now or at `do`.
 */
export function moveMarkersCommand(
    project: Project,
    mapId: string,
    ids: readonly number[],
    dx: number,
    dy: number,
): Command {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
        throw new MarkerEditError("values", "A move is a finite number of pixels.");
    }
    const label = new Set(ids).size === 1 ? MARKER_LABELS.move : MARKER_LABELS.moveMany;
    return geometryCommand(label, project, mapId, ids, (marker) =>
        moveShape(geometryOf(marker), dx, dy),
    );
}

/**
 * The command that fits marker `id` of `project`'s map `mapId` to `box` (Tiled's
 * `ResizeMapObject`, and the point scaling of its polygons): a rectangle or ellipse takes the
 * box, a polygon or polyline scales its points from its own box to it, a point moves to the
 * box's corner (`fitShape`). Throws `MarkerEditError` for an unknown marker or a box out of
 * range.
 */
export function resizeMarkerCommand(
    project: Project,
    mapId: string,
    id: number,
    box: ShapeBox,
): Command {
    return geometryCommand(MARKER_LABELS.resize, project, mapId, [id], (marker) =>
        fitShape(geometryOf(marker), box),
    );
}

/**
 * The command that sets the points of polygon or polyline marker `id` of `project`'s map `mapId`
 * to `points`, relative to its position, and the position to `at` when given (Edit points: a
 * vertex dragged, inserted or deleted). Throws `MarkerEditError` for an unknown marker, a marker
 * of another shape ("kind"), too few or many points or points out of range ("values"), or a map
 * past 262 144 points ("limit").
 */
export function setMarkerPointsCommand(
    project: Project,
    mapId: string,
    id: number,
    points: readonly ShapePoint[],
    at?: { x: number; y: number },
): Command {
    const { marker } = placeOf(mapOf(project, mapId), id);
    if (marker.shape !== "polygon" && marker.shape !== "polyline") {
        throw new MarkerEditError(
            "kind",
            `Marker ${id} is a ${marker.shape}, not a polygon or polyline.`,
        );
    }
    const copy = points.map(([px, py]): ShapePoint => [px, py]);
    return geometryCommand(MARKER_LABELS.points, project, mapId, [id], (current) => {
        if (current.shape !== "polygon" && current.shape !== "polyline") {
            throw new MarkerEditError("kind", `Marker ${id} is no polygon or polyline.`);
        }
        return {
            shape: current.shape,
            x: at?.x ?? current.x,
            y: at?.y ?? current.y,
            points: copy,
        };
    });
}

/**
 * A command that sets text field `key` of markers `ids` of `project`'s map `mapId` to `value`;
 * undo puts back each marker's own.
 */
function textCommand(
    label: string,
    project: Project,
    mapId: string,
    ids: readonly number[],
    key: "name" | "class",
    value: string,
): Command {
    const problem = textProblem(value, key === "name" ? "A marker name" : "A class");
    if (problem) throw new MarkerEditError("values", problem);
    const places = placesOf(mapOf(project, mapId), ids);
    const wanted = [...new Set(ids)];
    let before: string[] = [];
    return {
        label,
        bytes: OVERHEAD_BYTES + wanted.length * 2 * MAX_TEXT_LENGTH,
        touched: touched(
            mapId,
            places.map((place) => place.layer.id),
        ),
        do(session) {
            const found = placesOf(mapOf(session.project, mapId), wanted);
            before = found.map(({ marker }) => marker[key]);
            for (const { marker } of found) marker[key] = value;
        },
        undo(session) {
            placesOf(mapOf(session.project, mapId), wanted).forEach(
                ({ marker }, k) => (marker[key] = before[k]!),
            );
        },
    };
}

/** The command that names markers `ids` of `project`'s map `mapId` `name` (may be empty). */
export function renameMarkersCommand(
    project: Project,
    mapId: string,
    ids: readonly number[],
    name: string,
): Command {
    return textCommand(MARKER_LABELS.rename, project, mapId, ids, "name", name);
}

/** The command that sets the class of markers `ids` of `project`'s map `mapId`; "" for none. */
export function setMarkerClassCommand(
    project: Project,
    mapId: string,
    ids: readonly number[],
    markerClass: string,
): Command {
    return textCommand(MARKER_LABELS.class, project, mapId, ids, "class", markerClass);
}

/**
 * The command that sets the colour marker layer `layerId` of `project`'s map `mapId` draws its
 * markers in (FORMAT §2.5 `color`), 0xRRGGBBAA. Throws `MarkerEditError` for a colour out of
 * range or a layer that is no marker layer.
 */
export function markerLayerColorCommand(
    project: Project,
    mapId: string,
    layerId: number,
    color: number,
): Command {
    if (!isColor(color)) {
        throw new MarkerEditError("values", "A colour is a whole number 0x00000000..0xffffffff.");
    }
    markerLayerOf(mapOf(project, mapId), layerId);
    let before: number | null = null;
    return {
        label: MARKER_LABELS.color,
        bytes: OVERHEAD_BYTES,
        touched: touched(mapId, [layerId]),
        do(session) {
            const layer = markerLayerOf(mapOf(session.project, mapId), layerId);
            before = layer.color;
            layer.color = color;
        },
        undo(session) {
            if (before === null) return;
            markerLayerOf(mapOf(session.project, mapId), layerId).color = before;
        },
    };
}
