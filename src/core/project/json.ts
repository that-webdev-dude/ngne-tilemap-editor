import { isId, isSlug } from "../model";
import { MAX_ID_LENGTH, MAX_SLUG_LENGTH, MAX_TEXT_LENGTH } from "../model/limits";
import { parseJson as parseContainerJson } from "../sprite/project/json";
import { ProjectError, fromContainerError, quoted } from "./errors";
import type { ProjectErrorCode } from "./errors";

// JSON entries of a project file (FORMAT §2.2): their text, and the typed reads a parsed value
// goes through before any of it is used. Nothing here trusts the value: it comes from a file.

/**
 * The value of a JSON entry: the sprite core's strict parser (UTF-8, a byte order mark skipped,
 * no object with a member twice). Throws `ProjectError` "corrupt-entry".
 */
export function parseJson(bytes: Uint8Array, entry: string): unknown {
    try {
        return parseContainerJson(bytes, entry);
    } catch (error) {
        throw fromContainerError(error, entry);
    }
}

/** A `data` array of a tile layer, written one map row per line (FORMAT §2.2). */
export class CellRows {
    readonly data: Uint32Array;
    readonly width: number;

    constructor(data: Uint32Array, width: number) {
        this.data = data;
        this.width = width;
    }
}

const ROWS_MARK = "\u0000rows:";
const INDENT = "    ";

/**
 * The text of a JSON entry: UTF-8, members in the order the value holds them, indented by four
 * spaces, every `CellRows` as an array with one map row per line, a line feed at the end.
 */
export function encodeJson(value: unknown): Uint8Array<ArrayBuffer> {
    const rows: CellRows[] = [];
    const text = JSON.stringify(
        value,
        (_key, item: unknown) => {
            if (!(item instanceof CellRows)) return item;
            rows.push(item);
            return `${ROWS_MARK}${rows.length - 1}`;
        },
        INDENT.length,
    );
    if (rows.length === 0) return new TextEncoder().encode(`${text}\n`);
    // Each mark is the value of a `data` member on a line of its own; the line's indent is the
    // array's. A string of the file cannot fake one: its quotes are escaped.
    let replaced = 0;
    const out = text.replace(
        /^( *)"data": "\\u0000rows:(\d+)"/gm,
        (_line, indent: string, at: string) => {
            replaced += 1;
            const { data, width } = rows[Number(at)]!;
            const inner = indent + INDENT;
            const lines: string[] = [];
            for (let start = 0; start < data.length; start += width) {
                lines.push(inner + data.subarray(start, start + width).join(", "));
            }
            return `${indent}"data": [\n${lines.join(",\n")}\n${indent}]`;
        },
    );
    if (replaced !== rows.length) throw new Error("A cell array is not the value of `data`.");
    return new TextEncoder().encode(`${out}\n`);
}

/** A value as a message shows it. Objects and arrays are named, not printed. */
function shown(value: unknown): string {
    if (value === undefined) return "nothing";
    if (value === null) return "null";
    if (Array.isArray(value)) return "an array";
    if (typeof value === "string") return quoted(value);
    return typeof value === "object" ? "an object" : String(value);
}

const COLOUR_PATTERN = /^#[0-9a-fA-F]{8}$/;

/**
 * Typed reads of the values of one JSON entry. Every method returns the value it was given,
 * narrowed, or throws a `ProjectError` with the reader's code and entry. The message names the
 * entry, the path of the value (`layers[2].opacity`) and what the value must be.
 */
export class JsonReader {
    readonly code: ProjectErrorCode;
    readonly entry: string;

    constructor(code: ProjectErrorCode, entry: string) {
        this.code = code;
        this.entry = entry;
    }

    /** Throws the reader's error for the value at `path`; `problem` completes the sentence. */
    fail(path: string, problem: string): never {
        const subject = path === "" ? "the top-level value" : `\`${path}\``;
        throw new ProjectError(this.code, `${this.entry}: ${subject} ${problem}.`, {
            entry: this.entry,
        });
    }

    /** A JSON object with exactly the members `keys`: none missing and no other. */
    object<Key extends string>(
        value: unknown,
        path: string,
        keys: readonly Key[],
    ): Record<Key, unknown> {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
            this.fail(path, `must be an object, got ${shown(value)}`);
        }
        const record = value as Record<string, unknown>;
        for (const key of keys) {
            if (!Object.hasOwn(record, key)) this.fail(path, `has no member \`${key}\``);
        }
        const known: readonly string[] = keys;
        for (const key of Object.keys(record)) {
            if (!known.includes(key)) this.fail(path, `has an unknown member ${quoted(key)}`);
        }
        return record;
    }

    /** A JSON array of `min` to `max` items. */
    array(value: unknown, path: string, min = 0, max = Infinity): unknown[] {
        if (!Array.isArray(value)) this.fail(path, `must be an array, got ${shown(value)}`);
        if (value.length > max) {
            this.fail(path, `holds ${value.length} items; at most ${max} are allowed`);
        }
        if (value.length < min) {
            this.fail(path, `holds ${value.length} items; at least ${min} are required`);
        }
        return value as unknown[];
    }

    /** A string of at most `maxLength` UTF-16 code units. */
    string(value: unknown, path: string, maxLength = Infinity): string {
        if (typeof value !== "string") this.fail(path, `must be a string, got ${shown(value)}`);
        if (value.length > maxLength) {
            this.fail(
                path,
                `must be at most ${maxLength} UTF-16 code units long, got ${value.length}`,
            );
        }
        return value;
    }

    /** Text of FORMAT §1.1: at most 255 UTF-16 code units; `nonBlank` adds a visible character. */
    text(value: unknown, path: string, nonBlank = false): string {
        const text = this.string(value, path, MAX_TEXT_LENGTH);
        if (nonBlank && text.trim() === "") this.fail(path, "must not be blank");
        return text;
    }

    boolean(value: unknown, path: string): boolean {
        if (typeof value !== "boolean") {
            this.fail(path, `must be true or false, got ${shown(value)}`);
        }
        return value;
    }

    /** A finite number from `min` to `max`. */
    number(value: unknown, path: string, min = -Infinity, max = Infinity): number {
        const range = min === -Infinity && max === Infinity ? "" : ` from ${min} to ${max}`;
        if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
            this.fail(path, `must be a number${range}, got ${shown(value)}`);
        }
        return value;
    }

    /** An integer from `min` to `max`. */
    integer(value: unknown, path: string, min: number, max: number): number {
        if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
            this.fail(path, `must be an integer from ${min} to ${max}, got ${shown(value)}`);
        }
        return value;
    }

    /** One of the strings `options`. */
    oneOf<Option extends string>(value: unknown, path: string, options: readonly Option[]): Option {
        const found = options.find((option) => option === value);
        if (found === undefined) {
            const list = options.map((option) => `"${option}"`).join(", ");
            this.fail(path, `must be one of ${list}, got ${shown(value)}`);
        }
        return found;
    }

    /** An ID of FORMAT §1.1. */
    id(value: unknown, path: string): string {
        if (!isId(value) || value === "") {
            this.fail(
                path,
                `must be an ID of 1 to ${MAX_ID_LENGTH} characters from A-Z, a-z, 0-9, "_" ` +
                    `and "-", got ${shown(value)}`,
            );
        }
        return value;
    }

    /** A slug of FORMAT §1.1. */
    slug(value: unknown, path: string): string {
        if (!isSlug(value)) {
            this.fail(
                path,
                `must be a slug of 1 to ${MAX_SLUG_LENGTH} characters matching ` +
                    `[a-z0-9][a-z0-9_-]*, not "ngne-tilemap", got ${shown(value)}`,
            );
        }
        return value;
    }

    /** A colour `#rrggbbaa`, either case, as written in lowercase. */
    colour(value: unknown, path: string): string {
        if (typeof value !== "string" || !COLOUR_PATTERN.test(value)) {
            this.fail(path, `must be a colour written "#rrggbbaa", got ${shown(value)}`);
        }
        return value.toLowerCase();
    }

    /** A colour `#rrggbbaa` as the number 0xRRGGBBAA. */
    colourNumber(value: unknown, path: string): number {
        return Number.parseInt(this.colour(value, path).slice(1), 16);
    }
}

/** The colour `#rrggbbaa` of a number 0xRRGGBBAA, in lowercase. */
export function colourText(value: number): string {
    return `#${(value >>> 0).toString(16).padStart(8, "0")}`;
}
