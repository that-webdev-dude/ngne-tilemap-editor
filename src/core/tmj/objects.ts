import {
    MAX_MARKER_COORD,
    MAX_SHAPE_POINTS,
    MIN_POLYGON_POINTS,
    MIN_POLYLINE_POINTS,
} from "../model";
import type { Marker, Shape, ShapePoint } from "../model";
import { TmjError } from "./errors";
import { bool, isObject, num, parseObject, str } from "./json";
import type { JsonObject } from "./json";
import { convertProperties, mergeProperties, readText } from "./properties";
import type { TmjLocation, TmjReporter } from "./report";

// Objects of an object layer as markers (BRIEF §7, SPEC §13): a template instance is merged with
// its template first; rectangles, points, ellipses, polygons and polylines are kept; rotation is
// dropped; tile, text and capsule objects are dropped; hidden objects import visible. Each is
// reported.

/** Returns the text of a template by its path as the map writes it; undefined when missing. */
export type TemplateReader = (path: string) => string | undefined;

/** Reads each template once; refuses a missing or malformed one. */
export class Templates {
    private readonly cache = new Map<string, JsonObject>();

    constructor(private readonly read: TemplateReader | undefined) {}

    object(path: string): JsonObject {
        const cached = this.cache.get(path);
        if (cached) return cached;
        const text = this.read?.(path);
        if (text === undefined) {
            throw new TmjError("missing-file", `The template ${path} is missing.`, path);
        }
        const template = parseObject(text, `Template ${path}`);
        const object = template.object;
        if (template.type !== "template" || !isObject(object)) {
            throw new TmjError("format", `Template ${path} is not a Tiled template.`);
        }
        this.cache.set(path, object);
        return object;
    }
}

/** An instance with its template's members under its own (`MapObject::syncWithTemplate`). */
function inlineTemplate(instance: JsonObject, templates: Templates): JsonObject {
    const path = instance.template;
    if (typeof path !== "string") return instance;
    const template = templates.object(path);
    const merged: JsonObject = { ...template, ...instance };
    merged.properties = mergeProperties(template.properties, instance.properties);
    delete merged.template;
    return merged;
}

/** A polygon's or polyline's points, relative to the object; null when one is malformed. */
function readPoints(value: unknown): ShapePoint[] | null {
    if (!Array.isArray(value)) return null;
    const points: ShapePoint[] = [];
    for (const point of value) {
        if (!isObject(point)) return null;
        const { x, y } = point;
        if (typeof x !== "number" || typeof y !== "number") return null;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        points.push([x, y]);
    }
    return points;
}

/** The kind of object Tiled saved, by the members that mark it. */
function objectKind(object: JsonObject): string {
    if (object.gid !== undefined) return "Tile object";
    if (object.text !== undefined) return "Text object";
    if (object.capsule === true) return "Capsule object";
    if (object.point === true) return "point";
    if (object.ellipse === true) return "ellipse";
    if (object.polygon !== undefined) return "polygon";
    if (object.polyline !== undefined) return "polyline";
    return "rectangle";
}

function inRange(value: number): boolean {
    return Math.abs(value) <= MAX_MARKER_COORD;
}

/** The shape of a marker, or why it cannot be one. */
function readShape(object: JsonObject, kind: string, what: string): Shape | string {
    const x = num(object, "x", 0, what);
    const y = num(object, "y", 0, what);
    if (!inRange(x) || !inRange(y)) return "its position is out of range";
    if (kind === "point") return { shape: "point", x, y };
    if (kind === "polygon" || kind === "polyline") {
        const points = readPoints(object[kind]);
        if (points === null) return `its ${kind} points are malformed`;
        const fewest = kind === "polygon" ? MIN_POLYGON_POINTS : MIN_POLYLINE_POINTS;
        if (points.length < fewest || points.length > MAX_SHAPE_POINTS) {
            return `a ${kind} of ${points.length} points`;
        }
        if (!points.every(([px, py]) => inRange(x + px) && inRange(y + py))) {
            return "a point is out of range";
        }
        return kind === "polygon"
            ? { shape: "polygon", x, y, points }
            : { shape: "polyline", x, y, points };
    }
    const width = num(object, "width", 0, what);
    const height = num(object, "height", 0, what);
    if (width < 0 || height < 0) return "its size is negative";
    if (!inRange(x + width) || !inRange(y + height)) return "its size is out of range";
    return kind === "ellipse"
        ? { shape: "ellipse", x, y, width, height }
        : { shape: "rectangle", x, y, width, height };
}

export interface ObjectContext {
    readonly layer: { readonly id: number; readonly name: string };
    readonly templates: Templates;
    readonly report: TmjReporter;
}

/**
 * The marker of a Tiled object, or null when it is dropped. Its ID is Tiled's; the caller
 * checks it is unique. `what` names the object in format errors.
 */
export function convertObject(
    raw: JsonObject,
    context: ObjectContext,
    what: string,
): Marker | null {
    const { report, layer } = context;
    const id = raw.id;
    const object = inlineTemplate(raw, context.templates);
    const name = str(object, "name", "", what);
    const at: TmjLocation = { layer, object: { id: typeof id === "number" ? id : 0, name } };
    if (typeof raw.template === "string") {
        report.add("template-instances", `Template ${raw.template} inlined`, at);
    }
    const kind = objectKind(object);
    if (kind === "Tile object" || kind === "Text object" || kind === "Capsule object") {
        report.add("dropped-objects", `${kind} dropped`, at);
        return null;
    }
    const shape = readShape(object, kind, what);
    if (typeof shape === "string") {
        report.add("out-of-range", `Object dropped: ${shape}`, at);
        return null;
    }
    const rotation = num(object, "rotation", 0, what);
    if (rotation !== 0) report.add("object-rotation", `Rotation ${rotation}° dropped`, at);
    if (!bool(object, "visible", true, what)) {
        report.add("hidden-objects", "Hidden object imported visible", at);
    }
    // Tiled 1.9 wrote an object's class as `class`; every other version as `type`.
    const className = str(object, "type", str(object, "class", "", what), what);
    return {
        ...shape,
        // Tiled's number as it is; the map's `assignIds` replaces one out of range and reports it.
        id: typeof id === "number" ? id : 0,
        name: readText(name, "Name", at, report),
        class: readText(className, "Class", at, report),
        properties: convertProperties(object, at, report, what),
    };
}
