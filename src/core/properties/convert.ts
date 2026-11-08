import {
    MAX_FILE_PROPERTY_LENGTH,
    MAX_INT_PROPERTY,
    MAX_STRING_PROPERTY_LENGTH,
    MAX_TEXT_LENGTH,
} from "../model";
import type { Property, PropertyType } from "../model";

// Property values of FORMAT §1.4 and Change Type (SPEC §9). As Tiled's `PropertiesWidget`
// (v1.12.2), a changed type keeps the value where Qt's `QVariant::convert` can turn it into the
// new type, and takes the type's default otherwise: `false`, `0`, `""`, `#000000ff`.
//
// The conversions, from the row type to the column type ("·": unchanged; "d": the default):
//
//     from \ to  bool          int              float          string          color   file
//     bool       ·             1 / 0            1 / 0          "true"/"false"  d       d
//     int        ≠ 0           ·                same number    decimal         d       d
//     float      ≠ 0           rounded¹         ·              shortest²       d       d
//     string     text rule³    integer text⁴    number text⁴   ·               colour⁵ same⁶
//     color      d             d                d              its text        ·       d
//     file       d             d                d              same            d       ·
//
// ¹ Half away from zero (Qt's `qRound64`); out of ±9 007 199 254 740 991 gives the default.
// ² ECMAScript's shortest round-trip text, as Qt's `FloatingPointShortest`.
// ³ False for "", "0" and "false" in any letter case, else true (Qt's string to bool).
// ⁴ Surrounding white space ignored (Qt's `toLongLong`, `toDouble`); text that is no integer
//   (int) or no finite number (float) gives the default, as does an integer out of range.
// ⁵ A colour of FORMAT §1.1 (`#rrggbbaa`, either case, written lowercase) or `#rrggbb` (alpha
//   ff); anything else gives the default. Tiled reads Qt's colour names and `#aarrggbb`; this
//   editor's colours are `#rrggbbaa`, so only its own spellings convert.
// ⁶ Tiled turns text into a file path; a text over 1024 code units gives the default.

/** The value a property of `type` takes when its value cannot be converted (SPEC §9). */
export function defaultProperty(name: string, type: PropertyType): Property {
    switch (type) {
        case "bool":
            return { name, type, value: false };
        case "int":
        case "float":
            return { name, type, value: 0 };
        case "string":
        case "file":
            return { name, type, value: "" };
        case "color":
            return { name, type, value: "#000000ff" };
    }
}

const INTEGER_TEXT = /^[+-]?\d+$/;
/** Decimal number text as Qt's `toDouble` takes it (no hexadecimal, no "Infinity"). */
const NUMBER_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const COLOUR_TEXT = /^#[0-9a-fA-F]{8}$/;
const RGB_TEXT = /^#[0-9a-fA-F]{6}$/;

/** `value` rounded half away from zero, or null outside the int range. */
function roundedInt(value: number): number | null {
    if (!Number.isFinite(value)) return null;
    const rounded = Math.sign(value) * Math.round(Math.abs(value));
    if (Math.abs(rounded) > MAX_INT_PROPERTY) return null;
    // −0 is written as 0.
    return rounded === 0 ? 0 : rounded;
}

function textToBool(text: string): boolean {
    return !(text === "" || text === "0" || text.toLowerCase() === "false");
}

function textToInt(text: string): number | null {
    const trimmed = text.trim();
    if (!INTEGER_TEXT.test(trimmed)) return null;
    const value = Number(trimmed);
    return Number.isSafeInteger(value) ? (value === 0 ? 0 : value) : null;
}

function textToFloat(text: string): number | null {
    const trimmed = text.trim();
    if (!NUMBER_TEXT.test(trimmed)) return null;
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : null;
}

function textToColour(text: string): string | null {
    if (COLOUR_TEXT.test(text)) return text.toLowerCase();
    if (RGB_TEXT.test(text)) return `${text.toLowerCase()}ff`;
    return null;
}

/** The converted value of `property` as type `type`, or null when it does not convert. */
function converted(property: Property, type: PropertyType): Property["value"] | null {
    const { type: from, value } = property;
    if (from === type) return value;
    switch (type) {
        case "bool":
            if (from === "int" || from === "float") return value !== 0;
            if (from === "string") return textToBool(value as string);
            return null;
        case "int":
            if (from === "bool") return value ? 1 : 0;
            if (from === "float") return roundedInt(value as number);
            if (from === "string") return textToInt(value as string);
            return null;
        case "float":
            if (from === "bool") return value ? 1 : 0;
            if (from === "int") return value as number;
            if (from === "string") return textToFloat(value as string);
            return null;
        case "string": {
            const text =
                from === "bool" ? (value ? "true" : "false") : String(value as number | string);
            return text.length <= MAX_STRING_PROPERTY_LENGTH ? text : null;
        }
        case "color":
            return from === "string" ? textToColour(value as string) : null;
        case "file":
            return from === "string" && (value as string).length <= MAX_FILE_PROPERTY_LENGTH
                ? value
                : null;
    }
}

/**
 * `property` as a property of type `type` (Change Type, SPEC §9): its value converted where it
 * can be, else the type's default. The name is kept.
 */
export function convertProperty(property: Property, type: PropertyType): Property {
    const value = converted(property, type);
    if (value === null) return defaultProperty(property.name, type);
    return { name: property.name, type, value } as Property;
}

/** The property types of FORMAT §1.4, in the order the Type select lists them. */
export const PROPERTY_TYPES: readonly PropertyType[] = [
    "bool",
    "int",
    "float",
    "string",
    "color",
    "file",
];

/** Why `name` cannot name a property (FORMAT §1.4); null when it can. */
export function propertyNameProblem(name: string): string | null {
    if (name.trim() === "") return "A property name is not blank.";
    if (name.length > MAX_TEXT_LENGTH) {
        return `A property name has at most ${MAX_TEXT_LENGTH} characters.`;
    }
    return null;
}

/** Why `property`'s value is not one of its type (FORMAT §1.4); null when it is. */
export function propertyValueProblem(property: Property): string | null {
    const { type, value } = property;
    switch (type) {
        case "bool":
            return typeof value === "boolean" ? null : "A bool property is true or false.";
        case "int":
            return Number.isInteger(value) && Math.abs(value) <= MAX_INT_PROPERTY
                ? null
                : `An int property is a whole number within ±${MAX_INT_PROPERTY.toLocaleString("en")}.`;
        case "float":
            return Number.isFinite(value) ? null : "A float property is a finite number.";
        case "string":
            return typeof value === "string" && value.length <= MAX_STRING_PROPERTY_LENGTH
                ? null
                : `A string property has at most ${MAX_STRING_PROPERTY_LENGTH.toLocaleString("en")} characters.`;
        case "color":
            return typeof value === "string" && COLOUR_TEXT.test(value)
                ? null
                : "A color property is #rrggbbaa.";
        case "file":
            return typeof value === "string" && value.length <= MAX_FILE_PROPERTY_LENGTH
                ? null
                : `A file property has at most ${MAX_FILE_PROPERTY_LENGTH.toLocaleString("en")} characters.`;
    }
}

/** Whether two properties have the same type and value. */
export function sameValue(a: Property, b: Property): boolean {
    return a.type === b.type && Object.is(a.value, b.value);
}
