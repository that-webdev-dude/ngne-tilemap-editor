import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type {} from "./harness/te-003-boundary";
import { boxOf, region, regionBoxes, REGIONS } from "./te-003-support";
import type { Region } from "./te-003-support";

// TE-003: a component that throws inside one region shows that region's error boundary while
// the others keep working (`se-design` §4). Adapted from the sprite editor's
// se-006-boundary.spec.ts; the harness page mounts the real shell with one failing region.

const HARNESS = "/tests/e2e/harness/te-003-boundary.html";
const NAMES: Record<Region, string> = {
    "menu-bar": "Menu bar",
    "tool-rail": "Tool rail",
    "context-bar": "Context bar",
    viewport: "Viewport",
    dock: "Panels",
    "bottom-panel": "Bottom panel",
    "status-bar": "Status bar",
};

/** Uncaught errors only: React reports the error a boundary caught on the console itself. */
function uncaughtErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    return errors;
}

/**
 * What the unaffected regions still do: collapse, switch tabs. The splitters lie outside the
 * boundaries, so they resize their region whichever content failed.
 */
async function expectOthersWork(page: Page, failed: Region | "dock-panel") {
    for (const id of REGIONS) await expect(region(page, id)).toBeVisible();

    const panel = region(page, "bottom-panel");
    const before = (await boxOf(panel)).height;
    await page.getByRole("separator", { name: "Resize bottom panel" }).focus();
    await page.keyboard.press("ArrowUp");
    expect((await boxOf(panel)).height).toBe(before + 8);
    await page.keyboard.press("Enter");
    if (failed !== "bottom-panel") {
        const terrains = panel.getByRole("tab", { name: "Terrains" });
        await terrains.click();
        await expect(terrains).toHaveAttribute("aria-selected", "true");
    }
    if (failed !== "dock" && failed !== "dock-panel") {
        const maps = region(page, "dock").getByRole("button", { name: "Maps" });
        const expanded = await maps.getAttribute("aria-expanded");
        await maps.click();
        await expect(maps).not.toHaveAttribute("aria-expanded", expanded ?? "");
    }
    const dock = region(page, "dock");
    const width = (await boxOf(dock)).width;
    await page.getByRole("separator", { name: "Resize panels" }).focus();
    await page.keyboard.press("ArrowLeft");
    expect((await boxOf(dock)).width).toBe(width + 8);
    await page.keyboard.press("Enter");
}

for (const id of REGIONS) {
    test(`a component that throws in the ${NAMES[id]} region shows its boundary while the other regions keep working`, async ({
        page,
    }) => {
        const uncaught = uncaughtErrors(page);
        await page.goto(HARNESS);
        await expect(region(page, "viewport")).toBeVisible();
        const healthy = await regionBoxes(page);

        await page.goto(`${HARNESS}?region=${id}`);
        const failed = region(page, id);
        const message = `${NAMES[id]} failed to render.`;
        const alert = failed.getByRole("alert");
        await expect(alert).toBeVisible();
        // The rail is too narrow for a line of text: its Reload button carries the message.
        const reload =
            id === "tool-rail"
                ? alert.getByRole("button", { name: `${message} Reload` })
                : alert.getByRole("button", { name: "Reload" });
        if (id !== "tool-rail") await expect(alert).toHaveText(`${message}Reload`);
        await expect(reload).toBeVisible();
        await expect(page.getByRole("alert")).toHaveCount(1);

        // The layout holds: every region is where it is without the failure.
        expect(await regionBoxes(page)).toEqual(healthy);
        await expectOthersWork(page, id);

        // Reload mounts the content again: it fails while broken, recovers once repaired.
        await reload.click();
        await expect(alert).toBeVisible();
        await page.evaluate(() => {
            window.te003Repaired = true;
        });
        await reload.click();
        await expect(failed.locator("[data-fragile]")).toHaveText("Content restored");
        await expect(page.getByRole("alert")).toHaveCount(0);
        expect(uncaught).toEqual([]);
    });
}

test("a dock panel that throws shows its boundary while the other panels keep working", async ({
    page,
}) => {
    const uncaught = uncaughtErrors(page);
    await page.goto(`${HARNESS}?region=dock-panel`);
    const dock = region(page, "dock");
    const fragile = dock.locator('[data-dock-panel="fragile"]');
    await expect(fragile.getByRole("alert")).toHaveText("Fragile failed to render.Reload");
    await expect(fragile.getByRole("button", { name: "Fragile" })).toBeVisible();
    await expect(dock.locator("[data-steady]")).toHaveText("Steady content");
    await expect(page.getByRole("alert")).toHaveCount(1);
    await expectOthersWork(page, "dock-panel");

    await page.evaluate(() => {
        window.te003Repaired = true;
    });
    await fragile.getByRole("button", { name: "Reload" }).click();
    await expect(fragile.locator("[data-fragile]")).toHaveText("Content restored");
    expect(uncaught).toEqual([]);
});
