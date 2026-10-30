import { describe, expect, it } from "vitest";
import {
    createPreferenceStore,
    defaultPreferences,
    parsePreferences,
    PREFERENCE_RANGES,
    PREFERENCES_STORAGE_KEY,
    PREFERENCES_VERSION,
} from "../../src/app/preferences/preferences";
import type { PreferenceKey, Preferences } from "../../src/app/preferences/preferences";
import {
    createViewPreferenceStore,
    defaultViewPreferences,
    parseViewPreferences,
    VIEW_PREFERENCE_KEYS,
    VIEW_PREFERENCES_STORAGE_KEY,
} from "../../src/app/view/viewPreferences";
import type { KeyValueStorage } from "../../src/app/platform/storage";
import { formatHexColour, parseHexColour } from "../../src/ui/preferences/hexColour";
import { createThemeStore, DEFAULT_THEME, THEME_STORAGE_KEY } from "../../src/ui/theme/theme";

// TE-008: the stores behind the Preferences dialog and the view preferences of SPEC §3 — the
// ranges the dialog offers are the ranges the store accepts, every field notifies a subscriber
// and persists, a stored record that is corrupt or of another version falls back to the
// defaults, and the theme stays with the theme store. Adapted from the sprite editor's
// se-064-preferences.test.ts.

const DEFAULTS = defaultPreferences();

/** An in-memory `localStorage`. */
function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & {
    data: Map<string, string>;
} {
    const data = new Map(Object.entries(initial));
    return {
        data,
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => void data.set(key, value),
        removeItem: (key) => void data.delete(key),
    };
}

/** Every numeric field of the preference store with the range the dialog offers for it. */
const NUMERIC_FIELDS: [key: PreferenceKey, field: string, range: { min: number; max: number }][] = [
    ["checkerboard", "size", PREFERENCE_RANGES.checkerboardSize],
    ["grid", "opacity", PREFERENCE_RANGES.percent],
    ["highlight", "opacity", PREFERENCE_RANGES.percent],
];

/** One change of every field of the store: the section it is in and the section's new value. */
const FIELD_CHANGES: [field: string, key: PreferenceKey, value: Preferences[PreferenceKey]][] = [
    [
        "checkerboard.colors",
        "checkerboard",
        { ...DEFAULTS.checkerboard, colors: { a: 0x112233, b: 0xddeeff } },
    ],
    ["checkerboard.size", "checkerboard", { ...DEFAULTS.checkerboard, size: 16 }],
    ["grid.colour", "grid", { ...DEFAULTS.grid, colour: 0xff8800 }],
    ["grid.opacity", "grid", { ...DEFAULTS.grid, opacity: 60 }],
    ["highlight.opacity", "highlight", { opacity: 40 }],
    ["autosave.enabled", "autosave", { enabled: false }],
];

/** The names of every field of the store, as "section.field". */
function fieldNames(preferences: Preferences): string[] {
    return (Object.keys(preferences) as PreferenceKey[]).flatMap((key) =>
        Object.keys(preferences[key]).map((field) => `${key}.${field}`),
    );
}

describe("the defaults", () => {
    it("are those of the ticket and DESIGN §4", () => {
        expect(DEFAULTS).toEqual({
            checkerboard: { colors: "theme", size: 8 },
            grid: { colour: "theme", opacity: 25 },
            highlight: { opacity: 25 },
            autosave: { enabled: true },
        });
    });

    it("lie inside their ranges", () => {
        for (const [key, field, range] of NUMERIC_FIELDS) {
            const value = (DEFAULTS[key] as unknown as Record<string, number>)[field] ?? NaN;
            expect(value, `${key}.${field}`).toBeGreaterThanOrEqual(range.min);
            expect(value, `${key}.${field}`).toBeLessThanOrEqual(range.max);
        }
    });
});

describe("preference ranges", () => {
    for (const [key, field, range] of NUMERIC_FIELDS) {
        it(`${key}.${field} accepts ${range.min}..${range.max} and nothing outside`, () => {
            const store = createPreferenceStore(null);
            const withField = (value: number) =>
                ({ ...DEFAULTS[key], [field]: value }) as Preferences[typeof key];
            for (const value of [range.min, range.max]) {
                store.set(key, withField(value));
                expect(store.get(key)).toEqual(withField(value));
            }
            for (const value of [range.min - 1, range.max + 1, 0.5]) {
                expect(() => store.set(key, withField(value)), String(value)).toThrow(RangeError);
            }
            expect(store.get(key)).toEqual(withField(range.max));
        });
    }

    it("covers every numeric field of the store", () => {
        const numeric = (Object.keys(DEFAULTS) as PreferenceKey[]).flatMap((key) =>
            Object.entries(DEFAULTS[key])
                .filter(([, value]) => typeof value === "number")
                .map(([field]) => `${key}.${field}`),
        );
        expect(NUMERIC_FIELDS.map(([key, field]) => `${key}.${field}`).sort()).toEqual(
            numeric.sort(),
        );
    });

    it("colours are 0xRRGGBB or the theme's", () => {
        const store = createPreferenceStore(null);
        store.set("grid", { colour: 0, opacity: 25 });
        store.set("grid", { colour: 0xffffff, opacity: 25 });
        store.set("grid", { colour: "theme", opacity: 25 });
        for (const colour of [-1, 0x1000000, 1.5, "#ffffff" as unknown as number]) {
            expect(() => store.set("grid", { colour, opacity: 25 }), String(colour)).toThrow(
                RangeError,
            );
        }
        expect(() =>
            store.set("checkerboard", { colors: { a: 0x1000000, b: 0 }, size: 8 }),
        ).toThrow(RangeError);
    });
});

describe("changing a preference", () => {
    it("has a change for every field of the store", () => {
        expect(FIELD_CHANGES.map(([field]) => field).sort()).toEqual(fieldNames(DEFAULTS).sort());
    });

    for (const [field, key, value] of FIELD_CHANGES) {
        it(`${field}: updates the store, notifies a subscriber and persists`, () => {
            const storage = memoryStorage();
            const store = createPreferenceStore(storage);
            const seen: [PreferenceKey, unknown][] = [];
            store.subscribe((changed, all) => seen.push([changed, all[changed]]));

            store.set(key, value);
            // The store holds the value at once, and the subscriber was told which one.
            expect(store.get(key)).toEqual(value);
            expect(store.get(key)).not.toEqual(DEFAULTS[key]);
            expect(seen).toEqual([[key, value]]);
            // The other preferences are untouched.
            expect(store.all()).toEqual({ ...DEFAULTS, [key]: value });
            // One versioned record under the app's key.
            expect(JSON.parse(storage.data.get(PREFERENCES_STORAGE_KEY) ?? "null")).toEqual({
                version: PREFERENCES_VERSION,
                values: { ...DEFAULTS, [key]: value },
            });
            // What a reload reads: a new store on the same storage.
            expect(createPreferenceStore(storage).all()).toEqual({ ...DEFAULTS, [key]: value });
        });
    }

    it("setting the same value again changes and notifies nothing", () => {
        const storage = memoryStorage();
        const store = createPreferenceStore(storage);
        const seen: PreferenceKey[] = [];
        store.subscribe((changed) => seen.push(changed));
        store.set("highlight", { opacity: 25 });
        expect(seen).toEqual([]);
        expect(storage.data.size).toBe(0);
    });

    it("reset returns one preference, or all, to the defaults", () => {
        const store = createPreferenceStore(memoryStorage());
        store.set("highlight", { opacity: 40 });
        store.set("autosave", { enabled: false });
        store.reset("highlight");
        expect(store.all()).toEqual({ ...DEFAULTS, autosave: { enabled: false } });
        store.reset();
        expect(store.all()).toEqual(DEFAULTS);
    });
});

describe("stored records", () => {
    const record = (values: unknown, version = PREFERENCES_VERSION) =>
        JSON.stringify({ version, values });

    it("load value for value", () => {
        const values: Preferences = {
            checkerboard: { colors: { a: 0x101010, b: 0x202020 }, size: 4 },
            grid: { colour: 0x123456, opacity: 80 },
            highlight: { opacity: 10 },
            autosave: { enabled: false },
        };
        const store = createPreferenceStore(
            memoryStorage({ [PREFERENCES_STORAGE_KEY]: record(values) }),
        );
        expect(store.all()).toEqual(values);
    });

    it("fall back to the defaults when corrupt, of another version or not a record", () => {
        for (const text of [
            "{not json",
            record({ grid: { colour: 0, opacity: 80 } }, PREFERENCES_VERSION - 1),
            JSON.stringify({ grid: { colour: 0, opacity: 80 } }),
            "null",
            "7",
        ]) {
            const storage = memoryStorage({ [PREFERENCES_STORAGE_KEY]: text });
            expect(createPreferenceStore(storage).all(), text).toEqual(DEFAULTS);
            // The stored text is left as it was until a preference changes.
            expect(storage.data.get(PREFERENCES_STORAGE_KEY)).toBe(text);
        }
        expect(parsePreferences(undefined)).toEqual(DEFAULTS);
    });

    it("an invalid field of a current record falls back alone", () => {
        expect(
            parsePreferences({
                version: PREFERENCES_VERSION,
                values: {
                    checkerboard: { colors: { a: -1, b: 0 }, size: 16 },
                    grid: { colour: "red", opacity: 101 },
                    highlight: { opacity: "40" },
                    autosave: { enabled: "yes" },
                },
            }),
        ).toEqual({
            checkerboard: { colors: "theme", size: 16 },
            grid: { colour: "theme", opacity: 25 },
            highlight: { opacity: 25 },
            autosave: { enabled: true },
        });
    });
});

describe("the theme and the preference store", () => {
    it("the preference store holds no theme: the theme store is its only owner", () => {
        expect(Object.keys(DEFAULTS)).not.toContain("theme");
        expect(fieldNames(DEFAULTS).filter((field) => /theme/i.test(field))).toEqual([]);
        expect(PREFERENCES_STORAGE_KEY).not.toBe(THEME_STORAGE_KEY);
    });

    it("a change of theme and a change of preference do not touch each other's record", () => {
        const storage = memoryStorage();
        const theme = createThemeStore(storage);
        const store = createPreferenceStore(storage);
        theme.getState().setTheme("light");
        expect([...storage.data.keys()]).toEqual([THEME_STORAGE_KEY]);
        store.set("autosave", { enabled: false });
        expect(storage.data.get(THEME_STORAGE_KEY)).toBe("light");
        // Restore defaults in the dialog: both stores go back, each by its own means.
        store.reset();
        theme.getState().setTheme(DEFAULT_THEME);
        expect(createPreferenceStore(storage).all()).toEqual(DEFAULTS);
        expect(createThemeStore(storage).getState().theme).toBe("dark");
    });
});

describe("view preferences (SPEC §3)", () => {
    it("default to grid and snap on, collision and highlight off", () => {
        expect(defaultViewPreferences()).toEqual({
            grid: true,
            collision: false,
            highlightLayer: false,
            snap: true,
        });
        expect([...VIEW_PREFERENCE_KEYS].sort()).toEqual(
            Object.keys(defaultViewPreferences()).sort(),
        );
    });

    it("each flag persists under the view key and is read back by a new store", () => {
        for (const key of VIEW_PREFERENCE_KEYS) {
            const storage = memoryStorage();
            const store = createViewPreferenceStore(storage);
            const flipped = !defaultViewPreferences()[key];
            store.getState().toggle(key);
            expect(store.getState()[key], key).toBe(flipped);
            expect(JSON.parse(storage.data.get(VIEW_PREFERENCES_STORAGE_KEY) ?? "null")).toEqual({
                ...defaultViewPreferences(),
                [key]: flipped,
            });
            expect(createViewPreferenceStore(storage).getState()[key], key).toBe(flipped);
        }
    });

    it("notifies subscribers of a change and not of what changes nothing", () => {
        const store = createViewPreferenceStore(null);
        const seen: boolean[] = [];
        store.subscribe((state) => seen.push(state.grid));
        store.getState().set("grid", true);
        store.getState().set("grid", false);
        store.getState().toggle("grid");
        expect(seen).toEqual([false, true]);
    });

    it("reads anything that is not a record of booleans as the defaults, flag by flag", () => {
        expect(parseViewPreferences(undefined)).toEqual(defaultViewPreferences());
        expect(parseViewPreferences("grid")).toEqual(defaultViewPreferences());
        expect(parseViewPreferences({ grid: false, snap: "no", other: true })).toEqual({
            ...defaultViewPreferences(),
            grid: false,
        });
        const storage = memoryStorage({ [VIEW_PREFERENCES_STORAGE_KEY]: "{not json" });
        expect(createViewPreferenceStore(storage).getState().grid).toBe(true);
    });
});

describe("hex colour text", () => {
    it("writes a colour as #rrggbb", () => {
        expect(formatHexColour(0x3a3a3a)).toBe("#3a3a3a");
        expect(formatHexColour(0)).toBe("#000000");
        expect(formatHexColour(0xff)).toBe("#0000ff");
        expect(formatHexColour(0xffffff)).toBe("#ffffff");
    });

    it("reads #rrggbb, rrggbb and the short form, in either case", () => {
        expect(parseHexColour("#3a3a3a")).toBe(0x3a3a3a);
        expect(parseHexColour("C8C8C8")).toBe(0xc8c8c8);
        expect(parseHexColour(" #FfFfFf ")).toBe(0xffffff);
        expect(parseHexColour("#1af")).toBe(0x11aaff);
        expect(parseHexColour("000")).toBe(0);
    });

    it("rejects text that is not a colour", () => {
        for (const text of ["", "#", "#12", "#12345", "#1234567", "red", "#gggggg", "12 34 56"]) {
            expect(parseHexColour(text), text).toBeNull();
        }
    });
});
