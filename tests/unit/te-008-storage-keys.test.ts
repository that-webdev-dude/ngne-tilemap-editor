import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
    createRecentCommandsStore,
    RECENT_COMMANDS_STORAGE_KEY,
} from "../../src/app/commandPalette/recentCommands";
import type { KeyValueStorage } from "../../src/app/platform/storage";
import {
    createPreferenceStore,
    PREFERENCES_STORAGE_KEY,
} from "../../src/app/preferences/preferences";
import {
    createViewPreferenceStore,
    VIEW_PREFERENCES_STORAGE_KEY,
} from "../../src/app/view/viewPreferences";
import { createLayoutStore, LAYOUT_STORAGE_KEY } from "../../src/ui/shell/layoutStore";
import { createThemeStore, THEME_STORAGE_KEY } from "../../src/ui/theme/theme";

// TE-008: every localStorage key the app writes starts with `ngne-tilemap-editor.` (SUITE §7:
// both apps of the suite share one origin). Three checks: every store writes prefixed keys
// when it is driven; every `*_STORAGE_KEY` constant under src is prefixed and is one of the
// stores driven here; and `localStorage` is reached through app/platform/storage.ts only, so a
// store cannot write past these checks.

const PREFIX = "ngne-tilemap-editor.";
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
    [THEME_STORAGE_KEY, (storage) => createThemeStore(storage).getState().setTheme("light")],
    [LAYOUT_STORAGE_KEY, (storage) => createLayoutStore(storage).getState().setDockWidth(300)],
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
        (storage) => createRecentCommandsStore(storage).getState().record("edit.undo"),
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
        const declared = declaredKeys();
        expect(declared.length).toBeGreaterThanOrEqual(STORES.length);
        for (const { file, name, value } of declared) {
            expect(value.startsWith(PREFIX), `${file}: ${name} = "${value}"`).toBe(true);
        }
        expect(declared.map((entry) => entry.value).sort()).toEqual(
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

    it("only app/platform/storage.ts touches localStorage", () => {
        // Comments may name the storage; code outside storage.ts may not.
        const code = (file: string) =>
            readFileSync(join(ROOT, file), "utf8")
                .replace(/\/\*[\s\S]*?\*\//g, "")
                .replace(/\/\/.*$/gm, "");
        const offenders = sourceFiles().filter(
            (file) =>
                file !== "src/app/platform/storage.ts" &&
                /\b(localStorage|sessionStorage)\b/.test(code(file)),
        );
        expect(offenders).toEqual([]);
        expect(/\blocalStorage\b/.test(code("src/app/platform/storage.ts"))).toBe(true);
    });
});
