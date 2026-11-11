import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Comparison, Geometry } from "./harness/te-036-page";
import { texturesReady } from "./te-013-support";
import { emptyState, openEmpty } from "./te-047-support";
import {
    expect,
    golden,
    importButton,
    mapWithFiles,
    removeFolderPicker,
    tmjDialog,
} from "./te-061-support";

// TE-061: the three composite fixtures of SPEC §13 (a 1000 × 40 side-scroller with a repeated
// parallax image layer, a 256 × 256 overworld with groups, group opacity and parallax, a small
// dungeon with markers and collision) imported through the dialog render as the compositor
// reference: the canvas, read back in the page, equals `core/compositor`'s image of the map
// (TE-036's comparison, harness/te-036-page.ts), in the live tier at 2 device px per map px.
//
// The view centre is whole map pixels, (centre − parallax origin) a multiple of 10, so every
// layer's parallax shift (factors 0.2 and 0.5) is whole map pixels, as the compositor draws
// them. Pixel centres on a map pixel's edge (an odd canvas side) are ties, not compared. GPU
// blending rounds each layer to 8 bits: the tolerance is 2 per channel, as TE-015's and
// TE-036's.

const TOLERANCE = 2;
const SCALE = 2;
const PAGE_MODULE = "/tests/e2e/harness/te-061-page.ts";

function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

/** The composite maps and the map point each view is centred near. */
const CASES = [
    // The start: sky over hills, grass, the first platforms and the player's spawn.
    { map: "side-scroller.tmj", near: { x: 400, y: 450 } },
    // The centre: the road cross over land, clouds in the sky group above.
    { map: "overworld.tmj", near: { x: 2050, y: 2050 } },
    // The whole dungeon.
    { map: "dungeon.tmj", near: { x: 190, y: 130 } },
] as const;

for (const { map, near } of CASES) {
    test(`${map} imported renders as the compositor reference`, async ({ page }) => {
        await removeFolderPicker(page);
        await openEmpty(page);
        // With no project open, Import makes one whose only map is the import.
        const chooser = page.waitForEvent("filechooser");
        await emptyState(page).getByRole("button", { name: "Import Tiled Map" }).click();
        await (await chooser).setFiles(mapWithFiles(map));
        const dialog = tmjDialog(page);
        await expect(dialog.locator("[data-tmj-summary]")).toBeVisible();
        await importButton(dialog).click();
        await expect(dialog).toHaveCount(0);
        await page.waitForFunction(() => window.__ngneTest?.viewport?.status === "ready");

        const info = await call<{
            parallaxOriginX: number;
            parallaxOriginY: number;
            tilesets: number;
            images: number;
        }>(page, "mapInfo");
        const expected = golden(map);
        if ("refused" in expected) throw new Error(`${map} is refused`);
        expect(info.tilesets).toBe(expected.summary.tilesets.length);
        const centre = (point: number, origin: number) =>
            origin + Math.round((point - origin) / 10) * 10;
        const geometry = await call<Geometry>(
            page,
            "placeView",
            SCALE,
            centre(near.x, info.parallaxOriginX),
            centre(near.y, info.parallaxOriginY),
        );
        await texturesReady(page, info.tilesets);
        await expect.poll(() => call<boolean>(page, "drawn", info.images)).toBe(true);
        const result = await call<Comparison>(page, "compare", geometry, TOLERANCE);
        test.info().annotations.push({
            type: "readback",
            description: JSON.stringify({ map, ...result, first: undefined }),
        });
        expect(result.tier).toBe("live");
        expect(result.tileQuads).toBeGreaterThan(0);
        if (info.images > 0) expect(result.imageQuads).toBeGreaterThan(0);
        const area = geometry.width * geometry.height;
        expect(result.compared + result.ties).toBe(area);
        expect(result.compared).toBeGreaterThan(0.45 * area);
        expect(result.first).toEqual([]);
        expect(result.mismatches).toBe(0);
    });
}
