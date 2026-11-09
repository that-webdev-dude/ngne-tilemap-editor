import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors, region } from "./te-003-support";
import {
    addLayer,
    arrangePickers,
    saveDialog,
    emptyState,
    infoToast,
    newProject,
    openEmpty,
    projectName,
    projectState,
    stubPickers,
    unsavedMarker,
} from "./te-047-support";
import {
    acceptUnload,
    autosaveContents,
    dialogFocused,
    expectNoSnapshot,
    recoveryDialog,
    recoveryEntry,
    recoveryOffered,
    waitForLockReleased,
    waitForSnapshot,
} from "./te-048-support";

// TE-048: autosave, recovery and session state as the user meets them (SPEC §10.1, DESIGN §9
// Recovery): a project edited and left unsaved comes back in the next window, dirty; a second
// window does not offer the first window's live snapshot; a saved project leaves nothing; a
// one-map edit rewrites that map only; Discard removes a snapshot for good; a project opened
// again shows the tabs, active map, views and active layers it had.

/**
 * Starts a command of the app by ID, as its menu item or shortcut would, without waiting for
 * what it may still ask (Close Project's question).
 */
function run(page: Page, id: string): Promise<void> {
    return page.evaluate((id) => {
        void window.__ngneTest!.commands.get(id)!.run();
    }, id);
}

/** Opens a new page of the editor in `page`'s context, once `owner`'s page has let go. */
async function nextWindow(page: Page, owner: string): Promise<Page> {
    const next = await page.context().newPage();
    acceptUnload(next);
    await next.goto("/tests/e2e/harness/te-001-smoke.html");
    await waitForLockReleased(next, owner);
    await openEmpty(next);
    return next;
}

test("edits, then a closed page without saving: the next launch offers recovery, and recovering gives the edited project, dirty", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEmpty(page);
    expect(await recoveryOffered(page)).toBe(0);
    await newProject(page, "Harbour", { width: 24, height: 16 });
    await addLayer(page);
    await addLayer(page);
    const before = await projectState(page);
    expect(before.dirty).toBe(true);
    // The snapshot of the project as it is now: taken after the last edit.
    const edited = await page.evaluate(() => Date.now());
    const snapshot = await waitForSnapshot(page, (each) => each.savedAt >= edited);
    expect(snapshot).toMatchObject({ name: "Harbour", projectId: before.id });
    // One map, 24 × 16 cells of 16 px: a thumbnail of 128 × 85.
    expect(snapshot.thumbnails).toEqual([
        { mapId: snapshot.mapIds[0], name: before.maps[0]!.name, width: 128, height: 85 },
    ]);

    // The window goes as in a crash: no unload question.
    await page.close({ runBeforeUnload: false });
    const next = await nextWindow(page, snapshot.owner);
    const nextErrors = collectErrors(next);
    expect(await recoveryOffered(next)).toBe(1);
    const dialog = recoveryDialog(next);
    await expect(dialog).toBeVisible();
    await dialogFocused(dialog);
    const entry = recoveryEntry(next, "Harbour");
    await expect(entry).toContainText("1 map");
    await expect(entry.locator("time")).toHaveAttribute(
        "datetime",
        new Date(snapshot.savedAt).toISOString(),
    );
    const thumbnail = entry.locator("[data-recovery-thumbnail]");
    await expect(thumbnail).toHaveAttribute("width", "128");
    await expect(thumbnail).toHaveAttribute("height", "85");

    await entry.getByRole("button", { name: "Recover" }).click();
    await expect(dialog).toBeHidden();
    await expect(infoToast(next, "Recovered Harbour")).toBeVisible();
    await expect(projectName(next)).toHaveText("Harbour");
    // The edited project, with an empty history, unsaved until it is saved.
    expect(await projectState(next)).toEqual({ ...before, undo: 0 });
    await expect(unsavedMarker(next)).toBeVisible();
    // The snapshot is this window's now, under the same key.
    const kept = await waitForSnapshot(next, (each) => each.key === snapshot.key);
    expect(kept.owner).not.toBe(snapshot.owner);
    expect(errors).toEqual([]);
    expect(nextErrors).toEqual([]);
});

test("a second open window does not offer the first window's live snapshot; once that window is gone, it does", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEmpty(page);
    await newProject(page, "Live");
    await addLayer(page);
    const snapshot = await waitForSnapshot(page);

    const second = await page.context().newPage();
    acceptUnload(second);
    await openEmpty(second);
    expect(await recoveryOffered(second)).toBe(0);
    await expect(recoveryDialog(second)).toHaveCount(0);
    await expect(emptyState(second)).toBeVisible();

    await page.close({ runBeforeUnload: false });
    await waitForLockReleased(second, snapshot.owner);
    await second.reload();
    expect(await recoveryOffered(second)).toBe(1);
    await expect(recoveryEntry(second, "Live")).toBeVisible();
    expect(errors).toEqual([]);
});

test("a saved project leaves no snapshot; a one-map edit rewrites that map's entry only", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await stubPickers(page);
    await openEmpty(page);
    await newProject(page, "Two maps");
    await run(page, "map.duplicate");
    await expect.poll(async () => (await projectState(page)).maps.length).toBe(2);
    const first = await waitForSnapshot(page, (each) => each.mapIds.length === 2);
    const [mapA, mapB] = first.mapIds as [string, string];
    const all = await autosaveContents(page);
    expect(all.entries).toEqual(
        [
            `${first.key}/maps/${mapA}.json`,
            `${first.key}/maps/${mapB}.json`,
            `${first.key}/project.json`,
        ].sort(),
    );

    // Saved: the snapshot goes.
    await arrangePickers(page, { nextSave: ["two-maps.ngtilemap"] });
    await page.keyboard.press("Control+KeyS");
    await expect(infoToast(page, "Saved two-maps.ngtilemap")).toBeVisible();
    await expect(unsavedMarker(page)).toHaveCount(0);
    await expectNoSnapshot(page);

    // An edit of the active map (the duplicate): a snapshot of the whole project first ...
    await addLayer(page);
    const second = await waitForSnapshot(page);
    // ... then, after another edit of that map only, its entry is rewritten and the other's kept.
    const records = () =>
        page.evaluate(async (key) => {
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const opening = indexedDB.open("ngne-tilemap-editor-autosave");
                opening.onsuccess = () => resolve(opening.result);
                opening.onerror = () => reject(opening.error);
            });
            // One transaction, every request made at once: it stays active until they answer.
            const store = db.transaction("entries", "readonly").objectStore("entries");
            const range = IDBKeyRange.bound([key], [key, []]);
            const ask = <T>(request: IDBRequest<T>) =>
                new Promise<T>((resolve, reject) => {
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
            const [keys, values] = await Promise.all([
                ask(store.getAllKeys(range)),
                ask(store.getAll(range)),
            ]);
            db.close();
            const out: Record<string, number[]> = {};
            keys.forEach((each, index) => {
                const name = (each as string[])[1]!;
                const id = /^maps\/(.+)\.json$/.exec(name)?.[1];
                if (id) out[id] = Array.from(values[index] as Uint8Array);
            });
            return out;
        }, second.key);
    const before = await records();
    await addLayer(page);
    await waitForSnapshot(page, (each) => each.savedAt > second.savedAt);
    const after = await records();
    const active = await page.evaluate(
        () => window.__ngneTest!.session.getState().session.activeMapId,
    );
    const other = second.mapIds.find((id) => id !== active)!;
    expect(after[other]).toEqual(before[other]);
    expect(after[active]).not.toEqual(before[active]);
    expect(errors).toEqual([]);
});

test("Discard asks once in its row and removes the snapshot permanently; closing a dirty project without saving removes its snapshot", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEmpty(page);
    await newProject(page, "Scratch");
    await addLayer(page);
    const snapshot = await waitForSnapshot(page);
    await page.close({ runBeforeUnload: false });

    const next = await nextWindow(page, snapshot.owner);
    expect(await recoveryOffered(next)).toBe(1);
    const dialog = recoveryDialog(next);
    await dialogFocused(dialog);
    const entry = recoveryEntry(next, "Scratch");
    await entry.getByRole("button", { name: "Discard" }).click();
    await expect(entry).toContainText("Discard permanently?");
    await expect(entry.getByRole("button", { name: "Cancel" })).toBeFocused();
    await entry.getByRole("button", { name: "Cancel" }).click();
    await expect(entry.getByRole("button", { name: "Recover" })).toBeFocused();
    expect((await autosaveContents(next)).snapshots).toHaveLength(1);
    await entry.getByRole("button", { name: "Discard" }).click();
    await entry.getByRole("button", { name: "Discard" }).click();
    await expect(dialog).toBeHidden();
    await expectNoSnapshot(next);
    await expect(emptyState(next)).toBeVisible();

    // Close Project, Discard: the project's file holds nothing of it, and nor does autosave.
    await newProject(next, "Thrown away");
    await addLayer(next);
    await waitForSnapshot(next);
    await run(next, "file.closeProject");
    await saveDialog(next).getByRole("button", { name: "Discard" }).click();
    await expect(emptyState(next)).toBeVisible();
    await expectNoSnapshot(next);
    expect(errors).toEqual([]);
});

test("reopening a project restores its tabs, active map, views and active layers", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await stubPickers(page);
    await openEmpty(page);
    await newProject(page, "Atlas");
    await run(page, "map.duplicate");
    await addLayer(page);
    await arrangePickers(page, { nextSave: ["atlas.ngtilemap"] });
    await page.keyboard.press("Control+KeyS");
    await expect(infoToast(page, "Saved atlas.ngtilemap")).toBeVisible();

    // Both tabs open, the second map active with its bottom layer active and zoomed in; the
    // first map zoomed out.
    const shown = () =>
        page.evaluate(() => {
            const { session } = window.__ngneTest!.session.getState();
            const tabs = [...document.querySelectorAll("[data-map-tab]")].map(
                (tab) => (tab as HTMLElement).dataset.mapTab,
            );
            return {
                tabs,
                active: session.activeMapId,
                maps: Object.fromEntries(
                    [...session.perMap].map(([id, each]) => [
                        id,
                        { layer: each.activeLayerId, zoom: each.view.zoom },
                    ]),
                ),
            };
        });
    await run(page, "map.previous");
    await run(page, "view.zoomOut");
    await run(page, "map.next");
    await run(page, "view.zoomIn");
    await run(page, "view.zoomIn");
    await run(page, "layer.selectBelow");
    const before = await shown();
    expect(before.tabs).toHaveLength(2);
    expect(Object.keys(before.maps)).toHaveLength(2);

    await run(page, "file.closeProject");
    await expect(emptyState(page)).toBeVisible();
    await arrangePickers(page, { nextOpen: ["atlas.ngtilemap"] });
    await page.keyboard.press("Control+KeyO");
    await expect(infoToast(page, "Opened atlas.ngtilemap")).toBeVisible();
    await expect.poll(shown).toEqual(before);
    await expect(region(page, "viewport")).toBeVisible();
    expect(errors).toEqual([]);
});
