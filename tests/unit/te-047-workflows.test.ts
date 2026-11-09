import { describe, expect, it } from "vitest";
import { MAX_PROJECT_FILE_BYTES, revertedSession } from "../../src/app/file/workflows";
import { createProjectSession } from "../../src/core/model";
import { deserialize, serialize } from "../../src/core/project";
import { chosen, edit, project, setup } from "./te-047-support";

// TE-047: the file workflows of SPEC §10.1 on the one project of the window. Save, Save As,
// the download fallback, Open with the Save / Discard / Cancel question while dirty, Revert,
// Close Project and New Project, against a disk in memory and the codec of `core/project`.

const NEW_VALUES = {
    name: "Second",
    map: { name: "Start", width: 12, height: 10, tileWidth: 8, tileHeight: 8 },
};

describe("te-047 save", () => {
    it("saves a project without a file to the file the picker chose, named after the project", async () => {
        const t = setup(project("My: World"));
        edit(t.sessions);
        const handle = t.disk.handle("world.ngtilemap");
        t.platform.toSave.push(handle);
        expect(t.sessions.getState().history.dirty).toBe(true);

        expect(await t.workflows.save()).toBe(true);
        expect(t.platform.suggested).toEqual(["My_ World.ngtilemap"]);
        expect(t.sessions.getState().history.dirty).toBe(false);
        expect(t.workflows.file()).toMatchObject({ name: "world.ngtilemap", handle });
        expect(t.infos).toEqual(["Saved world.ngtilemap"]);
        expect(t.recent).toEqual([handle]);
        const reopened = await deserialize(t.disk.files.get("world.ngtilemap")!);
        expect(reopened.maps[0]!.name).toBe("Edited");
        expect(reopened.id).toBe(t.sessions.getState().session.project.id);

        // Saved again: written to its file without a picker.
        edit(t.sessions, "Again");
        expect(await t.workflows.save()).toBe(true);
        expect(t.platform.suggested).toHaveLength(1);
        expect(handle.writes).toHaveLength(2);
    });

    it("keeps the project dirty when it changes while the file is written", async () => {
        const t = setup();
        const handle = t.disk.handle("a.ngtilemap");
        let release!: () => void;
        handle.hold = new Promise((resolve) => (release = resolve));
        t.platform.toSave.push(handle);
        const saving = t.workflows.save();
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
        edit(t.sessions);
        release();
        expect(await saving).toBe(true);
        expect(t.sessions.getState().history.dirty).toBe(true);
        expect((await deserialize(t.disk.files.get("a.ngtilemap")!)).maps[0]!.name).toBe("Map 1");
    });

    it("Save As makes the chosen file the project's, under a new ID for another file", async () => {
        const t = setup();
        const first = t.disk.handle("a.ngtilemap");
        t.platform.toSave.push(first);
        await t.workflows.save();
        const id = t.sessions.getState().session.project.id;
        const copy = t.disk.handle("b.ngtilemap");
        t.platform.toSave.push(copy);
        expect(await t.workflows.saveAs()).toBe(true);
        expect(t.platform.suggested).toEqual(["World.ngtilemap", "a.ngtilemap"]);
        expect(t.workflows.file()?.handle).toBe(copy);
        const newId = t.sessions.getState().session.project.id;
        expect(newId).not.toBe(id);
        expect((await deserialize(t.disk.files.get("b.ngtilemap")!)).id).toBe(newId);
        expect((await deserialize(t.disk.files.get("a.ngtilemap")!)).id).toBe(id);

        // Onto its own file: the ID stays.
        t.platform.toSave.push(t.disk.handle("b.ngtilemap"));
        expect(await t.workflows.saveAs()).toBe(true);
        expect(t.sessions.getState().session.project.id).toBe(newId);
    });

    it("downloads without File System Access, and the project counts as saved", async () => {
        const t = setup(project("Hero"));
        t.platform.access = false;
        edit(t.sessions);
        expect(await t.workflows.save()).toBe(true);
        expect(t.platform.downloads.map((download) => download.name)).toEqual(["Hero.ngtilemap"]);
        expect(t.sessions.getState().history.dirty).toBe(false);
        expect(t.workflows.file()).toMatchObject({ name: "Hero.ngtilemap", handle: null });
        expect(t.recent).toEqual([]);
        expect(await t.workflows.saveAs()).toBe(true);
        expect(t.platform.downloads).toHaveLength(2);
    });

    it("reports a failed write and leaves the project dirty", async () => {
        const t = setup();
        const handle = t.disk.handle("a.ngtilemap");
        handle.failWrite = new DOMException("Disk full", "QuotaExceededError");
        t.platform.toSave.push(handle);
        edit(t.sessions);
        expect(await t.workflows.save()).toBe(false);
        expect(t.errors).toEqual(["Could not save “a.ngtilemap”. Disk full"]);
        expect(t.sessions.getState().history.dirty).toBe(true);
        expect(t.workflows.file()).toBeNull();
    });

    it("does nothing on the empty state", async () => {
        const t = setup(null);
        expect(t.workflows.canSave()).toBe(false);
        expect(await t.workflows.save()).toBe(false);
        expect(t.platform.suggested).toEqual([]);
    });
});

describe("te-047 open", () => {
    const fileOf = (name: string) => serialize(project(name, name));

    it("opens a file in place of a clean project, with a fresh history and no question", async () => {
        const t = setup();
        const bytes = fileOf("Other");
        t.disk.files.set("other.ngtilemap", bytes);
        const handle = t.disk.handle("other.ngtilemap");
        t.platform.toOpen.push(chosen("other.ngtilemap", bytes, handle));
        expect(await t.workflows.open()).toBe(true);
        const state = t.sessions.getState();
        expect(state.open).toBe(true);
        expect(state.session.project.name).toBe("Other");
        expect(state.history.undoCount).toBe(0);
        expect(state.history.dirty).toBe(false);
        expect(t.dialogs.asked).toEqual([]);
        expect(t.infos).toEqual(["Opened other.ngtilemap"]);
        expect(t.recent).toEqual([handle]);
        expect(t.workflows.file()).toMatchObject({ name: "other.ngtilemap", handle });
    });

    it("asks Save / Discard / Cancel while dirty, and each choice does as it says", async () => {
        const bytes = fileOf("Other");
        // Cancel: the project stays, nothing is written.
        const cancel = setup();
        edit(cancel.sessions);
        cancel.dialogs.saveAnswers.push(null);
        expect(await cancel.workflows.openFiles([chosen("o.ngtilemap", bytes, null)])).toBe(false);
        expect(cancel.dialogs.asked).toEqual([
            { kind: "save-changes", project: "World", action: "open", file: "o.ngtilemap" },
        ]);
        expect(cancel.sessions.getState().session.project.name).toBe("World");
        expect(cancel.sessions.getState().history.dirty).toBe(true);

        // Discard: the file opens, the changes are gone.
        const discard = setup();
        edit(discard.sessions);
        discard.dialogs.saveAnswers.push("discard");
        expect(await discard.workflows.openFiles([chosen("o.ngtilemap", bytes, null)])).toBe(true);
        expect(discard.sessions.getState().session.project.name).toBe("Other");
        expect(discard.platform.suggested).toEqual([]);

        // Save: the project is saved first, then the file opens.
        const save = setup();
        edit(save.sessions);
        save.dialogs.saveAnswers.push("save");
        save.platform.toSave.push(save.disk.handle("world.ngtilemap"));
        expect(await save.workflows.openFiles([chosen("o.ngtilemap", bytes, null)])).toBe(true);
        expect(save.infos).toEqual(["Saved world.ngtilemap", "Opened o.ngtilemap"]);
        const written = await deserialize(save.disk.files.get("world.ngtilemap")!);
        expect(written.maps[0]!.name).toBe("Edited");
        expect(save.sessions.getState().session.project.name).toBe("Other");

        // Save whose picker is cancelled: nothing opens.
        const abandoned = setup();
        edit(abandoned.sessions);
        abandoned.dialogs.saveAnswers.push("save");
        expect(await abandoned.workflows.openFiles([chosen("o.ngtilemap", bytes, null)])).toBe(
            false,
        );
        expect(abandoned.sessions.getState().session.project.name).toBe("World");
    });

    it("reports a file that cannot be opened and changes nothing, asking nothing", async () => {
        const t = setup();
        edit(t.sessions);
        const bad = Uint8Array.from([1, 2, 3]);
        expect(await t.workflows.openFiles([chosen("bad.ngtilemap", bad, null)])).toBe(false);
        expect(t.errors).toHaveLength(1);
        expect(t.errors[0]).toMatch(/^Could not open “bad\.ngtilemap”\. /);
        expect(t.dialogs.asked).toEqual([]);
        expect(t.sessions.getState().session.project.name).toBe("World");

        const huge = { ...chosen("huge.ngtilemap", bad, null), size: MAX_PROJECT_FILE_BYTES + 1 };
        expect(await t.workflows.openFiles([huge])).toBe(false);
        expect(t.errors[1]).toMatch(/too large to be a tilemap project/);
    });

    it("opens the first project file of a drop and reports a drop without one", async () => {
        const t = setup(null);
        const bytes = fileOf("Dropped");
        expect(
            await t.workflows.openFiles([
                chosen("notes.txt", bytes, null),
                chosen("MAP.NGTILEMAP", bytes, null),
            ]),
        ).toBe(true);
        expect(t.sessions.getState().session.project.name).toBe("Dropped");
        expect(await t.workflows.openFiles([chosen("tiles.png", bytes, null)])).toBe(false);
        expect(t.errors).toEqual(["“tiles.png” is not a tilemap project (.ngtilemap)."]);
    });

    it("says a file is open already when it is the project's own", async () => {
        const t = setup();
        const handle = t.disk.handle("a.ngtilemap");
        t.platform.toSave.push(handle);
        await t.workflows.save();
        const project = t.sessions.getState().session.project;
        t.platform.toOpen.push(chosen("a.ngtilemap", t.disk.files.get("a.ngtilemap")!, handle));
        expect(await t.workflows.open()).toBe(true);
        expect(t.infos.at(-1)).toBe("a.ngtilemap is open already");
        expect(t.sessions.getState().session.project).toBe(project);
    });
});

describe("te-047 revert, close and new project", () => {
    it("Revert reads the file again after Discard, keeping the views of its maps", async () => {
        const t = setup();
        t.platform.toSave.push(t.disk.handle("a.ngtilemap"));
        await t.workflows.save();
        const before = t.sessions.getState().session;
        before.perMap.get(before.activeMapId)!.view.zoom = 4;
        edit(t.sessions);

        t.dialogs.discardAnswers.push(false);
        expect(await t.workflows.revert()).toBe(false);
        expect(t.sessions.getState().session.project.maps[0]!.name).toBe("Edited");

        t.dialogs.discardAnswers.push(true);
        expect(await t.workflows.revert()).toBe(true);
        const after = t.sessions.getState();
        expect(after.session.project.maps[0]!.name).toBe("Map 1");
        expect(after.history.dirty).toBe(false);
        expect(after.history.undoCount).toBe(0);
        expect(after.session.perMap.get(after.session.activeMapId)!.view.zoom).toBe(4);
        expect(t.infos.at(-1)).toBe("Reverted to a.ngtilemap");
        expect(t.dialogs.asked.map((question) => question.kind)).toEqual([
            "discard-changes",
            "discard-changes",
        ]);
    });

    it("Revert needs a file, and reads the downloaded bytes without File System Access", async () => {
        const t = setup();
        expect(await t.workflows.revert()).toBe(false);
        t.platform.access = false;
        await t.workflows.save();
        edit(t.sessions);
        t.dialogs.discardAnswers.push(true);
        expect(await t.workflows.revert()).toBe(true);
        expect(t.sessions.getState().session.project.maps[0]!.name).toBe("Map 1");
    });

    it("Close Project asks while dirty and returns to the empty state", async () => {
        const t = setup();
        edit(t.sessions);
        t.dialogs.saveAnswers.push(null);
        expect(await t.workflows.close()).toBe(false);
        expect(t.sessions.getState().open).toBe(true);
        t.dialogs.saveAnswers.push("discard");
        expect(await t.workflows.close()).toBe(true);
        expect(t.sessions.getState().open).toBe(false);
        expect(t.workflows.file()).toBeNull();
        expect(t.workflows.canSave()).toBe(false);
        // A clean project closes without a question.
        const clean = setup();
        expect(await clean.workflows.close()).toBe(true);
        expect(clean.dialogs.asked).toEqual([]);
    });

    it("New Project asks for the values, then for the unsaved project, then replaces it", async () => {
        const t = setup();
        edit(t.sessions);
        t.dialogs.newProjectAnswers.push(null);
        expect(await t.workflows.newProject()).toBe(false);
        expect(t.dialogs.asked).toEqual([{ kind: "new-project" }]);

        t.dialogs.newProjectAnswers.push(NEW_VALUES);
        t.dialogs.saveAnswers.push("discard");
        expect(await t.workflows.newProject()).toBe(true);
        const { session, history, open } = t.sessions.getState();
        expect(open).toBe(true);
        expect(session.project.name).toBe("Second");
        expect(session.project.maps).toHaveLength(1);
        expect(session.project.maps[0]).toMatchObject(NEW_VALUES.map);
        expect(history.dirty).toBe(false);
        expect(t.fitted).toEqual([session.activeMapId]);
        expect(t.workflows.file()).toBeNull();
    });

    it("New Project and Open act on the empty state", async () => {
        const t = setup(null);
        expect(t.workflows.canAct()).toBe(true);
        t.dialogs.newProjectAnswers.push(NEW_VALUES);
        expect(await t.workflows.newProject()).toBe(true);
        expect(t.dialogs.asked).toEqual([{ kind: "new-project" }]);
    });

    it("runs one operation at a time", async () => {
        const t = setup();
        const handle = t.disk.handle("a.ngtilemap");
        let release!: () => void;
        handle.hold = new Promise((resolve) => (release = resolve));
        t.platform.toSave.push(handle);
        const saving = t.workflows.save();
        await Promise.resolve();
        expect(t.workflows.busy).toBe(true);
        expect(t.workflows.canAct()).toBe(false);
        expect(await t.workflows.close()).toBe(false);
        release();
        expect(await saving).toBe(true);
        expect(t.workflows.busy).toBe(false);
    });
});

describe("te-047 reverted session", () => {
    it("keeps the active map and its view when the map is still there", () => {
        const previous = createProjectSession(project());
        const id = previous.activeMapId;
        previous.perMap.get(id)!.view = { centreX: 3, centreY: 4, zoom: 2 };
        const again = project();
        const session = revertedSession(again, previous);
        expect(session.activeMapId).toBe(id);
        expect(session.perMap.get(id)!.view).toEqual({ centreX: 3, centreY: 4, zoom: 2 });
        const other = revertedSession(project("World", "q"), previous);
        expect(other.activeMapId).not.toBe(id);
    });
});
