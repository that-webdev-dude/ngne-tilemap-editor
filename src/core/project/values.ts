import {
    MAX_FILE_PROPERTY_LENGTH,
    MAX_INT_PROPERTY,
    MAX_PROPERTIES,
    MAX_SHAPE_POINTS,
    MAX_STRING_PROPERTY_LENGTH,
    MIN_POLYGON_POINTS,
    MIN_POLYLINE_POINTS,
} from "../model/limits";
import type { Property, Shape, ShapeKind, ShapePoint } from "../model";
import type { JsonReader } from "./json";

// The common values of FORMAT §1 that both JSON entries use: property lists (§1.4) and shapes
// (§1.5), read from untrusted JSON, and their JSON form for the writer.

const PROPERTY_TYPES = ["bool", "int", "float", "string", "color", "file"] as const;

/** Sorted by name in UTF-16 code-unit order, as a writer writes a list (FORMAT §1.4). */
export function byName<Item extends { name: string }>(list: readonly Item[]): Item[] {
    return [...list].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** A property list: at most 256, names distinct, values of their type; sorted by name. */
export function readProperties(reader: JsonReader, value: unknown, path: string): Property[] {
    const list = reader.array(value, path, 0, MAX_PROPERTIES);
    const names = new Set<string>();
    const properties = list.map((item, index): Property => {
        const at = `${path}[${index}]`;
        const member = reader.object(item, at, ["name", "type", "value"]);
        const name = reader.text(member.name, `${at}.name`, true);
        if (names.has(name)) reader.fail(`${at}.name`, `repeats the property name ${name}`);
        names.add(name);
        const type = reader.oneOf(member.type, `${at}.type`, PROPERTY_TYPES);
        const valuePath = `${at}.value`;
        switch (type) {
            case "bool":
                return { name, type, value: reader.boolean(member.value, valuePath) };
            case "int":
                return {
                    name,
                    type,
                    value: reader.integer(
                        member.value,
                        valuePath,
                        -MAX_INT_PROPERTY,
                        MAX_INT_PROPERTY,
                    ),
                };
            case "float":
                return { name, type, value: reader.number(member.value, valuePath) };
            case "string":
                return {
                    name,
                    type,
                    value: reader.string(member.value, valuePath, MAX_STRING_PROPERTY_LENGTH),
                };
            case "color":
                return { name, type, value: reader.colour(member.value, valuePath) };
            case "file":
                return {
                    name,
                    type,
                    value: reader.string(member.value, valuePath, MAX_FILE_PROPERTY_LENGTH),
                };
        }
    });
    return byName(properties);
}

/** The JSON form of a property list: sorted by name, members in the order of the table. */
export function propertiesJson(list: readonly Property[]): unknown[] {
    return byName(list).map(({ name, type, value }) => ({
        name,
        type,
        value: type === "color" ? value.toLowerCase() : value,
    }));
}

/** Members of each shape besides `shape`, `x` and `y`. */
const SHAPE_MEMBERS: Record<ShapeKind, readonly string[]> = {
    rectangle: ["width", "height"],
    ellipse: ["width", "height"],
    point: [],
    polygon: ["points"],
    polyline: ["points"],
};

/** The rules a shape is read under: which kinds, and how far `x`, `y` and points may lie. */
export interface ShapeRules {
    kinds: readonly ShapeKind[];
    /** `x` and `y` within `±position`. */
    position: number;
    /** Each point's coordinates within `±point`. */
    point: number;
}

/**
 * A shape of FORMAT §1.5 whose object also holds `extra` members (a marker's), each checked by
 * the caller. Returns the shape and the object's members.
 */
export function readShape(
    reader: JsonReader,
    value: unknown,
    path: string,
    rules: ShapeRules,
    extra: readonly string[] = [],
): { shape: Shape; members: Record<string, unknown> } {
    // The kind decides the members, so it is read before the members are checked.
    const kindOf =
        typeof value === "object" && value !== null && !Array.isArray(value)
            ? (value as Record<string, unknown>).shape
            : undefined;
    const kind = reader.oneOf(kindOf, `${path}.shape`, rules.kinds);
    const members = reader.object(value, path, [
        ...extra,
        "shape",
        "x",
        "y",
        ...SHAPE_MEMBERS[kind],
    ]);
    const x = reader.number(members.x, `${path}.x`, -rules.position, rules.position);
    const y = reader.number(members.y, `${path}.y`, -rules.position, rules.position);
    switch (kind) {
        case "rectangle":
        case "ellipse":
            return {
                shape: {
                    shape: kind,
                    x,
                    y,
                    width: reader.number(members.width, `${path}.width`, 0),
                    height: reader.number(members.height, `${path}.height`, 0),
                },
                members,
            };
        case "point":
            return { shape: { shape: kind, x, y }, members };
        case "polygon":
        case "polyline": {
            const min = kind === "polygon" ? MIN_POLYGON_POINTS : MIN_POLYLINE_POINTS;
            const list = reader.array(members.points, `${path}.points`, min, MAX_SHAPE_POINTS);
            const points = list.map((item, index): ShapePoint => {
                const at = `${path}.points[${index}]`;
                const pair = reader.array(item, at, 2, 2);
                return [
                    reader.number(pair[0], `${at}[0]`, -rules.point, rules.point),
                    reader.number(pair[1], `${at}[1]`, -rules.point, rules.point),
                ];
            });
            return { shape: { shape: kind, x, y, points }, members };
        }
    }
}

/** The JSON members of a shape, in the order of FORMAT §1.5. */
export function shapeJson(shape: Shape): Record<string, unknown> {
    switch (shape.shape) {
        case "rectangle":
        case "ellipse":
            return {
                shape: shape.shape,
                x: shape.x,
                y: shape.y,
                width: shape.width,
                height: shape.height,
            };
        case "point":
            return { shape: shape.shape, x: shape.x, y: shape.y };
        case "polygon":
        case "polyline":
            return {
                shape: shape.shape,
                x: shape.x,
                y: shape.y,
                points: shape.points.map(([px, py]) => [px, py]),
            };
    }
}
