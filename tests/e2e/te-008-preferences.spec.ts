import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import {
    PREFERENCES_STORAGE_KEY,
    PREFERENCES_VERSION,
} from "../../src/app/preferences/preferences";
import type { PreferenceKey, Preferences } from "../../src/app/preferences/preferences";
import { VIEW_PREFERENCE_KEYS } from "../../src/app/view/viewPreferences";
import type { ViewPreferences } from "../../src/app/view/viewPreferences";
import { boxOf, collectErrors, THEME_KEY } from "./te-003-support";
import { menuItem, menuTrigger, openEditor, openMenu, settleTimers } from "./te-007-support";
import {
    activeOption,
    dialogButton,
    expectShellUsable,
    field,
    hexField,
    openPalette,
    openPreferences,
    PREFERENCES_COMMAND,
    preferencesDialog,
    ringOf,
    section,
    segment,
    setNumber,
    storedItem,
    storedPreferences,
    toggle,
    VIEW_KEY,
} from "./te-008-support";

// TE-008: the Preferences dialog (DESIGN §9) and the view preferences of SPEC §3. The dialog
// edits the preference store and, for the theme, the theme store; a change applies at once and
// every preference persists across a reload. Adapted from the sprite editor's
// se-064-preferences.spec.ts for this editor's preferences (theme, checkerboard, grid colour
// and opacity, highlight-layer opacity, autosave).

type Mutable<Value> = { -readonly [Key in keyof Value]: Mutable<Value[Key]> };
type Draft = Mutable<Preferences>;

const checkerboard = (dialog: Locator) => section(dialog, "Checkerboard");
const grid = (dialog: Locator) => section(dialog, "Grid");
const highlight = (dialog: Locator) => section(dialog, "Highlight current layer");
const autosave = (dialog: Locator) => section(dialog, "Autosave");
const preview = (dialog: Locator) => dialog.locator(".preferences__checker");
const swatch = (dialog: Locator) => dialog.locator(".preferences__swatch-colour");

const theme = (page: Page) => page.locator("html").getAttribute("data-theme");
const storedRecord = (page: Page) => storedItem(page, PREFERENCES_STORAGE_KEY);
/** The two colours the checkerboard preview is drawn with. */
const previewColours = (dialog: Locator) =>
    preview(dialog).evaluate((element) => {
        const style = getComputedStyle(element);
        return [
            style.getPropertyValue("--check-a").trim(),
            style.getPropertyValue("--check-b").trim(),
        ];
    });
/** The colour and opacity the grid swatch is drawn with, as "rgb(r, g, b)" and a fraction. */
const swatchValues = (dialog: Locator) =>
    swatch(dialog).evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.backgroundColor, style.opacity];
    });
/** A colour 0xRRGGBB as the browser reports it. */
const rgb = (colour: number) =>
    `rgb(${(colour >> 16) & 0xff}, ${(colour >> 8) & 0xff}, ${colour & 0xff})`;

/** Every field of the preferences as "section.field" with its value as JSON. */
function leaves(preferences: Preferences): Map<string, string> {
    return new Map(
        (Object.keys(preferences) as PreferenceKey[]).flatMap((key) =>
            Object.entries(preferences[key]).map(([name, value]) => [
                `${key}.${name}`,
                JSON.stringify(value),
            ]),
        ),
    );
}

declare global {
    interface Window {
        /** What the test subscriber of the preference store was told, in order. */
        te008Seen?: [string, unknown][];
    }
}

/** Subscribes to the preference store of the page; each call is recorded with a copy. */
async function subscribe(page: Page): Promise<void> {
    await page.evaluate(() => {
        const seen: [string, unknown][] = (window.te008Seen = []);
        window.__ngneTest!.preferences.subscribe((key, all) => {
            seen.push([key, JSON.parse(JSON.stringify(all[key]))]);
        });
    });
}
const seen = (page: Page) => page.evaluate(() => window.te008Seen ?? []);

/** The view flags of the page's store. */
const viewFlags = (page: Page) =>
    page.evaluate((): ViewPreferences => {
        const state = window.__ngneTest!.viewPreferences.getState();
        return {
            grid: state.grid,
            collision: state.collision,
            highlightLayer: state.highlightLayer,
            snap: state.snap,
        };
    });

test("the Edit menu opens Preferences: the theme and every value of the preference store", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    await openMenu(page, "Edit");
    await expect(menuItem(page, PREFERENCES_COMMAND)).toHaveText("Preferences…");
    await expect(menuItem(page, PREFERENCES_COMMAND)).not.toHaveAttribute("aria-disabled", "true");
    await menuItem(page, PREFERENCES_COMMAND).click();
    const dialog = preferencesDialog(page);
    await expect(dialog.getByRole("heading", { name: "Preferences" })).toBeVisible();
    expect((await boxOf(dialog)).width).toBe(560);

    // The sections of the ticket, in its order.
    await expect(dialog.getByRole("group")).toHaveCount(5);
    expect(
        await dialog
            .getByRole("group")
            .evaluateAll((groups) =>
                groups.map(
                    (group) =>
                        document.getElementById(group.getAttribute("aria-labelledby") ?? "")
                            ?.textContent,
                ),
            ),
    ).toEqual(["Theme", "Checkerboard", "Grid", "Highlight current layer", "Autosave"]);

    // The values as they ship (the defaults of the store; the theme is dark).
    await expect(segment(dialog, "Theme", "Dark")).toBeChecked();
    await expect(segment(checkerboard(dialog), "Colours", "Theme")).toBeChecked();
    await expect(field(checkerboard(dialog), "Size")).toHaveValue("8");
    await expect(dialog.getByRole("textbox")).toHaveCount(0);
    await expect(segment(grid(dialog), "Colour", "Theme")).toBeChecked();
    await expect(field(grid(dialog), "Opacity")).toHaveValue("25");
    expect(await swatchValues(dialog)).toEqual([rgb(0xffffff), "0.25"]);
    await expect(field(highlight(dialog), "Other layers")).toHaveValue("25");
    await expect(toggle(autosave(dialog), "Autosave")).toHaveAttribute("aria-pressed", "true");

    // Close and Escape close it; nothing was stored by looking.
    await dialogButton(dialog, "Close").click();
    await expect(dialog).toBeHidden();
    await expect(menuTrigger(page, "Edit")).toBeFocused();
    expect(await storedRecord(page)).toBeNull();
    await expectShellUsable(page);
    expect(errors).toEqual([]);
});

test("changing a preference updates the store and notifies a test subscriber, for every field; each value persists across a reload", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const defaults = await storedPreferences(page);
    await subscribe(page);
    const dialog = await openPreferences(page);

    /** One change made in the dialog and what it does to the preferences. */
    type Step = [field: string, act: () => Promise<void>, apply: (draft: Draft) => void];
    const steps: Step[] = [
        [
            // Custom starts from the colours of the theme (dark here).
            "checkerboard.colors",
            () => segment(checkerboard(dialog), "Colours", "Custom").click(),
            (draft) => void (draft.checkerboard.colors = { a: 0x3a3a3a, b: 0x4a4a4a }),
        ],
        [
            "checkerboard.colors",
            async () => {
                await hexField(checkerboard(dialog), "Colour A").fill("#112233");
                await page.keyboard.press("Enter");
            },
            (draft) => void (draft.checkerboard.colors = { a: 0x112233, b: 0x4a4a4a }),
        ],
        [
            "checkerboard.colors",
            async () => {
                await hexField(checkerboard(dialog), "Colour B").fill("DDEEFF");
                await hexField(checkerboard(dialog), "Colour B").blur();
            },
            (draft) => void (draft.checkerboard.colors = { a: 0x112233, b: 0xddeeff }),
        ],
        [
            "checkerboard.size",
            () => setNumber(field(checkerboard(dialog), "Size"), 16),
            (draft) => void (draft.checkerboard.size = 16),
        ],
        [
            // Custom starts from the grid colour of the theme: white in dark.
            "grid.colour",
            () => segment(grid(dialog), "Colour", "Custom").click(),
            (draft) => void (draft.grid.colour = 0xffffff),
        ],
        [
            "grid.colour",
            async () => {
                await hexField(grid(dialog), "Grid colour").fill("#ff8800");
                await page.keyboard.press("Enter");
            },
            (draft) => void (draft.grid.colour = 0xff8800),
        ],
        [
            "grid.opacity",
            () => setNumber(field(grid(dialog), "Opacity"), 60),
            (draft) => void (draft.grid.opacity = 60),
        ],
        [
            "highlight.opacity",
            () => setNumber(field(highlight(dialog), "Other layers"), 40),
            (draft) => void (draft.highlight.opacity = 40),
        ],
        [
            "autosave.enabled",
            () => toggle(autosave(dialog), "Autosave").click(),
            (draft) => void (draft.autosave.enabled = false),
        ],
    ];

    // The steps reach every field the store has.
    expect([...new Set(steps.map(([name]) => name))].sort()).toEqual(
        [...leaves(defaults).keys()].sort(),
    );

    const expected = structuredClone(defaults) as Draft;
    const told: [string, unknown][] = [];
    for (const [name, act, apply] of steps) {
        const key = name.split(".")[0] as PreferenceKey;
        await act();
        apply(expected);
        told.push([key, structuredClone(expected[key])]);
        // The subscriber was told once, of this preference, with its new value …
        await expect.poll(() => seen(page), name).toEqual(told);
        // … and the store holds it, with nothing else changed.
        expect(await storedPreferences(page), name).toEqual(expected);
    }
    // Every field now differs from its default: none was left out, none was changed back.
    const changed = leaves(expected);
    for (const [name, value] of leaves(defaults)) {
        expect(changed.get(name), name).not.toBe(value);
    }
    expect(await swatchValues(dialog)).toEqual([rgb(0xff8800), "0.6"]);

    // One versioned record in localStorage holds them.
    expect(JSON.parse((await storedRecord(page)) ?? "null")).toEqual({
        version: PREFERENCES_VERSION,
        values: expected,
    });
    await dialogButton(dialog, "Close").click();
    await expect(dialog).toBeHidden();

    // After a reload the store and the dialog show the same values.
    await page.reload();
    await openEditor(page);
    expect(await storedPreferences(page)).toEqual(expected);
    const reopened = await openPreferences(page);
    await expect(segment(checkerboard(reopened), "Colours", "Custom")).toBeChecked();
    await expect(hexField(checkerboard(reopened), "Colour A")).toHaveValue("#112233");
    await expect(hexField(checkerboard(reopened), "Colour B")).toHaveValue("#ddeeff");
    await expect(field(checkerboard(reopened), "Size")).toHaveValue("16");
    await expect(segment(grid(reopened), "Colour", "Custom")).toBeChecked();
    await expect(hexField(grid(reopened), "Grid colour")).toHaveValue("#ff8800");
    await expect(field(grid(reopened), "Opacity")).toHaveValue("60");
    await expect(field(highlight(reopened), "Other layers")).toHaveValue("40");
    await expect(toggle(autosave(reopened), "Autosave")).toHaveAttribute("aria-pressed", "false");
    expect(errors).toEqual([]);
});

test("changing the theme changes the running app immediately and persists", async ({ page }) => {
    const errors = collectErrors(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openEditor(page);
    expect(await theme(page)).toBe("dark");
    await subscribe(page);
    const bodyColour = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const dark = await bodyColour();

    const dialog = await openPreferences(page);
    await expect(segment(dialog, "Theme", "Dark")).toBeChecked();

    // Light: the page behind the open dialog changes at once, and the theme's colours follow.
    await segment(dialog, "Theme", "Light").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(segment(dialog, "Theme", "Light")).toBeChecked();
    const light = await bodyColour();
    expect(light).not.toBe(dark);
    expect(await previewColours(dialog)).toEqual(["#c8c8c8", "#ffffff"]);
    expect(await swatchValues(dialog)).toEqual([rgb(0), "0.25"]);

    // The theme store is its owner: its own key is written, the preference store is not told.
    expect(await storedItem(page, THEME_KEY)).toBe("light");
    expect(await seen(page)).toEqual([]);
    expect(await storedRecord(page)).toBeNull();

    // It is still light after the dialog is closed and after a reload.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(await theme(page)).toBe("light");
    await page.reload();
    await openEditor(page);
    expect(await theme(page)).toBe("light");
    expect(await bodyColour()).toBe(light);
    await expect(segment(await openPreferences(page), "Theme", "Light")).toBeChecked();
    expect(errors).toEqual([]);
});

test("number fields keep to the ranges of the store: nothing invalid can be stored", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const dialog = await openPreferences(page);
    const stored = async () => (await storedPreferences(page)) as Draft;

    // Too large, too small, not a number, not whole.
    const opacity = field(grid(dialog), "Opacity");
    await setNumber(opacity, 5000);
    await expect(opacity).toHaveValue("100");
    expect((await stored()).grid.opacity).toBe(100);
    await setNumber(opacity, -3);
    await expect(opacity).toHaveValue("0");
    expect((await stored()).grid.opacity).toBe(0);
    await setNumber(opacity, "wide");
    await expect(opacity).toHaveValue("0");
    await setNumber(opacity, 12.6);
    await expect(opacity).toHaveValue("13");
    expect((await stored()).grid).toEqual({ colour: "theme", opacity: 13 });

    // The limits of the other ranges.
    const limits: [Locator, string, string][] = [
        [field(checkerboard(dialog), "Size"), "1", "64"],
        [field(highlight(dialog), "Other layers"), "0", "100"],
    ];
    for (const [target, min, max] of limits) {
        await setNumber(target, -99999);
        await expect(target).toHaveValue(min);
        await setNumber(target, 99999);
        await expect(target).toHaveValue(max);
    }
    expect(await stored()).toMatchObject({
        checkerboard: { size: 64 },
        highlight: { opacity: 100 },
    });

    // Arrow keys step by one; each step is stored.
    await opacity.focus();
    await page.keyboard.press("ArrowUp");
    await expect(opacity).toHaveValue("14");
    await page.keyboard.press("Shift+ArrowDown");
    await expect(opacity).toHaveValue("4");
    expect((await stored()).grid.opacity).toBe(4);

    // No value was refused by the store: no error toast, nothing on the console.
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(errors).toEqual([]);
});

test("custom colours are typed as hex; text that is not a colour is dropped", async ({ page }) => {
    const errors = collectErrors(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openEditor(page);
    await subscribe(page);
    const dialog = await openPreferences(page);
    const colours = async () => (await storedPreferences(page)).checkerboard.colors;
    const gridColour = async () => (await storedPreferences(page)).grid.colour;
    const a = hexField(checkerboard(dialog), "Colour A");
    const b = hexField(checkerboard(dialog), "Colour B");
    const g = hexField(grid(dialog), "Grid colour");

    // The colours of the theme: no fields, and the preview shows the theme's checkerboard.
    expect(await colours()).toBe("theme");
    await expect(a).toHaveCount(0);
    await expect(g).toHaveCount(0);
    expect(await previewColours(dialog)).toEqual(["#3a3a3a", "#4a4a4a"]);

    // Custom starts from what is on screen, so nothing changes until a colour is typed.
    await segment(checkerboard(dialog), "Colours", "Custom").click();
    await expect(a).toHaveValue("#3a3a3a");
    await expect(b).toHaveValue("#4a4a4a");
    expect(await colours()).toEqual({ a: 0x3a3a3a, b: 0x4a4a4a });

    // Applied on Enter and when the field is left; the short form and upper case are read.
    await a.fill("#1af");
    expect(await colours()).toEqual({ a: 0x3a3a3a, b: 0x4a4a4a });
    await page.keyboard.press("Enter");
    await expect(a).toHaveValue("#11aaff");
    expect(await colours()).toEqual({ a: 0x11aaff, b: 0x4a4a4a });
    await b.fill("FFD700");
    await page.keyboard.press("Tab");
    await expect(b).toHaveValue("#ffd700");
    expect(await colours()).toEqual({ a: 0x11aaff, b: 0xffd700 });
    expect(await previewColours(dialog)).toEqual(["#11aaff", "#ffd700"]);

    // Not a colour: the field goes back to the stored one and the store is not touched.
    const told = (await seen(page)).length;
    for (const text of ["#12", "blue", "#gggggg", ""]) {
        await a.fill(text);
        await a.blur();
        await expect(a, text).toHaveValue("#11aaff");
    }
    expect(await colours()).toEqual({ a: 0x11aaff, b: 0xffd700 });
    expect((await seen(page)).length).toBe(told);

    // Theme and back: the custom colours are not lost while the dialog is open.
    await segment(checkerboard(dialog), "Colours", "Theme").click();
    expect(await colours()).toBe("theme");
    await expect(a).toHaveCount(0);
    expect(await previewColours(dialog)).toEqual(["#3a3a3a", "#4a4a4a"]);
    await segment(checkerboard(dialog), "Colours", "Custom").click();
    await expect(a).toHaveValue("#11aaff");
    await expect(b).toHaveValue("#ffd700");
    expect(await colours()).toEqual({ a: 0x11aaff, b: 0xffd700 });

    // The grid colour the same way: Custom starts from the theme's white, Theme and back keeps
    // what was typed.
    await segment(grid(dialog), "Colour", "Custom").click();
    await expect(g).toHaveValue("#ffffff");
    expect(await gridColour()).toBe(0xffffff);
    await g.fill("08f");
    await page.keyboard.press("Enter");
    await expect(g).toHaveValue("#0088ff");
    expect(await gridColour()).toBe(0x0088ff);
    expect(await swatchValues(dialog)).toEqual([rgb(0x0088ff), "0.25"]);
    await segment(grid(dialog), "Colour", "Theme").click();
    expect(await gridColour()).toBe("theme");
    await expect(g).toHaveCount(0);
    expect(await swatchValues(dialog)).toEqual([rgb(0xffffff), "0.25"]);
    await segment(grid(dialog), "Colour", "Custom").click();
    await expect(g).toHaveValue("#0088ff");

    // In the light theme Custom starts from the light checkerboard and a black grid (in a
    // dialog that has no colours to remember).
    await segment(checkerboard(dialog), "Colours", "Theme").click();
    await segment(grid(dialog), "Colour", "Theme").click();
    await segment(dialog, "Theme", "Light").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await dialogButton(dialog, "Close").click();
    await expect(dialog).toBeHidden();
    const light = await openPreferences(page);
    await segment(checkerboard(light), "Colours", "Custom").click();
    await expect(hexField(checkerboard(light), "Colour A")).toHaveValue("#c8c8c8");
    await expect(hexField(checkerboard(light), "Colour B")).toHaveValue("#ffffff");
    await segment(grid(light), "Colour", "Custom").click();
    await expect(hexField(grid(light), "Grid colour")).toHaveValue("#000000");
    expect(errors).toEqual([]);
});

test("Restore defaults returns every preference and the theme to the default", async ({ page }) => {
    await openEditor(page);
    const defaults = await storedPreferences(page);
    const dialog = await openPreferences(page);
    await segment(dialog, "Theme", "Light").click();
    await setNumber(field(grid(dialog), "Opacity"), 80);
    await segment(checkerboard(dialog), "Colours", "Custom").click();
    await setNumber(field(highlight(dialog), "Other layers"), 50);
    await toggle(autosave(dialog), "Autosave").click();
    expect(await storedPreferences(page)).toMatchObject({
        grid: { opacity: 80 },
        highlight: { opacity: 50 },
        autosave: { enabled: false },
    });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await dialogButton(dialog, "Restore defaults").click();
    // The dialog stays open and shows the defaults.
    await expect(dialog).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(segment(dialog, "Theme", "Dark")).toBeChecked();
    await expect(field(grid(dialog), "Opacity")).toHaveValue("25");
    await expect(segment(checkerboard(dialog), "Colours", "Theme")).toBeChecked();
    await expect(field(highlight(dialog), "Other layers")).toHaveValue("25");
    await expect(toggle(autosave(dialog), "Autosave")).toHaveAttribute("aria-pressed", "true");
    expect(await storedPreferences(page)).toEqual(defaults);

    // And they are what a reload finds.
    await page.reload();
    await openEditor(page);
    expect(await storedPreferences(page)).toEqual(defaults);
    expect(await theme(page)).toBe("dark");
});

test("the dialog works from the keyboard and returns focus to the Edit menu", async ({ page }) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const dialog = preferencesDialog(page);

    // Edit, Enter, End (Preferences… is the last item), Enter.
    await menuTrigger(page, "Edit").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu", { name: "Edit" })).toBeVisible();
    // Radix focuses the first enabled item one timer after the menu opens; End acts on the
    // focus.
    await expect(page.getByRole("menu", { name: "Edit" }).locator(":focus")).toHaveCount(1);
    await page.keyboard.press("End");
    await expect(menuItem(page, PREFERENCES_COMMAND)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    // Focus starts on the first control: the theme.
    await expect(segment(dialog, "Theme", "Dark")).toBeFocused();
    expect(await ringOf(segment(dialog, "Theme", "Dark"))).not.toBe("none");

    // Tab walks every control and never leaves the dialog. A group of segments is one stop.
    const stopsInDialog = await dialog.evaluate(
        (element) =>
            element.querySelectorAll('input, button:not([role="radio"]), [role="radiogroup"]')
                .length,
    );
    // Theme; checkerboard colours, size; grid colour, opacity; highlight; autosave; two actions.
    expect(stopsInDialog).toBe(9);
    const visited = new Set<string>();
    for (let presses = 0; presses < stopsInDialog + 4; presses++) {
        await page.keyboard.press("Tab");
        visited.add(
            await page.evaluate(() => {
                const active = document.activeElement;
                const group = active?.closest('[role="radiogroup"]');
                const scope = active?.closest('[role="group"]')?.getAttribute("aria-labelledby");
                const name =
                    group?.getAttribute("aria-label") ??
                    active?.getAttribute("aria-label") ??
                    active?.id ??
                    "";
                return `${scope ?? "actions"}/${name || active?.textContent}`;
            }),
        );
        expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
            true,
        );
    }
    expect(visited.size).toBe(stopsInDialog);

    // Space presses a toggle, arrow keys move a choice.
    await toggle(autosave(dialog), "Autosave").focus();
    await page.keyboard.press("Space");
    await expect(toggle(autosave(dialog), "Autosave")).toHaveAttribute("aria-pressed", "false");
    await segment(grid(dialog), "Colour", "Theme").focus();
    await page.keyboard.down("ArrowRight");
    await expect(segment(grid(dialog), "Colour", "Custom")).toBeFocused();
    await expect(segment(grid(dialog), "Colour", "Custom")).toBeChecked();
    await page.keyboard.up("ArrowRight");
    expect(await storedPreferences(page)).toMatchObject({
        grid: { colour: 0xffffff },
        autosave: { enabled: false },
    });

    // Escape closes the dialog; focus goes back to the menu it was opened from, with its ring.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(menuTrigger(page, "Edit")).toBeFocused();
    expect(await ringOf(menuTrigger(page, "Edit"))).not.toBe("none");
    await expectShellUsable(page);
    expect(errors).toEqual([]);
});

test("Preferences opens from the command palette; a click outside closes it", async ({ page }) => {
    await openEditor(page);
    await openPalette(page);
    await page.keyboard.type("pref");
    await expect(activeOption(page)).toHaveAttribute("data-command", PREFERENCES_COMMAND);
    await page.keyboard.press("Enter");
    const dialog = preferencesDialog(page);
    await expect(dialog).toBeVisible();
    await settleTimers(page);
    await page.mouse.click(8, 600);
    await expect(dialog).toBeHidden();
    await expectShellUsable(page);
});

test("each view preference of SPEC §3 persists across a reload under the view key", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    // The defaults: grid and snap on, collision and highlight off; nothing stored yet.
    expect(await viewFlags(page)).toEqual({
        grid: true,
        collision: false,
        highlightLayer: false,
        snap: true,
    });
    expect(await storedItem(page, VIEW_KEY)).toBeNull();

    // Every flag flipped, one at a time; each is written to the one record at once.
    const flipped: Record<string, boolean> = {};
    for (const key of VIEW_PREFERENCE_KEYS) {
        await page.evaluate(
            (key) => window.__ngneTest!.viewPreferences.getState().toggle(key),
            key,
        );
        flipped[key] = key === "collision" || key === "highlightLayer";
        expect(await viewFlags(page), key).toMatchObject(flipped);
        expect(JSON.parse((await storedItem(page, VIEW_KEY)) ?? "null"), key).toMatchObject(
            flipped,
        );
    }
    expect(JSON.parse((await storedItem(page, VIEW_KEY)) ?? "null")).toEqual({
        grid: false,
        collision: true,
        highlightLayer: true,
        snap: false,
    });

    // The view preferences are not in the Preferences record, and not shown by the dialog.
    expect(await storedRecord(page)).toBeNull();
    const dialog = await openPreferences(page);
    await expect(dialog.getByText(/show grid|snap to grid|show collision/i)).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.reload();
    await openEditor(page);
    expect(await viewFlags(page)).toEqual({
        grid: false,
        collision: true,
        highlightLayer: true,
        snap: false,
    });
    expect(errors).toEqual([]);
});
