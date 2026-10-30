import { expect, test } from "@playwright/test";
import { collectErrors } from "./te-003-support";
import { addTextField, openEditor, rename, snapshot } from "./te-007-support";

// TE-007: undo and redo from the keyboard in the real app, on a test command executed through
// the project's history. Adapted from the sprite editor's se-007-undo.spec.ts.

test("Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z undo and redo a test command", async ({ page }) => {
    const errors = collectErrors(page);
    await openEditor(page);
    expect(await snapshot(page)).toMatchObject({ name: "Untitled", canUndo: false });
    await rename(page, "first", "Stamp Brush");
    await rename(page, "second", "Eraser");
    expect(await snapshot(page)).toMatchObject({ name: "second", undoLabel: "Eraser" });

    await page.keyboard.press("Control+KeyZ");
    expect(await snapshot(page)).toMatchObject({
        name: "first",
        undoLabel: "Stamp Brush",
        redoLabel: "Eraser",
    });
    await page.keyboard.press("Control+KeyZ");
    expect(await snapshot(page)).toMatchObject({ name: "Untitled", canUndo: false });
    // Nothing left to undo: the key does nothing and nothing fails.
    await page.keyboard.press("Control+KeyZ");
    expect(await snapshot(page)).toMatchObject({ name: "Untitled", canUndo: false });

    await page.keyboard.press("Control+KeyY");
    expect(await snapshot(page)).toMatchObject({ name: "first", redoLabel: "Eraser" });
    await page.keyboard.press("Control+Shift+KeyZ");
    expect(await snapshot(page)).toMatchObject({ name: "second", canRedo: false });
    await page.keyboard.press("Control+KeyY");
    await page.keyboard.press("Control+Shift+KeyZ");
    expect(await snapshot(page)).toMatchObject({ name: "second", canRedo: false });

    // Both redo chords after one undo each.
    await page.keyboard.press("Control+KeyZ");
    await page.keyboard.press("Control+Shift+KeyZ");
    expect((await snapshot(page)).name).toBe("second");
    await page.keyboard.press("Control+KeyZ");
    await page.keyboard.press("Control+KeyY");
    expect((await snapshot(page)).name).toBe("second");

    await page.evaluate(() => window.__ngneTest!.assertInvariants());
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('typing "z" in a text field does not undo, and neither does Ctrl+Z there', async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    await rename(page, "first", "Stamp Brush");
    const before = await snapshot(page);

    const field = await addTextField(page, "context-bar");
    await field.click();
    await page.keyboard.press("KeyZ");
    await page.keyboard.press("Shift+KeyZ");
    await expect(field).toHaveValue("zZ");
    expect(await snapshot(page)).toEqual(before);

    // Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z belong to the field: they undo and redo its typing.
    await page.keyboard.press("Control+KeyZ");
    await expect(field).not.toHaveValue("zZ");
    expect(await snapshot(page)).toEqual(before);
    await page.keyboard.press("Control+KeyY");
    await expect(field).toHaveValue("zZ");
    await page.keyboard.press("Control+KeyZ");
    await page.keyboard.press("Control+Shift+KeyZ");
    await expect(field).toHaveValue("zZ");
    expect(await snapshot(page)).toEqual(before);

    // Outside the field the same keys act on the project again.
    await field.blur();
    await page.keyboard.press("KeyZ");
    await expect(field).toHaveValue("zZ");
    expect(await snapshot(page)).toEqual(before);
    await page.keyboard.press("Control+KeyZ");
    expect(await snapshot(page)).toMatchObject({ name: "Untitled", canUndo: false });
    await expect(field).toHaveValue("zZ");
    await page.keyboard.press("Control+KeyY");
    expect((await snapshot(page)).name).toBe("first");
    expect(errors).toEqual([]);
});

test("undo keys do nothing while a stroke is open", async ({ page }) => {
    const errors = collectErrors(page);
    await openEditor(page);
    await rename(page, "first", "Stamp Brush");
    // An open transaction: the history would throw on undo.
    await page.evaluate(() => {
        const { session, history } = window.__ngneTest!.session.getState();
        const mapId = session.activeMapId;
        const layerId = session.perMap.get(mapId)!.activeLayerId;
        history.begin({ mapId, layerId });
    });
    await page.keyboard.press("Control+KeyZ");
    expect((await snapshot(page)).name).toBe("first");

    await page.evaluate(() => {
        window.__ngneTest!.session.getState().history.transaction?.abort();
    });
    await page.keyboard.press("Control+KeyZ");
    expect((await snapshot(page)).name).toBe("Untitled");
    // No error toast and nothing on the console.
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(errors).toEqual([]);
});
