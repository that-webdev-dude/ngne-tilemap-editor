import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors, openGallery, openShell, seriousViolations } from "./te-003-support";

// TE-003: the dev gallery renders every primitive, and an axe scan (WCAG 2.1 A and AA) of the
// shell and of the gallery reports no serious or critical violation, in both themes.

/** Each component the primitives module exports, and the gallery demo that shows it. */
const DEMOS: Record<string, string> = {
    Button: "button",
    ContextMenu: "context-menu",
    Dialog: "dialog",
    Icon: "icon-button",
    IconButton: "icon-button",
    NumberField: "number-field",
    Popover: "popover",
    SegmentedControl: "segmented",
    Select: "select",
    Slider: "slider",
    Splitter: "splitter",
    Toggle: "toggle",
    ToolButton: "tool-button",
    Tooltip: "tooltip",
    TooltipProvider: "tooltip",
};

/** The components (capitalised value exports) of src/ui/primitives/index.ts. */
function primitiveExports(): string[] {
    const source = readFileSync(
        new URL("../../src/ui/primitives/index.ts", import.meta.url),
        "utf8",
    );
    return [...source.matchAll(/^export \{([^}]+)\} from/gm)]
        .flatMap((match) => (match[1] ?? "").split(","))
        .map((name) => name.trim())
        .filter((name) => /^[A-Z][a-z]/.test(name))
        .sort();
}

const demo = (page: Page, id: string) => page.locator(`[data-demo="${id}"]`);

test("the gallery renders every primitive", async ({ page }) => {
    const errors = collectErrors(page);
    await openGallery(page);
    expect(primitiveExports()).toEqual(Object.keys(DEMOS).sort());
    for (const id of new Set(Object.values(DEMOS))) await expect(demo(page, id)).toBeVisible();

    // Inline primitives, by their roles.
    await expect(demo(page, "button").getByRole("button", { name: "Primary" })).toBeVisible();
    await expect(demo(page, "icon-button").locator("svg").first()).toBeVisible();
    await expect(demo(page, "tool-button").getByRole("button").first()).toBeVisible();
    await expect(demo(page, "number-field").getByRole("spinbutton").first()).toBeVisible();
    await expect(demo(page, "slider").getByRole("slider").first()).toBeVisible();
    await expect(demo(page, "toggle").getByRole("button", { name: "Pixel grid" })).toBeVisible();
    await expect(demo(page, "select").getByRole("combobox").first()).toBeVisible();
    await expect(demo(page, "segmented").getByRole("radio").first()).toBeVisible();
    await expect(demo(page, "splitter").getByRole("separator")).toBeVisible();

    // Surfaces, opened from their demos.
    await demo(page, "dialog").getByRole("button", { name: "Open dialog" }).click();
    await expect(page.getByRole("dialog", { name: "New sprite" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await demo(page, "popover").getByRole("button", { name: "Open popover" }).click();
    await expect(page.getByRole("dialog", { name: "Onion skin" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await demo(page, "context-menu").getByLabel("Layer").click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);

    await demo(page, "tooltip").getByRole("button", { name: "Hover or focus" }).hover();
    await expect(page.getByRole("tooltip")).toContainText("Shown after 400 ms");
    expect(errors).toEqual([]);
});

for (const theme of ["dark", "light"] as const) {
    test(`axe reports no serious or critical violation on the shell and the gallery in the ${theme} theme`, async ({
        page,
    }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.addInitScript((theme) => {
            localStorage.setItem("ngne-tilemap-editor.theme", theme);
        }, theme);

        await openShell(page, { width: 1280, height: 720 });
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        expect(await seriousViolations(page), "shell").toEqual([]);
        // Every dock section expanded as well.
        for (const toggle of await page.locator(".dock-section__toggle").all()) {
            if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
        }
        expect(await seriousViolations(page), "shell, dock expanded").toEqual([]);

        await openGallery(page);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        expect(await seriousViolations(page), "gallery").toEqual([]);
    });
}
