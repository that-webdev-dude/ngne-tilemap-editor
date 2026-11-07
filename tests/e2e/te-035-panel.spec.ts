import { test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { Snapshot } from "./harness/te-035-page";
import { expect, openEditor } from "./te-013-support";
import { menuItem, openMenu } from "./te-007-support";

// TE-035: the Layers dock section (DESIGN §8.2). The page module (harness/te-035-page.ts) loads
// one map whose layers are, top first: Markers (5), Props (2, group: Trees 4, Rocks 3), Ground
// (1, active). Rows mirror the tree; the toggles and the properties popover make one history
// entry each; a drag reorders and moves into a group, one entry that undo takes back; the tree
// works from the keyboard alone; rows under a hidden or locked group are muted; the active row
// has the accent bar.

const PAGE_MODULE = "/tests/e2e/harness/te-035-page.ts";

function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

const snapshot = (page: Page) => call<Snapshot>(page, "snapshot");
const panel = (page: Page) => page.locator("[data-layers-panel]");
const rows = (page: Page) => panel(page).locator("[data-layer-row]");
const row = (page: Page, id: number) => page.locator(`[data-layer-row="${id}"]`);
const renameField = (page: Page) => panel(page).locator("[data-layer-rename]");
const popover = (page: Page) => page.locator("[data-layer-properties]");

async function load(page: Page): Promise<void> {
    await openEditor(page);
    await call(page, "load");
    await expect(rows(page)).toHaveCount(5);
}

/** What the rows show, top to bottom. */
function shown(page: Page) {
    return rows(page).evaluateAll((elements) =>
        elements.map((element) => ({
            id: Number(element.getAttribute("data-layer-row")),
            name: element.querySelector("[data-layer-name]")?.textContent ?? null,
            type: element.getAttribute("data-layer-type"),
            depth: Number(element.getAttribute("data-depth")),
            indent: parseFloat(getComputedStyle(element).paddingLeft),
            visible: element.querySelector("[data-layer-visible]")?.getAttribute("aria-pressed"),
            locked: element.querySelector("[data-layer-locked]")?.getAttribute("aria-pressed"),
            opacity: element.querySelector("[data-layer-opacity]")?.textContent ?? null,
            active: element.getAttribute("aria-selected") === "true",
            height: element.getBoundingClientRect().height,
        })),
    );
}

/** The rows the tree says there should be (every group expanded). */
function expected(state: Snapshot, base: number) {
    return state.layers.map((layer) => ({
        id: layer.id,
        name: layer.name,
        type: layer.type,
        depth: layer.depth,
        indent: base + 12 * layer.depth,
        visible: String(layer.visible),
        locked: String(layer.locked),
        opacity: String(layer.opacity),
        active: layer.id === state.active,
        height: 28,
    }));
}

async function expectRowsMirror(page: Page): Promise<Snapshot> {
    const state = await snapshot(page);
    const base = (await shown(page))[0]!.indent - 12 * state.layers[0]!.depth;
    await expect.poll(() => shown(page)).toEqual(expected(state, base));
    return state;
}

/** Drags `source` by the mouse until the pointer is at `y` (client pixels). */
async function dragTo(page: Page, source: Locator, y: number): Promise<void> {
    const box = (await source.boundingBox())!;
    const x = box.x + 60;
    const from = box.y + box.height / 2;
    await page.mouse.move(x, from);
    await page.mouse.down();
    for (let step = 1; step <= 8; step++) await page.mouse.move(x, from + ((y - from) * step) / 8);
    await page.mouse.up();
}

async function undoAll(page: Page, steps: number): Promise<void> {
    for (let k = 0; k < steps; k++) expect(await call<boolean>(page, "undo")).toBe(true);
}

test("rows mirror the tree through new, delete, undo and redo", async ({ page }) => {
    await load(page);
    let state = await expectRowsMirror(page);
    expect(state.tree).toBe("Ground,Props[Rocks,Trees],Markers");
    expect((await shown(page)).map((each) => each.name)).toEqual([
        "Markers",
        "Props",
        "Trees",
        "Rocks",
        "Ground",
    ]);

    // Header +: a tile layer above the active one, active.
    await page.locator("[data-new-layer]").click();
    state = await expectRowsMirror(page);
    expect(state.tree).toBe("Ground,Tile Layer 4,Props[Rocks,Trees],Markers");
    expect(state).toMatchObject({ undo: 1, undoLabel: "New Tile Layer", active: 6 });

    // The variant menu: a group, then a marker layer.
    await page.locator("[data-new-layer-menu]").click();
    await page.locator('[data-new-layer-kind="layer.newGroup"]').click();
    await page.locator("[data-new-layer-menu]").click();
    await expect(page.locator('[data-new-layer-kind="layer.newImage"]')).not.toHaveAttribute(
        "data-disabled",
    );
    await page.locator('[data-new-layer-kind="layer.newMarker"]').click();
    state = await expectRowsMirror(page);
    expect(state.tree).toBe(
        "Ground,Tile Layer 4,Group Layer 2[],Marker Layer 2,Props[Rocks,Trees],Markers",
    );
    expect(state.undo).toBe(3);

    // Header Delete removes the active layer; the row below takes its place.
    await page.locator("[data-delete-layer]").click();
    state = await expectRowsMirror(page);
    expect(state.tree).toBe("Ground,Tile Layer 4,Group Layer 2[],Props[Rocks,Trees],Markers");
    expect(state.undoLabel).toBe("Delete Layer");

    await undoAll(page, 4);
    state = await expectRowsMirror(page);
    expect(state.tree).toBe("Ground,Props[Rocks,Trees],Markers");
    expect(await call<boolean>(page, "redo")).toBe(true);
    state = await expectRowsMirror(page);
    expect(state.tree).toBe("Ground,Tile Layer 4,Props[Rocks,Trees],Markers");
});

test("a click makes a row active; the toggles are one entry each", async ({ page }) => {
    await load(page);
    await row(page, 3).click();
    let state = await expectRowsMirror(page);
    expect(state).toMatchObject({ active: 3, undo: 0 });

    // Eye and lock of Trees: one entry each, labelled as the layer command.
    await row(page, 4).locator("[data-layer-visible]").click();
    state = await expectRowsMirror(page);
    expect(state).toMatchObject({ undo: 1, undoLabel: "Hide Layer", active: 3 });
    await row(page, 4).locator("[data-layer-locked]").click();
    state = await expectRowsMirror(page);
    expect(state).toMatchObject({ undo: 2, undoLabel: "Lock Layer" });
    expect(state.layers.find((layer) => layer.id === 4)).toMatchObject({
        visible: false,
        locked: true,
    });

    // Ctrl+Z from the viewport takes them back one at a time.
    await page.locator("[data-viewport-focus]").focus();
    await page.keyboard.press("Control+z");
    state = await expectRowsMirror(page);
    expect(state).toMatchObject({ undo: 1, undoLabel: "Hide Layer" });
    await page.keyboard.press("Control+z");
    state = await expectRowsMirror(page);
    expect(state.layers.find((layer) => layer.id === 4)).toMatchObject({
        visible: true,
        locked: false,
    });
});

test("the properties popover applies its fields on close as one entry", async ({ page }) => {
    await load(page);
    // Opacity is shown on hover; below 255 it stays.
    const opacity = row(page, 3).locator("[data-layer-opacity]");
    await expect(opacity).toBeHidden();
    await row(page, 3).hover();
    await expect(opacity).toBeVisible();
    await opacity.click();
    await expect(popover(page)).toBeVisible();
    const field = (label: string) => popover(page).getByLabel(label, { exact: true });

    await popover(page).locator('[data-layer-field="name"]').fill("Boulders");
    await popover(page).locator('[data-layer-field="class"]').fill("solid");
    await field("Opacity").last().fill("128");
    await field("Offset X").fill("8");
    await field("Parallax Y").fill("0.5");
    // Nothing changes while the popover is open.
    expect((await snapshot(page)).undo).toBe(0);
    await field("Offset X").press("Enter");
    await expect(popover(page)).toBeHidden();
    let state = await expectRowsMirror(page);
    expect(state).toMatchObject({ undo: 1, undoLabel: "Layer Properties" });
    expect(state.layers.find((layer) => layer.id === 3)).toMatchObject({
        name: "Boulders",
        class: "solid",
        opacity: 128,
        offsetX: 8,
        offsetY: 0,
        parallaxY: 0.5,
    });
    await page.mouse.move(0, 0);
    await expect(opacity).toBeVisible();
    await expect(opacity).toHaveText("128");

    // Escape closes and applies too: one field, its own label. A press outside likewise.
    await opacity.click();
    await field("Offset Y").fill("-4");
    // Tab takes the typed value (Escape in a number field drops what it has not taken).
    await field("Offset Y").press("Tab");
    await page.keyboard.press("Escape");
    await expect(popover(page)).toBeHidden();
    state = await snapshot(page);
    expect(state).toMatchObject({ undo: 2, undoLabel: "Layer Offset" });
    await opacity.click();
    await popover(page).locator('[data-layer-field="class"]').fill("rock");
    await page.mouse.click(5, 5);
    await expect(popover(page)).toBeHidden();
    state = await snapshot(page);
    expect(state).toMatchObject({ undo: 3, undoLabel: "Layer Class" });

    // Escape in a number field drops the text it has not taken, then closes: no entry.
    await opacity.click();
    await field("Offset X").fill("99");
    await field("Offset X").press("Escape");
    await expect(popover(page)).toBeHidden();
    expect((await snapshot(page)).undo).toBe(3);

    // Layer Properties… from the Layer menu opens it on the active layer (Ground).
    await openMenu(page, "Layer");
    await menuItem(page, "layer.properties").click();
    await expect(popover(page)).toBeVisible();
    await expect(popover(page).locator('[data-layer-field="name"]')).toHaveValue("Ground");
    await page.keyboard.press("Escape");

    await undoAll(page, 3);
    state = await expectRowsMirror(page);
    expect(state.layers.find((layer) => layer.id === 3)).toMatchObject({
        name: "Rocks",
        class: "",
        opacity: 255,
        offsetX: 0,
        offsetY: 0,
        parallaxY: 1,
    });
});

test("a drag reorders and drops into a group, one entry each that undo takes back", async ({
    page,
}) => {
    await load(page);
    const box = async (id: number) => (await row(page, id).boundingBox())!;

    // Ground dragged into the upper half of Markers: above it, at the top of the map.
    await dragTo(page, row(page, 1), (await box(5)).y + 4);
    let state = await expectRowsMirror(page);
    expect(state.tree).toBe("Props[Rocks,Trees],Markers,Ground");
    expect(state).toMatchObject({ undo: 1, undoLabel: "Move Layer" });

    // Markers dropped on the middle third of Props: into the group, at its bottom (Tiled).
    const props = await box(2);
    await dragTo(page, row(page, 5), props.y + props.height / 2);
    state = await expectRowsMirror(page);
    expect(state.tree).toBe("Props[Markers,Rocks,Trees],Ground");
    expect(state.undo).toBe(2);
    expect(state.layers.find((layer) => layer.id === 5)!.depth).toBe(1);

    // Rocks dragged out, below the last row (Markers, in Props): the bottom of the map.
    const last = (await rows(page).last().boundingBox())!;
    await dragTo(page, row(page, 3), last.y + last.height + 40);
    state = await expectRowsMirror(page);
    expect(state.tree).toBe("Rocks,Props[Markers,Trees],Ground");

    // A press without a move is a click: no entry.
    await row(page, 4).click();
    expect((await snapshot(page)).undo).toBe(3);

    await undoAll(page, 3);
    state = await expectRowsMirror(page);
    expect(state.tree).toBe("Ground,Props[Rocks,Trees],Markers");
});

test("the tree works from the keyboard: arrows, collapse, Enter and F2", async ({ page }) => {
    await load(page);
    // One tab stop: the active row (Ground).
    await expect(panel(page).locator('[tabindex="0"]')).toHaveCount(1);
    await row(page, 1).focus();
    await expect(row(page, 1)).toBeFocused();

    // ↑ to Rocks, Trees, Props; the active layer stays until Enter.
    for (const id of [3, 4, 2]) {
        await page.keyboard.press("ArrowUp");
        await expect(row(page, id)).toBeFocused();
    }
    expect((await snapshot(page)).active).toBe(1);
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await snapshot(page)).active).toBe(2);
    await expect(row(page, 2)).toHaveAttribute("aria-selected", "true");

    // ← collapses Props, → expands it, → again goes to its top child.
    await page.keyboard.press("ArrowLeft");
    await expect(row(page, 2)).toHaveAttribute("aria-expanded", "false");
    await expect(rows(page)).toHaveCount(3);
    await page.keyboard.press("ArrowDown");
    await expect(row(page, 1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowRight");
    await expect(row(page, 2)).toHaveAttribute("aria-expanded", "true");
    await expect(rows(page)).toHaveCount(5);
    await page.keyboard.press("ArrowRight");
    await expect(row(page, 4)).toBeFocused();
    // ← on a child goes to its group.
    await page.keyboard.press("ArrowLeft");
    await expect(row(page, 2)).toBeFocused();
    await page.keyboard.press("End");
    await expect(row(page, 1)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(row(page, 5)).toBeFocused();

    // F2 renames the focused row's layer; Enter applies; the focus comes back to the row.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(row(page, 4)).toBeFocused();
    await page.keyboard.press("F2");
    await expect(renameField(page)).toBeFocused();
    await expect(renameField(page)).toHaveValue("Trees");
    await page.keyboard.type("Forest");
    await page.keyboard.press("Enter");
    await expect(renameField(page)).toHaveCount(0);
    await expect(row(page, 4)).toBeFocused();
    let state = await expectRowsMirror(page);
    expect(state).toMatchObject({ undo: 1, undoLabel: "Rename Layer" });
    expect(state.layers.find((layer) => layer.id === 4)!.name).toBe("Forest");

    // Escape keeps the old name.
    await page.keyboard.press("F2");
    await page.keyboard.type("Jungle");
    await page.keyboard.press("Escape");
    await expect(renameField(page)).toHaveCount(0);
    state = await snapshot(page);
    expect(state.undo).toBe(1);

    // Tab leaves the tree and Shift+Tab comes back to its one stop: the active row.
    await page.keyboard.press("Tab");
    await expect(panel(page).locator(":focus")).toHaveCount(0);
    await page.keyboard.press("Shift+Tab");
    await expect(row(page, 2)).toBeFocused();
});

test("after a click on a row's control the arrows and F2 act from that row", async ({ page }) => {
    await load(page);
    // A toggle click keeps the focus on its row, so the tree's keys go on from there.
    await row(page, 3).locator("[data-layer-visible]").click();
    await expect(row(page, 3)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(row(page, 4)).toBeFocused();
    await page.keyboard.press("F2");
    await expect(renameField(page)).toHaveValue("Trees");
    await page.keyboard.press("Escape");
    await expect(row(page, 4)).toBeFocused();

    // The popover opened from a row's opacity gives the focus back to that row.
    await row(page, 3).locator("[data-layer-opacity]").click();
    await expect(popover(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(popover(page)).toBeHidden();
    await expect(row(page, 3)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(row(page, 1)).toBeFocused();
});

test("rows under a hidden or locked group are muted; the active row has the accent bar", async ({
    page,
}) => {
    await load(page);
    const colour = (id: number) =>
        row(page, id).evaluate((element) => getComputedStyle(element).color);
    const css = (name: string) =>
        page.evaluate(
            (token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim(),
            name,
        );
    const rgb = (hex: string) => {
        const value = parseInt(hex.replace("#", ""), 16);
        return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
    };
    const text = rgb(await css("--text"));
    const muted = rgb(await css("--text-muted"));

    for (const id of [5, 2, 4, 3, 1]) expect(await colour(id)).toBe(text);
    await row(page, 2).locator("[data-layer-visible]").click();
    await expect.poll(() => colour(4)).toBe(muted);
    expect(await colour(3)).toBe(muted);
    // The group itself and the layers outside it are not.
    expect(await colour(2)).toBe(text);
    expect(await colour(1)).toBe(text);

    await row(page, 2).locator("[data-layer-visible]").click();
    await expect.poll(() => colour(4)).toBe(text);
    await row(page, 2).locator("[data-layer-locked]").click();
    await expect.poll(() => colour(4)).toBe(muted);
    expect(await colour(3)).toBe(muted);

    // The active row: --bg-active and a 2 px accent bar on its left; the others neither.
    const look = (id: number) =>
        row(page, id).evaluate((element) => {
            const style = getComputedStyle(element);
            return { background: style.backgroundColor, shadow: style.boxShadow };
        });
    await page.mouse.move(0, 0);
    const accent = rgb(await css("--accent"));
    expect(await look(1)).toEqual({
        background: rgb(await css("--bg-active")),
        shadow: `${accent} 2px 0px 0px 0px inset`,
    });
    expect((await look(3)).shadow).toBe("none");
    await row(page, 3).click();
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await look(3)).shadow).toBe(`${accent} 2px 0px 0px 0px inset`);
    expect((await look(1)).shadow).toBe("none");
});
