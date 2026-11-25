import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { openShell, region, THEME_KEY } from "./te-003-support";

// TE-003: dark by default (SUITE §2, §7). A theme set in Preferences is stored under
// `ngne-tilemap-editor.theme` and kept across a reload: te-008-preferences.

const PANEL = { dark: "rgb(24, 24, 26)", light: "rgb(244, 244, 245)" };

const storedTheme = (page: Page) => page.evaluate((key) => localStorage.getItem(key), THEME_KEY);
/** The shell's background, `--bg-panel`. */
const panelColour = (page: Page) =>
    region(page, "menu-bar").evaluate(
        (element) => getComputedStyle(element.parentElement!).backgroundColor,
    );

test("the theme is dark by default", async ({ page }) => {
    await openShell(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await storedTheme(page)).toBeNull();
    expect(await panelColour(page)).toBe(PANEL.dark);
});
