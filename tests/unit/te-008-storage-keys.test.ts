import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { KeyValueStorage } from "@ngne/editor-ui/platform";
import {
    createPreferenceStore,
    PREFERENCES_STORAGE_KEY,
} from "../../src/app/preferences/preferences";
import {
    createViewPreferenceStore,
    VIEW_PREFERENCES_STORAGE_KEY,
} from "../../src/app/view/viewPreferences";
import { createLayoutStore } from "@ngne/editor-ui/shell";
import { createRecentCommandsStore, createThemeStore, persistedNames } from "@ngne/editor-ui";

// TE-008: every localStorage key the app writes starts with `ngne-tilemap-editor.` (SUITE §7:
// both apps of the suite share one origin). Two checks: every store writes prefixed keys
// when it is driven; and every `*_STORAGE_KEY` constant under src is prefixed and, with the
// instance's names from `persistedNames`, makes up the stores driven here. `localStorage` is
// reached through the package's storage module only (@ngne/editor-ui `platform-storage`
// test), so a store cannot write past these checks.

const PREFIX = "ngne-tilemap-editor.";

// The names of the stores the editor UI instance keeps for the editor's id (@ngne/editor-ui
// SPEC §5), which builds them with these factories over the browser's storage.
const {
    theme: THEME_STORAGE_KEY,
    layout: LAYOUT_STORAGE_KEY,
    recentCommands: RECENT_COMMANDS_STORAGE_KEY,
} = persistedNames("ngne-tilemap-editor");
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** A storage that records every key written to it. */
function recordingStorage(): KeyValueStorage & { written: string[] } {
    const items = new Map<string, string>();
    const written: string[] = [];
    return {
        written,
        getItem: (key) => items.get(key) ?? null,
        setItem(key, value) {
            written.push(key);
            items.set(key, value);
        },
        removeItem: (key) => void items.delete(key),
    };
}

/** Every store kept in localStorage, with its key and a write that reaches the storage. */
const STORES: [key: string, write: (storage: KeyValueStorage) => void][] = [
    [
        THEME_STORAGE_KEY,
        (storage) => createThemeStore(storage, THEME_STORAGE_KEY).getState().setTheme("light"),
    ],
    [
        LAYOUT_STORAGE_KEY,
        (storage) => createLayoutStore(storage, LAYOUT_STORAGE_KEY).getState().setDockWidth(300),
    ],
    [
        PREFERENCES_STORAGE_KEY,
        (storage) => createPreferenceStore(storage).set("autosave", { enabled: false }),
    ],
    [
        VIEW_PREFERENCES_STORAGE_KEY,
        (storage) => createViewPreferenceStore(storage).getState().set("grid", false),
    ],
    [
        RECENT_COMMANDS_STORAGE_KEY,
        (storage) =>
            createRecentCommandsStore(storage, RECENT_COMMANDS_STORAGE_KEY)
                .getState()
                .record("edit.undo"),
    ],
];

/** Every source file under `src`, as a path relative to the repository root. */
function sourceFiles(): string[] {
    return readdirSync(join(ROOT, "src"), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
        .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
        .sort();
}

/** The exported `*_STORAGE_KEY` constants of the source, with their literal values. */
function declaredKeys(): { file: string; name: string; value: string }[] {
    const found = [];
    for (const file of sourceFiles()) {
        const text = readFileSync(join(ROOT, file), "utf8");
        for (const match of text.matchAll(/export const (\w*STORAGE_KEY)\s*=\s*"([^"]*)"/g)) {
            found.push({ file, name: match[1]!, value: match[2]! });
        }
    }
    return found;
}

describe("localStorage keys", () => {
    it("every store writes keys that start with the app prefix", () => {
        for (const [key, write] of STORES) {
            const storage = recordingStorage();
            write(storage);
            expect(storage.written, key).toEqual([key]);
            expect(key.startsWith(PREFIX), key).toBe(true);
        }
    });

    it("the stores write five different keys", () => {
        const keys = STORES.map(([key]) => key);
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys.sort()).toEqual(
            [
                "ngne-tilemap-editor.layout",
                "ngne-tilemap-editor.preferences",
                "ngne-tilemap-editor.recent-commands",
                "ngne-tilemap-editor.theme",
                "ngne-tilemap-editor.view",
            ].sort(),
        );
    });

    it("every STORAGE_KEY constant under src is prefixed and belongs to a store driven here", () => {
        // The app declares its own stores' keys; the instance's stores take theirs from
        // persistedNames(id) (@ngne/editor-ui SPEC §5).
        const declared = declaredKeys();
        const packageNames = [THEME_STORAGE_KEY, LAYOUT_STORAGE_KEY, RECENT_COMMANDS_STORAGE_KEY];
        expect(declared.length).toBeGreaterThanOrEqual(STORES.length - packageNames.length);
        for (const { file, name, value } of declared) {
            expect(value.startsWith(PREFIX), `${file}: ${name} = "${value}"`).toBe(true);
        }
        expect([...declared.map((entry) => entry.value), ...packageNames].sort()).toEqual(
            STORES.map(([key]) => key).sort(),
        );
    });

    it("no source names the sprite editor's prefix", () => {
        const offenders = sourceFiles().filter((file) =>
            readFileSync(join(ROOT, file), "utf8").includes("ngne-sprite-editor."),
        );
        expect(offenders).toEqual([]);
    });

    it("every read or write through storage.ts names its key by a STORAGE_KEY constant", () => {
        // A literal key would pass the constant scan above; none is allowed at a call site.
        const offenders = [];
        for (const file of sourceFiles()) {
            if (file === "src/app/platform/storage.ts") continue;
            const text = readFileSync(join(ROOT, file), "utf8");
            for (const match of text.matchAll(
                /\b(writeItem|readItem|readJson)\(\s*[^,]+,\s*([^,)]+)/g,
            )) {
                const key = match[2]!.trim();
                if (!/^\w*STORAGE_KEY$/.test(key)) offenders.push(`${file}: ${match[0]}`);
            }
        }
        expect(offenders).toEqual([]);
    });
});
