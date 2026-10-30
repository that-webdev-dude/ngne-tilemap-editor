import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import { browserStorage, readJson, writeItem } from "../platform/storage";
import type { KeyValueStorage } from "../platform/storage";

/**
 * The view preferences of SPEC §3: Show Grid, Show Collision, Highlight Current Layer and Snap
 * to Grid are app preferences, as in Tiled, the same for every project and map, kept in
 * `localStorage` under one key. A change is a plain setter with no history entry and does not
 * make the project dirty. The commands that toggle them come with their features (grid and
 * collision TE-014, highlight TE-034, snap TE-038); the Preferences dialog does not show them.
 */
export const VIEW_PREFERENCES_STORAGE_KEY = "ngne-tilemap-editor.view";

export interface ViewPreferences {
    /** View → Show Grid (DESIGN §4). */
    readonly grid: boolean;
    /** View → Show Collision; off by default (DESIGN §4). */
    readonly collision: boolean;
    /** View → Highlight Current Layer; off by default, as in Tiled. */
    readonly highlightLayer: boolean;
    /** View → Snap to Grid; on by default (SPEC §8). */
    readonly snap: boolean;
}
export type ViewPreferenceKey = keyof ViewPreferences;

export const VIEW_PREFERENCE_KEYS = ["grid", "collision", "highlightLayer", "snap"] as const;

export function defaultViewPreferences(): ViewPreferences {
    return { grid: true, collision: false, highlightLayer: false, snap: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads a stored record: every flag that is a boolean is taken, anything else falls back to
 * its default. Never throws.
 */
export function parseViewPreferences(stored: unknown): ViewPreferences {
    const defaults = defaultViewPreferences();
    const source = isRecord(stored) ? stored : {};
    const flag = (key: ViewPreferenceKey) => {
        const value = source[key];
        return typeof value === "boolean" ? value : defaults[key];
    };
    return {
        grid: flag("grid"),
        collision: flag("collision"),
        highlightLayer: flag("highlightLayer"),
        snap: flag("snap"),
    };
}

export interface ViewPreferenceState extends ViewPreferences {
    /** Sets one flag and persists the record. */
    set(key: ViewPreferenceKey, value: boolean): void;
    toggle(key: ViewPreferenceKey): void;
}

/** A view-preference store bound to `storage`; `null` keeps the flags in memory only. */
export function createViewPreferenceStore(
    storage: KeyValueStorage | null,
): StoreApi<ViewPreferenceState> {
    return createStore<ViewPreferenceState>((set, get) => ({
        ...parseViewPreferences(readJson(storage, VIEW_PREFERENCES_STORAGE_KEY)),
        set(key, value) {
            if (get()[key] === value) return;
            set({ [key]: value });
            const record = Object.fromEntries(
                VIEW_PREFERENCE_KEYS.map((each) => [each, get()[each]]),
            );
            writeItem(storage, VIEW_PREFERENCES_STORAGE_KEY, JSON.stringify(record));
        },
        toggle(key) {
            get().set(key, !get()[key]);
        },
    }));
}

/** The view preferences of the app, persisted in `localStorage`. */
export const viewPreferences = createViewPreferenceStore(browserStorage());

/** The current value of one view flag; the component renders again when it changes. */
export function useViewPreference(key: ViewPreferenceKey): boolean {
    return useStore(viewPreferences, (state) => state[key]);
}
