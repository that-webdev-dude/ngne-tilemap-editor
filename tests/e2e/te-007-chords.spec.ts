import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { chordKey, chordModifiers } from "../../src/app/commands/chord";
import { region } from "./te-003-support";
import { CHROME_RESERVED_CHORDS, readDesignKeyTable } from "./te-007-design-keys";
import type { DesignBinding } from "./te-007-design-keys";
import { settleTimers } from "./te-007-support";

// TE-007: every chord listed in DESIGN §10.3 reaches the page in Chrome. The harness page runs
// the real shell and the real keymap on a registry of probe commands, one per chord and
// context of the table; the list is parsed from docs/DESIGN.md (te-007-design-keys.ts).
// Adapted from the sprite editor's se-007-keymap.spec.ts.
//
// Limit of the method: Playwright delivers keys to the page below the layer where Chrome
// handles its own shortcuts, so a chord the browser reserves would still arrive here. The
// table is therefore also compared with the chords Chrome reserves (last test), and the owner
// check of the ticket presses the chords by hand.

const HARNESS = "/tests/e2e/harness/te-007-chords.html";

interface KeyRecord {
    type: string;
    key: string;
    prevented: boolean;
}
interface Harness {
    calls: string[];
    releases: string[];
    events: KeyRecord[];
    layer: "tile" | "marker";
    markerSelection: boolean;
    register(bindings: DesignBinding[]): string[];
    setContext(context: "gesture" | "markers", active: boolean): void;
    reset(): void;
}
declare global {
    interface Window {
        te007?: Harness;
    }
}

const table = readDesignKeyTable();

/** A canonical chord as Playwright presses it on a US keyboard. */
function playwrightKey(chord: string): string {
    const key = chordKey(chord);
    const modifiers = chordModifiers(chord);
    const names = [
        modifiers.ctrl ? "Control" : "",
        modifiers.alt ? "Alt" : "",
        modifiers.shift ? "Shift" : "",
        modifiers.meta ? "Meta" : "",
    ].filter(Boolean);
    if (/^[A-Z]$/.test(key)) names.push(`Key${key}`);
    else if (/^[0-9]$/.test(key)) names.push(`Digit${key}`);
    else if (key === "?") names.push("Shift", "Slash");
    else if (key === "[") names.push("BracketLeft");
    else if (key === "]") names.push("BracketRight");
    else if (key.length > 1) names.push(key === "Ctrl" ? "Control" : key);
    else throw new Error(`No Playwright key for "${chord}"; add it to playwrightKey().`);
    return names.join("+");
}

async function openHarness(page: Page): Promise<string[]> {
    await page.goto(HARNESS);
    await expect(region(page, "viewport")).toBeVisible();
    return page.evaluate((bindings) => window.te007!.register(bindings), table.bindings);
}

interface Scene {
    gesture?: boolean;
    markers?: boolean;
    layer?: "tile" | "marker";
}

/** Clears the records and sets the editor state the next key is pressed in. */
async function arrange(page: Page, scene: Scene = {}): Promise<void> {
    await page.evaluate((state) => {
        const harness = window.te007!;
        harness.reset();
        harness.setContext("gesture", state.gesture ?? false);
        harness.setContext("markers", state.markers ?? false);
        harness.markerSelection = state.markers ?? false;
        harness.layer = state.layer ?? "tile";
    }, scene);
}

async function press(page: Page, binding: Pick<DesignBinding, "chord" | "hold">): Promise<void> {
    const key = playwrightKey(binding.chord);
    if (!binding.hold) return page.keyboard.press(key);
    await page.keyboard.down(key);
    await page.keyboard.up(key);
}

interface Outcome {
    calls: string[];
    releases: string[];
    /** Whether the default of the chord's own key-down event was prevented. */
    prevented: boolean | undefined;
}

async function outcome(page: Page, binding: DesignBinding): Promise<Outcome> {
    const { calls, releases, events } = await page.evaluate(() => {
        const harness = window.te007!;
        return { calls: harness.calls, releases: harness.releases, events: harness.events };
    });
    const key = chordKey(binding.chord);
    const down = events.find(
        (event) =>
            event.type === "keydown" &&
            (event.key === (key === "Space" ? " " : key) || event.key.toUpperCase() === key),
    );
    return { calls, releases, prevented: down?.prevented };
}

const viewport = (page: Page) => page.getByTestId("viewport-focus");
const textField = (page: Page) => page.getByTestId("text-field");

/** Where focus is for a binding of the table: its context decides. */
function focusTarget(page: Page, binding: DesignBinding): Locator {
    return binding.context === "panel" ? page.getByTestId("panel-cell") : viewport(page);
}

/** The editor state a row of the table applies in. */
function sceneOf(binding: DesignBinding): Scene {
    return {
        gesture: binding.context === "gesture",
        markers: binding.context === "markers",
        layer: binding.condition === "marker-layer" ? "marker" : "tile",
    };
}

const label = (binding: DesignBinding) => `${binding.chord} in ${binding.context} (${binding.row})`;

test("the key table of DESIGN §10.3 is read in full", () => {
    expect(table.bindings.length).toBeGreaterThan(70);
    expect(table.pointerKeys).toEqual(["middle drag", "Wheel, Shift+wheel"]);
    // Every context of DESIGN §10.1 but `text` has rows; † rows exist.
    const contexts = new Set(table.bindings.map((binding) => binding.context));
    expect([...contexts].sort()).toEqual(["canvas", "gesture", "global", "markers", "panel"]);
    expect(table.bindings.filter((binding) => binding.text).length).toBeGreaterThanOrEqual(10);
    expect(table.bindings.filter((binding) => binding.hold).map((b) => b.chord)).toEqual(["Space"]);
    // Every chord can be pressed by this spec.
    for (const binding of table.bindings) expect(playwrightKey(binding.chord)).not.toBe("");
});

test("every chord listed in DESIGN §10.3 reaches the page: a probe command per chord", async ({
    page,
}) => {
    // Six round trips per binding, 78 bindings: three times the default budget.
    test.slow();
    const ids = await openHarness(page);
    expect(ids).toHaveLength(table.bindings.length);

    for (const [index, binding] of table.bindings.entries()) {
        const id = ids[index] ?? "";
        await arrange(page, sceneOf(binding));
        const target = focusTarget(page, binding);
        await target.focus();
        await press(page, binding);

        const result = await outcome(page, binding);
        expect.soft(result.calls, `${label(binding)} runs its probe and no other`).toEqual([id]);
        expect.soft(result.prevented, `${label(binding)} has its default prevented`).toBe(true);
        expect.soft(result.releases, `${label(binding)} release`).toEqual(binding.hold ? [id] : []);
        // Focus has not moved: Tab on the viewport did not leave it.
        await expect.soft(target, `${label(binding)} keeps focus`).toBeFocused();
    }
});

test("chords marked † also reach the page while a text field has focus", async ({ page }) => {
    const ids = await openHarness(page);
    const marked = table.bindings.filter((binding) => binding.text);
    expect(marked.length).toBeGreaterThanOrEqual(10);

    for (const binding of marked) {
        const id = ids[table.bindings.indexOf(binding)] ?? "";
        await arrange(page);
        await textField(page).fill("");
        await textField(page).focus();
        await press(page, binding);

        const result = await outcome(page, binding);
        expect.soft(result.calls, `${label(binding)} in a text field`).toEqual([id]);
        expect.soft(result.prevented, `${label(binding)} default prevented`).toBe(true);
        await expect.soft(textField(page), `${label(binding)} types nothing`).toHaveValue("");
        await expect.soft(textField(page)).toBeFocused();
    }
});

test("a focused control keeps the keys it consumes natively", async ({ page }) => {
    const ids = await openHarness(page);
    const probe = (chord: string, context: string) =>
        ids[
            table.bindings.findIndex(
                (binding) =>
                    binding.chord === chord &&
                    binding.context === context &&
                    binding.condition !== "marker-layer",
            )
        ];
    const calls = () => page.evaluate(() => window.te007!.calls);
    const lastKeyDown = () =>
        page.evaluate(() =>
            window.te007!.events.filter((event) => event.type === "keydown").at(-1),
        );

    // A button: Enter and Space are its own, a tool key still acts, arrows do nothing.
    const button = page.getByTestId("plain-button");
    await arrange(page);
    await button.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Escape");
    expect(await calls()).toEqual([]);
    expect((await lastKeyDown())?.prevented).toBe(false);
    await page.keyboard.press("KeyB");
    expect(await calls()).toEqual([probe("B", "canvas")]);
    expect((await lastKeyDown())?.prevented).toBe(true);

    // Tab leaves the button: it is bound for the viewport only.
    await arrange(page);
    await button.focus();
    await page.keyboard.press("Tab");
    await expect(button).not.toBeFocused();
    expect(await calls()).toEqual([]);

    // A select: letters are typeahead, a modified chord still acts.
    const select = page.getByRole("combobox", { name: "Choice" });
    await arrange(page);
    await select.focus();
    await page.keyboard.press("KeyB");
    await page.keyboard.press("Digit1");
    expect(await calls()).toEqual([]);
    await page.keyboard.press("Control+KeyS");
    expect(await calls()).toEqual([probe("Ctrl+S", "global")]);

    // In the bottom panel a button takes Enter; F2 and [ still act there.
    const panelButton = page.getByTestId("panel-button");
    await arrange(page);
    await panelButton.focus();
    await page.keyboard.press("Enter");
    expect(await calls()).toEqual([]);
    await page.keyboard.press("F2");
    expect(await calls()).toEqual([probe("F2", "panel")]);
    await page.keyboard.press("BracketLeft");
    expect(await calls()).toEqual([probe("F2", "panel"), probe("[", "panel")]);
    // The panel's splitter keeps its arrows.
    await arrange(page);
    const splitter = page.getByRole("separator", { name: "Resize bottom panel" });
    await splitter.focus();
    const before = await splitter.getAttribute("aria-valuenow");
    await page.keyboard.press("ArrowUp");
    expect(await calls()).toEqual([]);
    expect(await splitter.getAttribute("aria-valuenow")).not.toBe(before);
    // Tool keys fall back to the canvas context inside the panel.
    await page.getByTestId("panel-cell").focus();
    await page.keyboard.press("KeyB");
    expect(await calls()).toEqual([probe("B", "canvas")]);

    // Nothing focused: letters and modified chords act, native keys are left alone.
    await arrange(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowUp");
    expect(await calls()).toEqual([]);
    await page.keyboard.press("KeyB");
    await page.keyboard.press("Control+KeyD");
    expect(await calls()).toEqual([probe("B", "canvas"), probe("Ctrl+D", "global")]);
});

test("a higher context takes a key from a lower one", async ({ page }) => {
    const ids = await openHarness(page);
    const probe = (chord: string, context: string) =>
        ids[
            table.bindings.findIndex(
                (binding) => binding.chord === chord && binding.context === context,
            )
        ];
    const pressed = async (scene: Scene, target: Locator, key: string) => {
        await arrange(page, scene);
        await target.focus();
        await page.keyboard.press(key);
        return page.evaluate(() => window.te007!.calls);
    };

    // Escape is bound in canvas and gesture; Backspace in gesture only.
    expect(await pressed({}, viewport(page), "Escape")).toEqual([probe("Escape", "canvas")]);
    expect(await pressed({ gesture: true }, viewport(page), "Escape")).toEqual([
        probe("Escape", "gesture"),
    ]);
    expect(await pressed({}, viewport(page), "Backspace")).toEqual([]);
    expect(await pressed({ gesture: true }, viewport(page), "Backspace")).toEqual([
        probe("Backspace", "gesture"),
    ]);
    // Arrows: markers nudge with a marker selection, select a layer without one.
    expect(await pressed({}, viewport(page), "ArrowUp")).toEqual([probe("ArrowUp", "canvas")]);
    expect(await pressed({ markers: true }, viewport(page), "ArrowUp")).toEqual([
        probe("ArrowUp", "markers"),
    ]);
    // [ in the panel before the canvas.
    expect(await pressed({}, page.getByTestId("panel-cell"), "BracketLeft")).toEqual([
        probe("[", "panel"),
    ]);
    expect(await pressed({}, viewport(page), "BracketLeft")).toEqual([probe("[", "canvas")]);
});

test("no chord acts while a menu or a dialog is open", async ({ page }) => {
    const ids = await openHarness(page);
    const probe = (chord: string) =>
        ids[table.bindings.findIndex((binding) => binding.chord === chord)];
    const calls = () => page.evaluate(() => window.te007!.calls);
    const keyDowns = () =>
        page.evaluate(() => window.te007!.events.filter((event) => event.type === "keydown"));

    // A menu of the menu bar.
    await arrange(page);
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("KeyB");
    await page.keyboard.press("Control+KeyS");
    await page.keyboard.press("F6");
    expect(await calls()).toEqual([]);
    // Ctrl+S and F6 are bound: no "Save page", even though they did not act.
    expect((await keyDowns()).filter((event) => ["s", "F6"].includes(event.key))).toEqual([
        { type: "keydown", key: "s", prevented: true },
        { type: "keydown", key: "F6", prevented: true },
    ]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
    // Radix moves the focus back one timer after the menu has gone.
    await settleTimers(page);
    await page.keyboard.press("KeyB");
    expect(await calls()).toEqual([probe("B")]);

    // A dialog, with a text field of its own.
    await page.getByRole("button", { name: "Open dialog" }).click();
    const dialog = page.getByRole("dialog", { name: "Test dialog" });
    await expect(dialog).toBeVisible();
    await arrange(page);
    await dialog.getByRole("button", { name: "Close" }).focus();
    await page.keyboard.press("KeyB");
    await page.keyboard.press("Control+KeyS");
    await page.keyboard.press("F6");
    expect(await calls()).toEqual([]);

    const field = page.getByTestId("dialog-field");
    await field.focus();
    await page.keyboard.press("KeyZ");
    await page.keyboard.press("Control+KeyZ");
    await expect(field).toHaveValue("");
    await page.keyboard.press("KeyZ");
    await page.keyboard.press("Control+KeyS");
    await expect(field).toHaveValue("z");
    expect(await calls()).toEqual([]);

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    await arrange(page);
    await viewport(page).focus();
    await page.keyboard.press("Control+KeyS");
    expect(await calls()).toEqual([probe("Ctrl+S")]);
});

test("no chord of DESIGN §10.3 is one Chrome reserves for itself", () => {
    // Ctrl+N and Ctrl+W are why the table uses Ctrl+Alt+N and Alt+W.
    expect(CHROME_RESERVED_CHORDS).toEqual(expect.arrayContaining(["Ctrl+N", "Ctrl+W", "Ctrl+T"]));
    const reserved = table.bindings.filter((binding) =>
        CHROME_RESERVED_CHORDS.includes(binding.chord),
    );
    expect(reserved.map(label)).toEqual([]);
});
