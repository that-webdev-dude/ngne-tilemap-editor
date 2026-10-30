import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { openGallery, openShell, region, THEME_KEY } from "./te-003-support";

// TE-003: dark by default; a theme set is stored under `ngne-tilemap-editor.theme` and kept
// across a reload (SUITE §2, §7). Preferences come with TE-008, so the gallery's theme control
// sets it here.

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

test("the light theme set and reloaded persists under ngne-tilemap-editor.theme", async ({
    page,
}) => {
    await openGallery(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("radio", { name: "Light" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await storedTheme(page)).toBe("light");
    // Only this app's key: nothing under the sprite editor's name.
    expect(
        await page.evaluate(() =>
            Object.keys(localStorage).filter((key) => key.includes("sprite")),
        ),
    ).toEqual([]);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Interface gallery" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page.emulateMedia({ reducedMotion: "reduce" });
    await openShell(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await panelColour(page)).toBe(PANEL.light);

    await page.evaluate((key) => localStorage.setItem(key, "dark"), THEME_KEY);
    await page.reload();
    await expect(region(page, "viewport")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
