import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import { browserStorage, readJson, writeItem } from "../platform/storage";
import type { KeyValueStorage } from "../platform/storage";

/**
 * User preferences: one versioned record in `localStorage`, with defaults, typed access and
 * change notification. Each consumer reads its section in its own ticket; the Preferences
 * dialog (TE-008) edits them. The theme is not here: it has its own store (ui/theme). The
 * view flags of SPEC §3 (Show Grid, …) are not here either: app/view/viewPreferences.ts.
 */
export const PREFERENCES_STORAGE_KEY = "ngne-tilemap-editor.preferences";
/** Raised when the meaning of a stored value changes; other versions fall back to defaults. */
export const PREFERENCES_VERSION = 1;

/** A colour taken from the current theme's tokens, or one given as 0xRRGGBB. */
export type ColourChoice = "theme" | number;

/** Transparency checkerboard of the viewport (DESIGN §3.1, ENGINE §3). */
export interface CheckerboardPreference {
    /** "theme": the two colours of the current theme. Otherwise two colours as 0xRRGGBB. */
    readonly colors: "theme" | { readonly a: number; readonly b: number };
    /** Side of one square in map pixels, 1..64. */
    readonly size: number;
}

/** Tile grid of the viewport (DESIGN §4), drawn by TE-014 while Show Grid is on. */
export interface GridPreference {
    /** "theme": white in the dark theme, black in the light one. Otherwise 0xRRGGBB. */
    readonly colour: ColourChoice;
    /** Opacity of the lines in percent, 0..100. */
    readonly opacity: number;
}

/** Highlight Current Layer (DESIGN §4, SPEC §7.2): how the other layers are drawn. */
export interface HighlightPreference {
    /** Opacity of the other layers in percent, 0..100. */
    readonly opacity: number;
}

/** Autosave to IndexedDB (TE-048). */
export interface AutosavePreference {
    readonly enabled: boolean;
}

export interface Preferences {
    readonly checkerboard: CheckerboardPreference;
    readonly grid: GridPreference;
    readonly highlight: HighlightPreference;
    readonly autosave: AutosavePreference;
}
export type PreferenceKey = keyof Preferences;

/** Called after a preference changed, with its key and all current values. */
export type PreferenceListener = (key: PreferenceKey, preferences: Preferences) => void;

export interface PreferenceStore {
    get<Key extends PreferenceKey>(key: Key): Preferences[Key];
    all(): Preferences;
    /** Stores a value and notifies subscribers. Throws `RangeError` for an invalid value. */
    set<Key extends PreferenceKey>(key: Key, value: Preferences[Key]): void;
    /** Returns one preference, or all of them, to the default. */
    reset(key?: PreferenceKey): void;
    subscribe(listener: PreferenceListener): () => void;
    /** The values as a store, for `usePreference`. */
    readonly values: StoreApi<Preferences>;
}

/** A numeric preference lies in `min..max`, both included. */
export interface PreferenceRange {
    readonly min: number;
    readonly max: number;
}

/**
 * The ranges of the numeric preferences. Stored values are checked against them, and the
 * Preferences dialog offers the same ranges in its fields.
 */
export const PREFERENCE_RANGES = {
    /** `checkerboard.size`. */
    checkerboardSize: { min: 1, max: 64 },
    /** `grid.opacity`, `highlight.opacity`: percent. */
    percent: { min: 0, max: 100 },
} as const satisfies Record<string, PreferenceRange>;

export function defaultPreferences(): Preferences {
    return {
        checkerboard: { colors: "theme", size: 8 },
        // The tile-grid alpha of DESIGN §4: 25%, in the theme's colour.
        grid: { colour: "theme", opacity: 25 },
        // DESIGN §4: other layers at 25% by default.
        highlight: { opacity: 25 },
        autosave: { enabled: true },
    };
}

// --- Validation -------------------------------------------------------------------------

/** Returns `value` when it is valid, otherwise `fallback`. */
type Parser<Value> = (value: unknown, fallback: Value) => Value;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Equality of two preference values: plain data, whatever the order of their fields. */
function sameValue(a: unknown, b: unknown): boolean {
    if (!isRecord(a) || !isRecord(b)) return a === b;
    const names = Object.keys(a);
    return (
        names.length === Object.keys(b).length && names.every((name) => sameValue(a[name], b[name]))
    );
}

function integer({ min, max }: PreferenceRange): Parser<number> {
    return (value, fallback) =>
        typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
            ? value
            : fallback;
}

const flag: Parser<boolean> = (value, fallback) => (typeof value === "boolean" ? value : fallback);

/** An object checked field by field: an invalid field takes its default, the rest are kept. */
function fields<Value extends object>(parsers: {
    [Field in keyof Value]-?: Parser<Value[Field]>;
}): Parser<Value> {
    return (value, fallback) => {
        const source = isRecord(value) ? value : {};
        const result: Record<string, unknown> = {};
        for (const field of Object.keys(parsers) as (keyof Value & string)[]) {
            result[field] = parsers[field](source[field], fallback[field]);
        }
        return result as Value;
    };
}

const colour = integer({ min: 0, max: 0xffffff });
const colourChoice: Parser<ColourChoice> = (value, fallback) => {
    if (value === "theme") return value;
    const parsed = colour(value, -1);
    return parsed < 0 ? fallback : parsed;
};
const checkerColours: Parser<CheckerboardPreference["colors"]> = (value, fallback) => {
    if (value === "theme") return value;
    if (!isRecord(value)) return fallback;
    const a = colour(value.a, -1);
    const b = colour(value.b, -1);
    return a < 0 || b < 0 ? fallback : { a, b };
};

const percent = integer(PREFERENCE_RANGES.percent);

const PARSERS: { [Key in PreferenceKey]: Parser<Preferences[Key]> } = {
    checkerboard: fields<CheckerboardPreference>({
        colors: checkerColours,
        size: integer(PREFERENCE_RANGES.checkerboardSize),
    }),
    grid: fields<GridPreference>({ colour: colourChoice, opacity: percent }),
    highlight: fields<HighlightPreference>({ opacity: percent }),
    autosave: fields<AutosavePreference>({ enabled: flag }),
};

function parseSection<Key extends PreferenceKey>(
    key: Key,
    value: unknown,
    fallback: Preferences[Key],
): Preferences[Key] {
    return PARSERS[key](value, fallback);
}

const KEYS = Object.keys(PARSERS) as PreferenceKey[];

/**
 * Reads a stored record. Anything that is not a record of the current version gives the
 * defaults; inside a current record every invalid field falls back to its default. Never
 * throws.
 */
export function parsePreferences(stored: unknown): Preferences {
    const defaults = defaultPreferences();
    if (!isRecord(stored) || stored.version !== PREFERENCES_VERSION) return defaults;
    const values = isRecord(stored.values) ? stored.values : {};
    const section = <Key extends PreferenceKey>(key: Key) =>
        parseSection(key, values[key], defaults[key]);
    return {
        checkerboard: section("checkerboard"),
        grid: section("grid"),
        highlight: section("highlight"),
        autosave: section("autosave"),
    };
}

// --- Store ------------------------------------------------------------------------------

/** A preference store bound to `storage`; `null` keeps the values in memory only. */
export function createPreferenceStore(storage: KeyValueStorage | null): PreferenceStore {
    const values = createStore<Preferences>(() =>
        parsePreferences(readJson(storage, PREFERENCES_STORAGE_KEY)),
    );
    const listeners = new Set<PreferenceListener>();

    const write = <Key extends PreferenceKey>(key: Key, value: Preferences[Key]) => {
        if (sameValue(values.getState()[key], value)) return;
        values.setState({ ...values.getState(), [key]: value });
        writeItem(
            storage,
            PREFERENCES_STORAGE_KEY,
            JSON.stringify({ version: PREFERENCES_VERSION, values: values.getState() }),
        );
        for (const listener of [...listeners]) listener(key, values.getState());
    };

    return {
        get: (key) => values.getState()[key],
        all: () => values.getState(),
        set(key, value) {
            const valid = parseSection(key, value, defaultPreferences()[key]);
            if (!sameValue(valid, value)) {
                throw new RangeError(`Invalid value for the preference "${key}".`);
            }
            write(key, valid);
        },
        reset(key) {
            const defaults = defaultPreferences();
            for (const each of key ? [key] : KEYS) write(each, defaults[each]);
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        values,
    };
}

/** The preferences of the app, persisted in `localStorage`. */
export const preferences = createPreferenceStore(browserStorage());

/** The current value of one preference; the component renders again when it changes. */
export function usePreference<Key extends PreferenceKey>(key: Key): Preferences[Key] {
    return useStore(preferences.values, (state) => state[key]);
}
