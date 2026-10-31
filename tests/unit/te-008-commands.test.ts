import { afterEach, describe, expect, it } from "vitest";
import { fuzzyScore } from "../../src/app/commandPalette/fuzzy";
import { paletteEntries, runPaletteCommand } from "../../src/app/commandPalette/paletteModel";
import {
    createRecentCommandsStore,
    MAX_RECENT_COMMANDS,
    parseRecentCommands,
} from "../../src/app/commandPalette/recentCommands";
import { appCommands } from "../../src/app/commands/appCommands";
import { buildMenu } from "../../src/app/commands/menuModel";
import type { MenuNode } from "../../src/app/commands/menuModel";
import { plannedCommands } from "../../src/app/commands/planned.commands";
import { createCommandRegistry } from "../../src/app/commands/registry";
import type { CommandRegistry } from "../../src/app/commands/registry";
import type { Command, CommandSpec } from "../../src/app/commands/types";
import { resolveKey } from "../../src/app/keymap/resolve";
import type { KeyEnvironment } from "../../src/app/keymap/resolve";
import { OTHER_SHORTCUTS, shortcutGroups } from "../../src/app/shortcuts/shortcutSheet";
import { SURFACE_IDS, surfaces } from "../../src/app/surfaces/surfaces";
import type { SurfaceId } from "../../src/app/surfaces/surfaces";

// TE-008: the three commands of this ticket in the registry (their planned menu items, their
// chords from DESIGN §10.3, the surfaces they open), and the palette and sheet models over the
// app's registry. Adapted from the sprite editor's se-064-commands.test.ts, se-064-palette.test.ts
// and se-064-shortcut-sheet.test.ts; the verbatim models keep their own tests there.

const COMMANDS: Record<SurfaceId, string> = {
    "command-palette": "edit.commandPalette",
    preferences: "edit.preferences",
    "shortcut-sheet": "edit.shortcuts",
};

function command(id: string): Command {
    const found = appCommands.get(id);
    if (!found) throw new Error(`no command ${id}`);
    return found;
}

/** The ids of a menu's commands, with "---" for a separator. */
function outline(nodes: readonly MenuNode[]): string[] {
    return nodes.map((node) => (node.kind === "command" ? node.command.id : "---"));
}

/** A key pressed with nothing open, on the viewport unless stated otherwise. */
function environment(overrides: Partial<KeyEnvironment> = {}): KeyEnvironment {
    return {
        overlayOpen: false,
        focus: "viewport",
        inPanel: false,
        nativeKeys: new Set(),
        typeahead: false,
        gesture: false,
        markers: false,
        ...overrides,
    };
}

function spec(id: string, overrides: Partial<CommandSpec> = {}): CommandSpec {
    return { id, title: id, run() {}, ...overrides };
}

function registryOf(...specs: CommandSpec[]): CommandRegistry {
    const registry = createCommandRegistry();
    for (const each of specs) registry.register(each);
    return registry;
}

afterEach(() => {
    surfaces.close();
});

describe("the commands of TE-008 in the registry", () => {
    it("take the menu items planned for them, at the end of Edit", () => {
        for (const id of Object.values(COMMANDS)) {
            const plan = plannedCommands.find((entry) => entry.id === id);
            expect(plan, id).toBeDefined();
            expect(command(id), id).toMatchObject({
                planned: false,
                menuPath: ["Edit"],
                menuOrder: plan?.menuOrder,
            });
            expect(command(id).title(), id).toBe(plan?.title);
            // Always available: none of them needs a map.
            expect(command(id).enabled(), id).toBe(true);
        }
        expect(outline(buildMenu(appCommands.list(), ["Edit"])).slice(-4)).toEqual([
            "---",
            "edit.commandPalette",
            "edit.shortcuts",
            "edit.preferences",
        ]);
    });

    it("each registers from a module of its own", () => {
        expect(command("edit.commandPalette").source).toBe(
            "../commandPalette/commandPalette.commands.ts",
        );
        expect(command("edit.preferences").source).toBe("../preferences/preferences.commands.ts");
        expect(command("edit.shortcuts").source).toBe("../shortcuts/shortcuts.commands.ts");
    });

    it("the command palette binds the chord of DESIGN §10.3: Ctrl+K †, also in text fields", () => {
        expect(command("edit.commandPalette")).toMatchObject({
            shortcuts: ["Ctrl+K"],
            contexts: ["global", "text"],
            release: null,
        });
    });

    it("the shortcut sheet binds the chord of DESIGN §10.3: ? in the canvas context only", () => {
        expect(command("edit.shortcuts")).toMatchObject({
            shortcuts: ["?"],
            contexts: ["canvas"],
            release: null,
        });
    });

    it("Preferences has no key: DESIGN §10.3 lists none", () => {
        expect(command("edit.preferences").shortcuts).toEqual([]);
    });

    it("Ctrl+K reaches the palette everywhere but under a menu or a dialog", () => {
        const resolved = (overrides: Partial<KeyEnvironment>) =>
            resolveKey(appCommands, "Ctrl+K", environment(overrides));
        const palette = command("edit.commandPalette");
        expect(resolved({})).toMatchObject({ action: "run", command: palette });
        expect(resolved({ focus: "none" })).toMatchObject({ action: "run", command: palette });
        expect(resolved({ focus: "control" })).toMatchObject({ action: "run", command: palette });
        expect(resolved({ focus: "text" })).toMatchObject({
            action: "run",
            command: palette,
            context: "text",
        });
        expect(resolved({ inPanel: true, focus: "control" })).toMatchObject({ action: "run" });
        // Bound but not acting: Chrome's own Ctrl+K is suppressed.
        expect(resolved({ overlayOpen: true })).toEqual({ action: "suppress" });
        expect(resolved({ overlayOpen: true, focus: "text" })).toEqual({ action: "suppress" });
    });

    it("? reaches the shortcut sheet in the canvas context, and is typed in a text field", () => {
        const resolved = (overrides: Partial<KeyEnvironment>) =>
            resolveKey(appCommands, "?", environment(overrides));
        const sheet = command("edit.shortcuts");
        expect(resolved({})).toMatchObject({ action: "run", command: sheet, context: "canvas" });
        expect(resolved({ focus: "none" })).toMatchObject({ action: "run", command: sheet });
        expect(resolved({ focus: "control" })).toMatchObject({ action: "run", command: sheet });
        expect(resolved({ inPanel: true, focus: "control" })).toMatchObject({
            action: "run",
            command: sheet,
        });
        // The field types the character; a select uses it for typeahead; a dialog keeps it.
        expect(resolved({ focus: "text" })).toEqual({ action: "pass" });
        expect(resolved({ focus: "control", typeahead: true })).toEqual({ action: "pass" });
        expect(resolved({ overlayOpen: true })).toEqual({ action: "pass" });
    });

    it("each command opens its surface", () => {
        for (const id of SURFACE_IDS) {
            surfaces.close();
            expect(surfaces.store.getState().open).toBeNull();
            void command(COMMANDS[id]).run();
            expect(surfaces.store.getState().open, id).toBe(id);
        }
    });
});

describe("the palette over the app's registry", () => {
    it("lists every command, in menu order, and finds one by a fuzzy query", () => {
        const all = paletteEntries(appCommands.list(), [], "");
        expect(all.map((entry) => entry.command.id).sort()).toEqual(
            appCommands
                .list()
                .map((entry) => entry.id)
                .sort(),
        );
        expect(all[0]?.command.id).toBe("file.newProject");
        expect(fuzzyScore("cmdpal", "Command Palette…")).not.toBeNull();
        const found = paletteEntries(appCommands.list(), [], "cmdpal");
        expect(found[0]?.command.id).toBe("edit.commandPalette");
        expect(found[0]).toMatchObject({ title: "Command Palette…", group: "Edit" });
    });

    it("puts recent commands first and records a run", () => {
        const recent = createRecentCommandsStore(null);
        expect(runPaletteCommand(command("edit.shortcuts"), () => {}, recent.getState())).toBe(
            true,
        );
        expect(surfaces.store.getState().open).toBe("shortcut-sheet");
        expect(recent.getState().ids).toEqual(["edit.shortcuts"]);
        const rows = paletteEntries(appCommands.list(), recent.getState().ids, "");
        expect(rows[0]?.command.id).toBe("edit.shortcuts");
    });

    it("keeps at most eight recent commands, each once, and reads bad records as empty", () => {
        const store = createRecentCommandsStore(null);
        for (let index = 0; index < 12; index++) store.getState().record(`command-${index}`);
        store.getState().record("command-11");
        expect(MAX_RECENT_COMMANDS).toBe(8);
        expect(store.getState().ids).toHaveLength(8);
        expect(store.getState().ids[0]).toBe("command-11");
        for (const stored of [undefined, null, 7, "edit.undo", {}, { ids: ["a"] }]) {
            expect(parseRecentCommands(stored)).toEqual([]);
        }
        expect(parseRecentCommands(["a", 3, null, "", "b", "a"])).toEqual(["a", "b"]);
    });
});

describe("the shortcut sheet over the app's registry", () => {
    const bindings = (registry: CommandRegistry) =>
        registry
            .list()
            .flatMap((entry) => entry.shortcuts.map((chord) => `${entry.id} ${chord}`))
            .sort();

    it("lists exactly the registry's shortcuts, grouped by menu in menu-bar order", () => {
        const groups = shortcutGroups(appCommands.list());
        const listed = groups
            .flatMap((group) =>
                group.rows.flatMap((row) =>
                    row.chords.map((chord) => `${row.command.id} ${chord}`),
                ),
            )
            .sort();
        expect(listed).toEqual(bindings(appCommands));
        expect(listed).toEqual(
            expect.arrayContaining([
                "edit.undo Ctrl+Z",
                "edit.redo Ctrl+Y",
                "edit.redo Ctrl+Shift+Z",
                "focus.nextRegion F6",
                "view.bottomPanel Tab",
                "edit.commandPalette Ctrl+K",
                "edit.shortcuts ?",
            ]),
        );
        const titles = groups.map((group) => group.title);
        expect(titles.slice(0, 2)).toEqual(["Edit", "View"]);
        // Commands with a key and no menu item (the zoom keys, the pan hold) share the last group.
        expect(titles.indexOf(OTHER_SHORTCUTS)).toBe(titles.length - 1);
        const edit = groups.find((group) => group.title === "Edit");
        expect(edit?.rows.map((row) => row.command.id)).toEqual([
            "edit.undo",
            "edit.redo",
            "edit.commandPalette",
            "edit.shortcuts",
        ]);
    });

    it("follows a registry: a command registered later is on the sheet, a removed one is not", () => {
        const own = registryOf(spec("edit.undo", { shortcut: "Ctrl+Z", menuPath: ["Edit"] }));
        const sheet = () =>
            shortcutGroups(own.list()).flatMap((group) =>
                group.rows.map(
                    (row) => `${group.title}: ${row.command.id} ${row.chords.join(",")}`,
                ),
            );
        expect(sheet()).toEqual(["Edit: edit.undo Ctrl+Z"]);
        const remove = own.register(
            spec("tool.hand", { shortcut: "Space", context: "canvas", release() {} }),
        );
        expect(sheet()).toEqual(["Edit: edit.undo Ctrl+Z", `${OTHER_SHORTCUTS}: tool.hand Space`]);
        expect(shortcutGroups(own.list()).at(-1)?.rows[0]?.hold).toBe(true);
        remove();
        expect(sheet()).toEqual(["Edit: edit.undo Ctrl+Z"]);
    });
});
