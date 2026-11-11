import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
// The page imports these modules from the dev server; here they are needed for their types.
import type { FixtureId, MapInfo, View } from "./harness/te-055-game";

// TE-055: the conformance of SPEC §10.3 for every fixture, at one device pixel ratio. Shared by
// te-055-conformance.spec.ts (DPR 1) and te-055-conformance-dpr125.spec.ts (DPR 1.25).
//
// Each test exports its fixture in the browser (`exportFiles`, as the editor does), writes the
// files into the test's output folder in the checkout, and opens the exported `ngne-tilemap.ts`
// from the dev server, as a game's dev server serves an export folder. The fixture game
// (tests/fixtures/game, `@ngne/core` 0.3.0) draws each map with `pixelSnap` on.

const FIXTURES: { id: FixtureId; title: string }[] = [
    { id: "conformance", title: "the reference export project" },
    { id: "format-golden", title: "the FORMAT fixture golden-v1.ngtilemap" },
    { id: "export-test", title: "TE-053's export project" },
    { id: "reference", title: "ENGINE §6's reference project" },
];

/** Map pixels drawn around a map, so tiles reaching out of it are drawn too. */
const MARGIN = 32;
/** A map larger than this a side is drawn through windows. */
const WHOLE_MAP = 1024;
/** Windows of a large map, in map pixels: its top-left corner, and inside it. */
const WINDOWS = [
    { x: -MARGIN, y: -MARGIN, width: 240, height: 136 },
    { x: 2000, y: 1500, width: 240, height: 136 },
];

/**
 * The views of a map at `scale`: the whole map with its margin, and the same less one pixel a
 * side with the camera off centre; or the windows of a large map. The second view has an odd
 * size, so its centre, and with it every parallax shift, falls between whole pixels.
 */
export function viewsOf(map: MapInfo, scale: number): View[] {
    const width = map.width + 2 * MARGIN;
    const height = map.height + 2 * MARGIN;
    const areas =
        map.width <= WHOLE_MAP && map.height <= WHOLE_MAP
            ? [
                  { x: -MARGIN, y: -MARGIN, width, height },
                  { x: 7 - MARGIN, y: 5 - MARGIN, width: width - 1, height: height - 1 },
              ]
            : WINDOWS;
    return areas.map((area) => ({
        map: map.name,
        scale,
        camera: { x: Math.round(area.x * scale), y: Math.round(area.y * scale) },
        width: Math.ceil(area.width * scale),
        height: Math.ceil(area.height * scale),
    }));
}

/**
 * Exports `fixture` in the page, writes its files into the test's output folder and lets the
 * page import the exported runtime from there. Returns the fixture's maps.
 */
export async function openFixture(
    page: Page,
    testInfo: TestInfo,
    fixture: FixtureId,
): Promise<MapInfo[]> {
    // The weekly `latest` job draws with the newest engine (vite.config.ts, NGNE_CORE_DIR).
    const engine = process.env.NGNE_CORE_DIR;
    if (engine) {
        const { version } = JSON.parse(readFileSync(join(engine, "package.json"), "utf8"));
        testInfo.annotations.push({ type: "engine", description: `@ngne/core ${version}` });
    }
    await page.goto("/tests/e2e/harness/te-055-game.html");
    await expect(page.locator("#status")).toHaveText("ready");
    const { files, maps } = await page.evaluate((id) => window.__te055!.exportFixture(id), fixture);
    const directory = testInfo.outputPath("export");
    mkdirSync(directory, { recursive: true });
    for (const file of files)
        writeFileSync(join(directory, file.name), Buffer.from(file.base64, "base64"));
    const url = `/${relative(testInfo.config.rootDir, directory).split(sep).join("/")}/`;
    await page.evaluate((folder) => window.__te055!.open(folder), url);
    expect(maps.length).toBeGreaterThan(0);
    return maps;
}

/** The conformance tests at device pixel ratio `ratio`. */
export function conformanceTests(ratio: number): void {
    test.describe.configure({ timeout: 180_000 });

    for (const { id, title } of FIXTURES) {
        test.describe(`the export of ${title} at DPR ${ratio}`, () => {
            test("passes validateAtlas and validateTilemap, and reads back as the project", async ({
                page,
            }, testInfo) => {
                await openFixture(page, testInfo, id);
                expect(await page.evaluate(() => window.devicePixelRatio)).toBe(ratio);
                const report = await page.evaluate(() => window.__te055!.checkFiles());
                expect(report.problems).toEqual([]);
                expect(report.atlases).toBeGreaterThan(0);
                expect(report.tilemaps).toBeGreaterThan(0);
            });

            test("draws every map at scales 1 and 3 as the compositor does, pixel for pixel", async ({
                page,
            }, testInfo) => {
                const maps = await openFixture(page, testInfo, id);
                for (const map of maps) {
                    for (const scale of [1, 3]) {
                        for (const view of viewsOf(map, scale)) {
                            const report = await page.evaluate(
                                (request) => window.__te055!.compare(request),
                                view,
                            );
                            const label = `${view.map} at ${scale}, camera ${view.camera.x}, ${view.camera.y}`;
                            expect.soft(report.pixelSnap, label).toBe(true);
                            expect.soft(report.reports, label).toEqual([]);
                            expect.soft(report.examples, label).toEqual([]);
                            expect.soft(report.wrong, label).toBe(0);
                            // Each view saw tiles, not an empty canvas against an empty reference.
                            expect.soft(report.drawn, label).toBeGreaterThan(0);
                        }
                    }
                }
            });

            test("at scale 1.25 shows in every pixel only colours of the tile drawn there", async ({
                page,
            }, testInfo) => {
                const maps = await openFixture(page, testInfo, id);
                for (const map of maps) {
                    // A layer may lie out of every view (golden-v1's Ground is moved millions of
                    // pixels by its parallax), but each map shows tiles in some layer and view.
                    let drawn = 0;
                    for (const view of viewsOf(map, 1.25)) {
                        for (const layer of map.tileLayers) {
                            const report = await page.evaluate(
                                ({ request, index }) =>
                                    window.__te055!.checkColours(request, index),
                                { request: view, index: layer },
                            );
                            const label = `${view.map} layer ${layer}, camera ${view.camera.x}, ${view.camera.y}`;
                            expect.soft(report.pixelSnap, label).toBe(true);
                            expect.soft(report.reports, label).toEqual([]);
                            expect.soft(report.examples, label).toEqual([]);
                            expect.soft(report.wrong, label).toBe(0);
                            drawn += report.drawn;
                        }
                    }
                    if (map.tileLayers.length > 0) expect.soft(drawn, map.name).toBeGreaterThan(0);
                }
            });
        });
    }
}
