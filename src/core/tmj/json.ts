import { TmjError } from "./errors";

// Reading Tiled's JSON (reference/tiled.md §5) with its defaults: a member Tiled leaves out
// takes the value Tiled reads for it; a member of the wrong type refuses the file.

export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(what: string, key: string, expected: string): TmjError {
    return new TmjError("format", `${what}: "${key}" is not ${expected}.`);
}

/** Parses JSON text; a JSON object is required. */
export function parseObject(text: string, what: string): JsonObject {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        throw new TmjError("format", `${what} is not valid JSON.`);
    }
    if (!isObject(value)) throw new TmjError("format", `${what} is not a JSON object.`);
    return value;
}

export function num(object: JsonObject, key: string, fallback: number, what: string): number {
    const value = object[key];
    if (value === undefined) return fallback;
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw invalid(what, key, "a number");
    }
    return value;
}

export function int(object: JsonObject, key: string, fallback: number, what: string): number {
    const value = num(object, key, fallback, what);
    if (!Number.isInteger(value)) throw invalid(what, key, "an integer");
    return value;
}

export function str(object: JsonObject, key: string, fallback: string, what: string): string {
    const value = object[key];
    if (value === undefined) return fallback;
    if (typeof value !== "string") throw invalid(what, key, "a string");
    return value;
}

export function bool(object: JsonObject, key: string, fallback: boolean, what: string): boolean {
    const value = object[key];
    if (value === undefined) return fallback;
    if (typeof value !== "boolean") throw invalid(what, key, "true or false");
    return value;
}

export function arr(object: JsonObject, key: string, what: string): unknown[] {
    const value = object[key];
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw invalid(what, key, "an array");
    return value;
}

/** The members of an array that must all be objects. */
export function objects(object: JsonObject, key: string, what: string): JsonObject[] {
    const values = arr(object, key, what);
    if (!values.every(isObject)) throw invalid(what, key, "an array of objects");
    return values;
}

/**
 * A Tiled colour, `#AARRGGBB` or `#RRGGBB` (alpha ff), as 0xRRGGBBAA; null for anything else,
 * including the empty text Tiled writes for an unset colour.
 */
export function tiledColor(text: string): number | null {
    const match = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(text);
    const digits = match?.[1];
    if (digits === undefined) return null;
    const argb = digits.length === 6 ? `ff${digits}` : digits;
    return parseInt(argb.slice(2) + argb.slice(0, 2), 16) >>> 0;
}

/** A colour 0xRRGGBBAA as FORMAT §1.1 text, `#rrggbbaa` in lowercase. */
export function formatColor(color: number): string {
    return `#${(color >>> 0).toString(16).padStart(8, "0")}`;
}
