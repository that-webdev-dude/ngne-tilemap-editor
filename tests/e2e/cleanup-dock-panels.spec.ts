import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { expect, openEditor } from "./te-013-support";

// Cleanup: the dock's sections follow a switch to another map after its frame (ENGINE §6, tab
// switch). Until then the Layers section shows the rows of the map before, and a press on one
// of them must not act on the map that is active now. The page module of TE-031 loads a map
// with tile layers 1 and 2; New Map adds one with tile layer 1 alone.

const PAGE_MODULE = "/tests/e2e/harness/te-031-page.ts";

function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

const rows = (page: Page) => page.locator("[data-layers-panel] [data-layer-row]");

/** Whether layer 1 of map `id` is visible. */
function layerVisible(page: Page, id: string): Promise<boolean> {
    return page.evaluate((mapId) => {
        const { project } = window.__ngneTest!.session.getState().session;
        return project.maps.find((map) => map.id === mapId)!.layers[0]!.visible;
    }, id);
}

test("a section that shows the map before a switch takes no input for the new map", async ({
    page,
}) => {
    await openEditor(page);
    const first = await call<string>(page, "load");
    const second = await call<string>(page, "addMap");
    await expect(rows(page)).toHaveCount(1);
    await page.locator(`[data-map-tab="${first}"]`).click();
    await expect(rows(page)).toHaveCount(2);

    // The switch and, one animation frame later, a press on the visibility toggle of the row
    // of layer 1, in the page: the section still shows the first map's rows then.
    const behind = await page.evaluate<number>(
        `import("/src/app/tabs/tabs.ts").then(async ({ activateMap }) => {
            activateMap(${JSON.stringify(second)});
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const shown = document.querySelectorAll("[data-layers-panel] [data-layer-row]").length;
            document.querySelector('[data-layer-row="1"] [data-layer-visible]').click();
            return shown;
        })`,
    );
    expect(behind).toBe(2);
    // Neither map's layer 1 was hidden by it.
    expect(await layerVisible(page, second)).toBe(true);
    expect(await layerVisible(page, first)).toBe(true);

    // Once the section shows the new map, the same press acts on it.
    await expect(rows(page)).toHaveCount(1);
    await page.locator('[data-layer-row="1"] [data-layer-visible]').click();
    await expect.poll(() => layerVisible(page, second)).toBe(false);
    expect(await layerVisible(page, first)).toBe(true);
});
