import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../src/app/testing/testHooks";
import { region } from "./te-003-support";
import { menuItem, openMenu, settleTimers } from "./te-007-support";

// Shared helpers of the TE-008 specs: the command palette, the Preferences dialog, the
// shortcut sheet, and what the registry and the stores hold. Adapted from the sprite editor's
// se-064-support.ts.

export const PALETTE_COMMAND = "edit.commandPalette";
export const PREFERENCES_COMMAND = "edit.preferences";
export const SHORTCUTS_COMMAND = "edit.shortcuts";
export const RECENT_KEY = "ngne-tilemap-editor.recent-commands";
export const PREFERENCES_KEY = "ngne-tilemap-editor.preferences";
export const VIEW_KEY = "ngne-tilemap-editor.view";

// --- Command palette ----------------------------------------------------------------------

export const palette = (page: Page) => page.getByRole("dialog", { name: "Command palette" });
export const paletteInput = (page: Page) =>
    palette(page).getByRole("combobox", { name: "Search commands" });
export const paletteList = (page: Page) => palette(page).getByRole("listbox", { name: "Commands" });
export const paletteOptions = (page: Page) => paletteList(page).getByRole("option");
export const paletteOption = (page: Page, commandId: string) =>
    palette(page).locator(`[role="option"][data-command="${commandId}"]`);
/** The row the arrow keys are on; Enter runs it. */
export const activeOption = (page: Page) =>
    palette(page).locator('[role="option"][aria-selected="true"]');
export const paletteTrigger = (page: Page) =>
    region(page, "menu-bar").getByRole("button", { name: "Commands", exact: true });

/** Opens the palette with its key and waits until the search field has focus. */
export async function openPalette(page: Page): Promise<Locator> {
    await page.keyboard.press("Control+KeyK");
    await expect(paletteInput(page)).toBeFocused();
    return palette(page);
}

/** The command ids of the palette rows, in the order shown. */
export function paletteIds(page: Page): Promise<string[]> {
    return paletteOptions(page).evaluateAll((options) =>
        options.map((option) => option.getAttribute("data-command") ?? ""),
    );
}

/**
 * Opens the palette, picks the row of a command with the pointer, waits for it to close and for
 * the command to have run. The palette runs it where the focus returns, which Radix does one
 * timer after the palette has left the page.
 */
export async function runFromPalette(page: Page, commandId: string): Promise<void> {
    await openPalette(page);
    await paletteOption(page, commandId).click();
    await expect(palette(page)).toBeHidden();
    await settleTimers(page);
}

// --- Preferences and shortcut sheet -------------------------------------------------------

export const preferencesDialog = (page: Page) => page.getByRole("dialog", { name: "Preferences" });
export const shortcutSheet = (page: Page) =>
    page.getByRole("dialog", { name: "Keyboard shortcuts" });
/** The list of the shortcut sheet: one tab stop, scrolled with the keyboard. */
export const shortcutList = (page: Page) =>
    shortcutSheet(page).getByRole("group", { name: "Shortcuts by menu" });

/** Opens a surface from its item in the Edit menu. */
export async function openFromEditMenu(page: Page, commandId: string, surface: Locator) {
    await openMenu(page, "Edit");
    await menuItem(page, commandId).click();
    await expect(surface).toBeVisible();
    return surface;
}

export const openPreferences = (page: Page) =>
    openFromEditMenu(page, PREFERENCES_COMMAND, preferencesDialog(page));

/** Opens the shortcut sheet with its key; nothing may have focus that takes the character. */
export async function openShortcutSheet(page: Page): Promise<Locator> {
    await page.keyboard.press("Shift+Slash");
    await expect(shortcutSheet(page)).toBeVisible();
    return shortcutSheet(page);
}

/** A named group of controls in the Preferences dialog: one preference. */
export const section = (dialog: Locator, name: string) =>
    dialog.getByRole("group", { name, exact: true });
export const segment = (scope: Locator, group: string, name: string) =>
    scope.getByRole("radiogroup", { name: group, exact: true }).getByRole("radio", {
        name,
        exact: true,
    });
export const toggle = (scope: Locator, name: string) =>
    scope.getByRole("button", { name, exact: true });
export const hexField = (scope: Locator, name: string) =>
    scope.getByRole("textbox", { name, exact: true });
export const field = (scope: Locator, name: string) =>
    scope.getByRole("spinbutton", { name, exact: true });
export const dialogButton = (dialog: Locator, name: string) =>
    dialog.getByRole("button", { name, exact: true });

/** Types a value into a number field and applies it by leaving the field. */
export async function setNumber(target: Locator, value: number | string): Promise<void> {
    await target.fill(String(value));
    await target.blur();
}

// --- Registry and stores ------------------------------------------------------------------

/** What a spec reads of one command of the app's registry. */
export interface RegistryCommand {
    id: string;
    title: string;
    enabled: boolean;
    planned: boolean;
    /** Canonical chords. */
    shortcuts: string[];
    /** The menu of the menu bar the command is in, or null. */
    menu: string | null;
    menuPath: string[] | null;
    hold: boolean;
}

/** Every command of the app's registry, as the registry reports it now. */
export function registryCommands(page: Page): Promise<RegistryCommand[]> {
    return page.evaluate(() =>
        window.__ngneTest!.commands.list().map((command) => ({
            id: command.id,
            title: command.title(),
            enabled: command.enabled(),
            planned: command.planned,
            shortcuts: [...command.shortcuts],
            menu: command.menuPath?.[0] ?? null,
            menuPath: command.menuPath ? [...command.menuPath] : null,
            hold: command.release !== null,
        })),
    );
}

declare global {
    interface Window {
        /** Ids of the commands that ran, recorded by the commands of these specs. */
        te008Calls?: string[];
    }
}

/** The ids recorded by the commands of `registerProbes`. */
export const calls = (page: Page) => page.evaluate(() => window.te008Calls ?? []);

/** One command these specs add to the registry; `run` records its id. */
export interface Probe {
    id: string;
    title: string;
    enabled?: boolean;
    shortcut?: string | string[];
    context?: "canvas" | "global";
    menuPath?: string[];
    menuOrder?: number;
    /** A hold binding: released after it ran. */
    hold?: boolean;
}

/** Registers test commands; each records its id (and "id:release") when it runs. */
export function registerProbes(page: Page, probes: readonly Probe[]): Promise<void> {
    return page.evaluate((probes) => {
        const ran = (window.te008Calls ??= []);
        for (const probe of probes) {
            window.__ngneTest!.commands.register({
                id: probe.id,
                title: probe.title,
                shortcut: probe.shortcut,
                context: probe.context,
                menuPath: probe.menuPath,
                menuOrder: probe.menuOrder,
                enabled: () => probe.enabled ?? true,
                run: () => void ran.push(probe.id),
                release: probe.hold ? () => void ran.push(`${probe.id}:release`) : undefined,
            });
        }
    }, probes);
}

export const storedPreferences = (page: Page) =>
    page.evaluate(() => window.__ngneTest!.preferences.all());

export const recentCommands = (page: Page) =>
    page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]") as string[], RECENT_KEY);

export const storedItem = (page: Page, key: string) =>
    page.evaluate((key) => localStorage.getItem(key), key);

/** The outline of an element as "2px solid rgb(…), offset 1px", or "none". */
export function ringOf(target: Locator): Promise<string> {
    return target.evaluate((element) => {
        const style = getComputedStyle(element);
        return style.outlineStyle === "none"
            ? "none"
            : `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}, offset ${style.outlineOffset}`;
    });
}

/** Nothing of a closed modal surface is left on the page: the shell can be used again. */
export async function expectShellUsable(page: Page): Promise<void> {
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const leftovers = await page.evaluate(() => ({
        hidden: document.querySelectorAll("[inert], [data-aria-hidden]").length,
        pointerEvents: document.body.style.pointerEvents,
    }));
    expect(leftovers).toEqual({ hidden: 0, pointerEvents: "" });
}
