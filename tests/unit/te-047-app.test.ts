import { describe, expect, it } from "vitest";
import {
    clipboardStore,
    copyCellsToClipboard,
    copyMarkersToClipboard,
} from "../../src/app/clipboard/clipboard";
import { appCommands } from "../../src/app/commands/appCommands";
import { isProjectFileName, projectFileName } from "../../src/app/file/fileName";
import { RECENT_FILES_LIMIT, createRecentFiles } from "../../src/app/file/recentFiles";
import type { RecentFileStorage } from "../../src/app/file/recentFiles";
import type { ProjectFileHandle } from "../../src/app/platform/projectFiles";
import { createSessionStore, sessionStore } from "../../src/app/state/session";
import { createProject, createProjectSession } from "../../src/core/model";

// TE-047 in the app: the empty state of the session store and the commands it leaves enabled,
// the clipboard emptied when another project takes the window, the recent files (10, newest
// first) and the default file name.

describe("te-047 empty state", () => {
    it("the app starts with no project open, and the store opens and closes one", () => {
        const store = createSessionStore(null);
        expect(store.getState().open).toBe(false);
        store.getState().replace(createProjectSession(createProject({ name: "A" })));
        expect(store.getState().open).toBe(true);
        expect(store.getState().session.project.name).toBe("A");
        const revision = store.getState().revision;
        store.getState().close();
        expect(store.getState().open).toBe(false);
        expect(store.getState().revision).toBe(revision + 1);
        expect(store.getState().history.undoCount).toBe(0);
        // A store given a session starts open, as tests make them.
        expect(createSessionStore(createProjectSession(createProject())).getState().open).toBe(
            true,
        );
    });

    it("leaves only the commands that open a project or belong to the window enabled", () => {
        sessionStore.getState().close();
        const enabled = appCommands
            .list()
            .filter((command) => command.enabled())
            .map((command) => command.id)
            .sort();
        expect(enabled).toEqual([
            "app.licences",
            "edit.commandPalette",
            "edit.preferences",
            "edit.shortcuts",
            "file.importTiledMap",
            "file.newProject",
            "file.open",
            "focus.nextRegion",
            "focus.previousRegion",
            "view.bottomPanel",
        ]);
        sessionStore.getState().replace(createProjectSession(createProject()));
        const open = appCommands.list().filter((command) => command.enabled());
        expect(open.map((command) => command.id)).toEqual(
            expect.arrayContaining([
                "file.save",
                "file.saveAs",
                "file.closeProject",
                "file.newMap",
            ]),
        );
        // Revert needs a file.
        expect(appCommands.get("file.revert")!.enabled()).toBe(false);
    });
});

describe("te-047 clipboard", () => {
    it("is emptied when another project takes the window, and when it closes", () => {
        sessionStore.getState().replace(createProjectSession(createProject()));
        copyCellsToClipboard({ width: 1, height: 1, cells: Uint32Array.of(0x0100_0001) });
        expect(clipboardStore.getState().content).not.toBeNull();
        sessionStore.getState().replace(createProjectSession(createProject()));
        expect(clipboardStore.getState()).toEqual({ content: null, markers: null });

        copyMarkersToClipboard([
            { id: 1, shape: "point", x: 1, y: 2, name: "", class: "", properties: [] },
        ] as never);
        expect(clipboardStore.getState().markers).toHaveLength(1);
        sessionStore.getState().close();
        expect(clipboardStore.getState()).toEqual({ content: null, markers: null });
    });

    it("keeps its content through edits of the same project", () => {
        sessionStore.getState().replace(createProjectSession(createProject()));
        copyCellsToClipboard({ width: 1, height: 1, cells: Uint32Array.of(0x0100_0001) });
        sessionStore.getState().touch();
        expect(clipboardStore.getState().content).not.toBeNull();
    });
});

describe("te-047 recent files", () => {
    const memory = (): RecentFileStorage & { kept: unknown[] | null } => {
        const storage = {
            kept: null as unknown[] | null,
            load: async () => storage.kept,
            save: async (stored: readonly unknown[]) => {
                storage.kept = [...stored];
            },
        };
        return storage;
    };
    const handle = (name: string): ProjectFileHandle => ({
        name,
        stored: { name },
        isSame: async (other) => other.name === name,
        read: async () => new Uint8Array(),
        requestRead: async () => true,
        requestWrite: async () => true,
        write: async () => {},
    });
    const fromStored = (stored: unknown) => handle((stored as { name: string }).name);

    it("lists up to 10 files, newest first; a file listed again moves up", async () => {
        const storage = memory();
        const recent = createRecentFiles({ storage, handleFrom: fromStored });
        for (let index = 1; index <= 12; index++) await recent.add(handle(`f${index}.ngtilemap`));
        const names = () => recent.store.getState().entries.map((entry) => entry.name);
        expect(RECENT_FILES_LIMIT).toBe(10);
        expect(names()).toHaveLength(10);
        expect(names()[0]).toBe("f12.ngtilemap");
        expect(names().at(-1)).toBe("f3.ngtilemap");
        await recent.add(handle("f5.ngtilemap"));
        expect(names().slice(0, 2)).toEqual(["f5.ngtilemap", "f12.ngtilemap"]);
        expect(names()).toHaveLength(10);

        // Kept: a new list over the same storage reads them back in order.
        const again = createRecentFiles({ storage, handleFrom: fromStored });
        await again.load();
        expect(again.store.getState().entries.map((entry) => entry.name)).toEqual(names());

        const [first] = recent.store.getState().entries;
        await recent.remove(first!.key);
        expect(names()[0]).toBe("f12.ngtilemap");
        await recent.clear();
        expect(names()).toEqual([]);
    });
});

describe("te-047 file name", () => {
    it("is the project's name, sanitised, with .ngtilemap", () => {
        expect(projectFileName("World")).toBe("World.ngtilemap");
        expect(projectFileName("a/b:c?")).toBe("a_b_c_.ngtilemap");
        expect(projectFileName("World.ngtilemap")).toBe("World.ngtilemap");
        expect(projectFileName("  ...  ")).toBe("Untitled.ngtilemap");
        expect(projectFileName("con")).toBe("_con.ngtilemap");
        expect(isProjectFileName("X.NGTILEMAP")).toBe(true);
        expect(isProjectFileName("x.ngsprite")).toBe(false);
    });
});
