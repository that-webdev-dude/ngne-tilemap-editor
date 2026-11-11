import {
    MAX_FILE_PROPERTY_LENGTH,
    MAX_INT_PROPERTY,
    MAX_PROPERTIES,
    MAX_STRING_PROPERTY_LENGTH,
    MAX_TEXT_LENGTH,
} from "../model";
import type { Property } from "../model";
import { formatColor, isObject, objects, tiledColor } from "./json";
import type { JsonObject } from "./json";
import type { TmjLocation, TmjReporter } from "./report";

// Tiled properties (reference/tiled.md §5 Property) as FORMAT §1.4 properties (BRIEF §7):
// `object`, `list` and class-typed properties are dropped; an enum (a string or int property with
// a `propertytype`) is kept as its value; colours `#AARRGGBB` become `#rrggbbaa`. Whatever is
// dropped or changed is reported.

/** Text of FORMAT §1.1: at most 255 UTF-16 code units, longer text cut there and reported. */
export function readText(
    value: string,
    label: string,
    where: TmjLocation,
    report: TmjReporter,
): string {
    if (value.length <= MAX_TEXT_LENGTH) return value;
    report.add("out-of-range", `${label} cut to ${MAX_TEXT_LENGTH} characters`, where);
    return value.slice(0, MAX_TEXT_LENGTH);
}

function convertOne(raw: JsonObject, where: TmjLocation, report: TmjReporter): Property | null {
    const name = typeof raw.name === "string" ? raw.name : "";
    const at: TmjLocation = { ...where, property: name };
    const type = raw.type === undefined ? "string" : raw.type;
    const value = raw.value;
    const enumType = typeof raw.propertytype === "string" ? raw.propertytype : "";
    const outOfRange = (why: string): null => {
        report.add("out-of-range", `Property dropped: ${why}`, at);
        return null;
    };
    if (name.trim() === "") return outOfRange("its name is blank");
    if (name.length > MAX_TEXT_LENGTH) return outOfRange("its name is too long");
    if (type === "object" || type === "list" || type === "class") {
        const kind = type === "class" ? `class ${enumType || "(no type)"}` : type;
        report.add("dropped-properties", `Property of type ${kind} dropped`, at);
        return null;
    }
    switch (type) {
        case "bool":
            if (typeof value !== "boolean") return outOfRange("its value is not a bool");
            return { name, type: "bool", value };
        case "int":
            if (typeof value !== "number" || !Number.isSafeInteger(value)) {
                return outOfRange("its value is not an integer in range");
            }
            if (Math.abs(value) > MAX_INT_PROPERTY) return outOfRange("its value is too large");
            if (enumType) {
                report.add("enum-properties", `Enum ${enumType} imported as int ${value}`, at);
            }
            return { name, type: "int", value };
        case "float":
            if (typeof value !== "number" || !Number.isFinite(value)) {
                return outOfRange("its value is not a number");
            }
            return { name, type: "float", value };
        case "string":
            if (typeof value !== "string") return outOfRange("its value is not text");
            if (value.length > MAX_STRING_PROPERTY_LENGTH)
                return outOfRange("its text is too long");
            if (enumType) {
                report.add("enum-properties", `Enum ${enumType} imported as string "${value}"`, at);
            }
            return { name, type: "string", value };
        case "color": {
            const color = typeof value === "string" ? tiledColor(value) : null;
            if (color === null) return outOfRange("its colour is unset or not a colour");
            return { name, type: "color", value: formatColor(color) };
        }
        case "file":
            if (typeof value !== "string") return outOfRange("its value is not a path");
            if (value.length > MAX_FILE_PROPERTY_LENGTH) return outOfRange("its path is too long");
            return { name, type: "file", value };
        default:
            return outOfRange(`its type ${String(type)} is unknown`);
    }
}

/** The properties of `owner.properties`, converted, in file order. */
export function convertProperties(
    owner: JsonObject,
    where: TmjLocation,
    report: TmjReporter,
    what: string,
): Property[] {
    const result: Property[] = [];
    const names = new Set<string>();
    for (const raw of objects(owner, "properties", what)) {
        const property = convertOne(raw, where, report);
        if (property === null) continue;
        const at: TmjLocation = { ...where, property: property.name };
        if (names.has(property.name)) {
            report.add("out-of-range", "Property dropped: its name is repeated", at);
        } else if (result.length === MAX_PROPERTIES) {
            report.add("out-of-range", `Property dropped: more than ${MAX_PROPERTIES}`, at);
        } else {
            names.add(property.name);
            result.push(property);
        }
    }
    return result;
}

/**
 * Template properties overridden by the instance's (Tiled's `MapObject::syncWithTemplate`): the
 * template's in their order, an instance property of the same name replacing it, then the
 * instance's own.
 */
export function mergeProperties(template: unknown, instance: unknown): unknown {
    if (!Array.isArray(template)) return instance;
    if (!Array.isArray(instance)) return template;
    const own = new Map<unknown, unknown>();
    for (const property of instance) {
        if (isObject(property)) own.set(property.name, property);
    }
    const merged: unknown[] = template.map((property) =>
        isObject(property) && own.has(property.name) ? own.get(property.name) : property,
    );
    const inherited = new Set(template.filter(isObject).map((property): unknown => property.name));
    for (const property of instance) {
        if (!isObject(property) || !inherited.has(property.name)) merged.push(property);
    }
    return merged;
}
