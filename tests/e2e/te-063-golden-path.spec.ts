import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createProject } from "../../src/core/model";
import { importSprite, readSpriteOutline, spriteGridDefaults } from "../../src/core/tileset";
import type { DrawReport, FilesReport, MapInfo, View } from "./harness/te-063-game";
import type { LayerSummary, ProjectSummary } from "./harness/te-063-page";
import { collectErrors, region } from "./te-003-support";
import { menuItem, openMenu } from "./te-007-support";
import { confirmButton, fixture, gridPng, importFiles, spriteFile } from "./te-024-support";
import {
    arrangePickers,
    emptyState,
    errorToast,
    infoToast,
    newProject,
    openEmpty,
    opfsFile,
    projectName,
    stubPickers,
    unsavedMarker,
} from "./te-047-support";

// TE-063: the golden path, one script through the editor's real interface: a new project; a
// grid PNG and a `.ngsprite` imported as tilesets; a bucket fill and stamp strokes from both;
// a corner terrain set marked in the Terrains panel and painted with the terrain brush on a
// second tile layer; a marker layer with a rectangle and a custom property; save; reload;
// open; export through the Export dialog; and the fixture game (tests/fixtures/game) drawing
// the exported map as the compositor draws the saved project, pixel for pixel.
//
// The pickers are stubs over the origin private file system (OPFS): TE-047's for Save and Open,
// and a directory picker for the export folder, as TE-054's. Every cell, marker and property is
// held against values written here from the clicks, not against what the app computes; the
// sprite tileset's tile count is the import core's for the fixture (as TE-024's spec takes it).
// CI runs this spec 10 times in a row (ci.yml, golden-path).

const PAGE_MODULE = "/tests/e2e/harness/te-063-page.ts";
const PROJECT = "Golden path";
const FILE = "golden.ngtilemap";
const FOLDER = "game";
/** The map New Project makes: 20 × 15 cells of 16 px. */
const MAP = { width: 20, height: 15, tile: 16 } as const;
/** Map pixels drawn round the map in each view of the game. */
const MARGIN = 32;

/** Slots the two imported tilesets take, in import order (SPEC §2.1). */
const TERRAIN = 1;
const SPRITE = 2;

/** How many tiles the import core makes of the sprite fixture with its default grid. */
async function spriteTiles(bytes: Uint8Array): Promise<number> {
    const grid = spriteGridDefaults(readSpriteOutline(bytes))!;
    const { tileset } = await importSprite(createProject(), bytes, {
        fileName: "tiles.ngsprite",
        ...grid,
    });
    return tileset.tiles.length;
}

/** Corner indexes of a WangId (SPEC §5.1), and the bit of each in a terrain tile's ID. */
const CORNERS = [
    { index: 7, bit: 1, fx: 0.15, fy: 0.15 },
    { index: 1, bit: 2, fx: 0.85, fy: 0.15 },
    { index: 3, bit: 4, fx: 0.85, fy: 0.85 },
    { index: 5, bit: 8, fx: 0.15, fy: 0.85 },
] as const;
const TL = 1;
const TR = 2;
const BR = 4;
const BL = 8;

function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

const history = (page: Page) => call<{ undo: number; label: string | null }>(page, "history");
const summary = (page: Page) => call<ProjectSummary>(page, "summary");
const serialized = (page: Page) => call<string>(page, "serialized");

/** Expects the history to hold `undo` entries, the newest labelled `label`. */
async function expectEntry(page: Page, undo: number, label: string): Promise<void> {
    await expect.poll(() => history(page)).toEqual({ undo, label });
}

/** The export folder's directory picker, over an OPFS folder, before the app loads. */
async function stubExportFolder(page: Page): Promise<void> {
    await page.addInitScript((folder) => {
        Object.assign(window, {
            async showDirectoryPicker() {
                const root = await navigator.storage.getDirectory();
                return root.getDirectoryHandle(folder, { create: true });
            },
        });
    }, FOLDER);
}

/** Every file of the OPFS export folder, base64, by name. */
function exportedFiles(page: Page): Promise<Record<string, string>> {
    return page.evaluate(async (folder) => {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle(folder);
        const files: Record<string, string> = {};
        for await (const [name, handle] of (
            dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
        ).entries()) {
            if (handle.kind !== "file") continue;
            const bytes = new Uint8Array(
                await (await (handle as FileSystemFileHandle).getFile()).arrayBuffer(),
            );
            let text = "";
            for (let i = 0; i < bytes.length; i += 0x8000)
                text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            files[name] = btoa(text);
        }
        return files;
    }, FOLDER);
}

/** Moves the pointer to map pixel `(x, y)` of the active map. */
async function moveToMap(page: Page, x: number, y: number): Promise<void> {
    const at = await call<{ x: number; y: number }>(page, "mapClient", x, y);
    await page.mouse.move(at.x, at.y, { steps: 1 });
}

/** Clicks the centre of map cell `(x, y)`. */
async function clickCell(page: Page, x: number, y: number): Promise<void> {
    await moveToMap(page, (x + 0.5) * MAP.tile, (y + 0.5) * MAP.tile);
    await page.mouse.down();
    await page.mouse.up();
}

/** Drags from map pixel `from` to `to` through their middle. */
async function dragMap(page: Page, from: [number, number], to: [number, number]): Promise<void> {
    await moveToMap(page, ...from);
    await page.mouse.down();
    await moveToMap(page, (from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
    await moveToMap(page, ...to);
    await page.mouse.up();
}

/** Clicks point `(fx, fy)` of tile `index` in the Tilesets or the Terrains panel's grid. */
async function clickTile(
    page: Page,
    grid: "tiles" | "terrains",
    index: number,
    fx = 0.5,
    fy = 0.5,
): Promise<void> {
    const at = await call<{ x: number; y: number }>(page, "tileClient", grid, index, fx, fy);
    await page.mouse.click(at.x, at.y);
}

/** Shows tileset `name` in the Tilesets panel (and so in the Terrains panel). */
async function showTileset(page: Page, name: string): Promise<void> {
    const tab = page
        .locator("[data-tilesets-panel]")
        .getByRole("tablist", { name: "Tilesets" })
        .getByRole("tab", { name });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
}

/** Selects a tool with its key, the viewport hovered; checks the rail shows it pressed. */
async function selectTool(page: Page, key: string, slot: string): Promise<void> {
    await moveToMap(page, MAP.width * MAP.tile * 0.5, MAP.height * MAP.tile * 0.5);
    await page.keyboard.press(key);
    await expect(region(page, "tool-rail").locator(`[data-tool="${slot}"]`)).toHaveAttribute(
        "aria-pressed",
        "true",
    );
}

/** Imports `file` with File → Import Tileset… and the dialog's defaults. */
async function importTileset(
    page: Page,
    file: Parameters<typeof importFiles>[1][number],
): Promise<void> {
    const dialog = await importFiles(page, [file]);
    await expect(confirmButton(dialog)).toBeEnabled();
    await confirmButton(dialog).click();
    await expect(dialog).toHaveCount(0);
}

/** `x,y:slot/tile` for every cell of a rectangle, row by row. */
function rect(x0: number, y0: number, x1: number, y1: number, slot: number, tile: number) {
    const out: string[] = [];
    for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) out.push(`${x},${y}:${slot}/${tile}`);
    return out;
}

/** Cells as `x,y:value` sorted row by row, as the summary lists them. */
function rowOrder(cells: string[]): string[] {
    const key = (cell: string) => {
        const [x, y] = cell.split(":")[0]!.split(",").map(Number);
        return y! * MAP.width + x!;
    };
    return [...cells].sort((a, b) => key(a) - key(b));
}

/** The views of a map at `scale`: the whole map and its margin, and one less a pixel a side. */
function viewsOf(map: MapInfo, scale: number): View[] {
    const width = map.width + 2 * MARGIN;
    const height = map.height + 2 * MARGIN;
    return [
        { x: -MARGIN, y: -MARGIN, width, height },
        { x: 7 - MARGIN, y: 5 - MARGIN, width: width - 1, height: height - 1 },
    ].map((area) => ({
        map: map.name,
        scale,
        camera: { x: Math.round(area.x * scale), y: Math.round(area.y * scale) },
        width: Math.ceil(area.width * scale),
        height: Math.ceil(area.height * scale),
    }));
}

test("golden path: new project → grid PNG and .ngsprite imported → bucket, stamp and terrain brush → layers, marker, property → save → reload → open → export → the fixture game draws it as the compositor does", async ({
    page,
}, testInfo) => {
    // About a minute on a warm local run; SwiftShader in CI is several times slower.
    test.setTimeout(300_000);
    const errors = collectErrors(page);
    await stubPickers(page);
    await stubExportFolder(page);

    // New project.
    await openEmpty(page);
    await newProject(page, PROJECT, { width: MAP.width, height: MAP.height });
    await page.waitForFunction(() => window.__ngneTest?.viewport?.status === "ready");
    await openMenu(page, "View");
    await menuItem(page, "view.fit").click();
    let undo = (await history(page)).undo;

    // Import a grid PNG (16 tiles of 16 px: `terrain`) and a sprite project (8 px: `tiles`).
    await importTileset(page, gridPng("terrain.png", 64, 64));
    await expectEntry(page, ++undo, "Import Tileset");
    const sprite = fixture("tiles.ngsprite");
    await importTileset(page, spriteFile("tiles.ngsprite", sprite));
    await expectEntry(page, ++undo, "Import Tileset");
    const tilesets: ProjectSummary["tilesets"] = [
        { name: "terrain", slot: TERRAIN, tiles: 16, tileWidth: 16 },
        {
            name: "tiles",
            slot: SPRITE,
            tiles: await spriteTiles(new Uint8Array(sprite)),
            tileWidth: 8,
        },
    ];
    expect(tilesets[1]!.tiles).toBeGreaterThan(0);
    expect((await summary(page)).tilesets).toEqual(tilesets);

    // Bucket fill (G) of the empty layer with terrain tile 0: a new stamp keeps the bucket.
    await selectTool(page, "g", "bucket");
    await showTileset(page, "terrain");
    await clickTile(page, "tiles", 0);
    await clickCell(page, 10, 7);
    await expectEntry(page, ++undo, "Bucket Fill");

    // Stamp brush (B): a drag over row 2 with terrain tile 5, then a tile of the sprite tileset
    // clicked once.
    await selectTool(page, "b", "stamp");
    await clickTile(page, "tiles", 5);
    await dragMap(page, [2.5 * MAP.tile, 2.5 * MAP.tile], [6.5 * MAP.tile, 2.5 * MAP.tile]);
    await expectEntry(page, ++undo, "Stamp Brush");
    await showTileset(page, "tiles");
    await clickTile(page, "tiles", 1);
    await clickCell(page, 8, 2);
    await expectEntry(page, ++undo, "Stamp Brush");

    // A second tile layer from the Layers panel; it is the active layer.
    const layers = page.locator('[data-dock-panel="layers"]');
    await layers.locator("[data-new-layer]").click();
    await expectEntry(page, ++undo, "New Tile Layer");

    // A corner terrain set on `terrain`, its one terrain marked on tiles 1–15: tile `t` has the
    // terrain at the corners of its bits (TL 1, TR 2, BR 4, BL 8), so every combination exists.
    await showTileset(page, "terrain");
    await region(page, "bottom-panel").getByRole("tab", { name: "Terrains" }).click();
    await page.locator("[data-terrain-set-add]").click();
    await page.locator('[role="menuitem"][data-command="terrain.newCornerSet"]').click();
    await expectEntry(page, ++undo, "Add Terrain Set");
    const rename = page.locator("[data-terrain-rename]");
    await rename.fill("Ground");
    await rename.press("Enter");
    await expect(rename).toHaveCount(0);
    await expectEntry(page, ++undo, "Change Terrain Set Name");
    for (let tile = 1; tile < 16; tile++) {
        for (const corner of CORNERS) {
            if ((tile & corner.bit) === 0) continue;
            await clickTile(page, "terrains", tile, corner.fx, corner.fy);
            await expectEntry(page, ++undo, "Change Tile Terrain");
        }
    }

    // Terrain brush (T): two neighbouring vertices, each clicked a quarter cell inside the cell
    // it is the top-left corner of.
    await selectTool(page, "t", "terrain");
    const swatch = page.locator('[data-context-content="terrain-brush"] [data-terrain-swatch="1"]');
    await swatch.click();
    await expect(swatch).toHaveAttribute("aria-pressed", "true");
    for (const vx of [12, 13]) {
        await moveToMap(page, (vx + 0.25) * MAP.tile, 6.25 * MAP.tile);
        await page.mouse.down();
        await page.mouse.up();
        await expectEntry(page, ++undo, "Terrain Brush");
    }

    // A marker layer from the panel's menu; Rectangle (U) dragged between cell corners; the new
    // marker is selected, and the Properties panel adds an int property to it and sets it.
    await layers.locator("[data-new-layer-menu]").click();
    await page.locator('[data-new-layer-kind="layer.newMarker"]').click();
    await expectEntry(page, ++undo, "New Marker Layer");
    await selectTool(page, "u", "markerRectangle");
    await dragMap(page, [2 * MAP.tile, 10 * MAP.tile], [6 * MAP.tile, 13 * MAP.tile]);
    await expectEntry(page, ++undo, "Add Marker");
    await expect(page.locator("[data-properties-subject]")).toContainText("Marker");
    await page.locator("[data-property-add]").click();
    await page.locator("[data-property-add-name]").fill("speed");
    await page.locator("[data-property-add-type]").getByRole("combobox").click();
    await page.getByRole("option", { name: "int", exact: true }).click();
    await page.locator("[data-property-add-confirm]").click();
    await expectEntry(page, ++undo, "Add Property");
    const speed = page
        .locator('[data-properties-panel] [data-property="speed"] [data-property-value]')
        .getByRole("spinbutton");
    await speed.fill("3");
    await speed.press("Enter");
    await expectEntry(page, undo + 1, "Change Property");

    // What the clicks made, written out by hand.
    const ground: LayerSummary = {
        type: "tile",
        name: "Tile Layer 1",
        properties: [],
        cells: rowOrder([
            ...rect(0, 0, MAP.width - 1, MAP.height - 1, TERRAIN, 0).filter(
                (cell) => !/^([2-6]|8),2:/.test(cell),
            ),
            ...rect(2, 2, 6, 2, TERRAIN, 5),
            `8,2:${SPRITE}/1`,
        ]),
    };
    const terrain: LayerSummary = {
        type: "tile",
        name: "Tile Layer 2",
        properties: [],
        cells: [
            `11,5:${TERRAIN}/${BR}`,
            `12,5:${TERRAIN}/${BL | BR}`,
            `13,5:${TERRAIN}/${BL}`,
            `11,6:${TERRAIN}/${TR}`,
            `12,6:${TERRAIN}/${TL | TR}`,
            `13,6:${TERRAIN}/${TL}`,
        ],
    };
    const markers: LayerSummary = {
        type: "marker",
        name: "Marker Layer 1",
        properties: [],
        markers: [{ shape: "rectangle", x: 32, y: 160, width: 64, height: 48 }],
        markerProperties: [[{ name: "speed", type: "int", value: 3 }]],
    };
    const wangIds = Array.from({ length: 15 }, (_, k) => {
        const tile = k + 1;
        const wangId = [0, 0, 0, 0, 0, 0, 0, 0];
        for (const corner of CORNERS) if (tile & corner.bit) wangId[corner.index] = 1;
        return `${tile}:${wangId.join("")}`;
    });
    const expected: ProjectSummary = {
        name: PROJECT,
        tilesets,
        terrainSets: [
            { tileset: "terrain", name: "Ground", type: "corner", terrains: 1, tiles: wangIds },
        ],
        maps: [
            {
                name: "Map 1",
                width: MAP.width,
                height: MAP.height,
                layers: [ground, terrain, markers],
            },
        ],
    };
    expect(await summary(page)).toEqual(expected);

    // Save (Ctrl+S): the file holds the project as it is.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await arrangePickers(page, { nextSave: [FILE] });
    await page.keyboard.press("Control+KeyS");
    await expect(infoToast(page, `Saved ${FILE}`)).toBeVisible();
    await expect(unsavedMarker(page)).toHaveCount(0);
    const file = Buffer.from(await opfsFile(page, FILE)).toString("base64");
    expect(file).toBe(await serialized(page));

    // Reload, then open (Ctrl+O): the same project, the same bytes.
    await page.reload();
    await page.waitForFunction(() => window.__ngneTest !== undefined);
    await expect(emptyState(page)).toBeVisible();
    await arrangePickers(page, { nextOpen: [FILE] });
    await page.keyboard.press("Control+KeyO");
    await expect(infoToast(page, `Opened ${FILE}`)).toBeVisible();
    await expect(projectName(page)).toHaveText(PROJECT);
    expect(await summary(page)).toEqual(expected);
    expect(await serialized(page)).toBe(file);
    await page.waitForFunction(() => window.__ngneTest?.viewport?.status === "ready");

    // Export (Ctrl+E) into the folder chosen in the dialog.
    await page.keyboard.press("Control+KeyE");
    const dialog = page.getByRole("dialog", { name: "Export" });
    await expect(dialog.locator("[data-export-files]")).toBeVisible();
    await dialog.getByRole("button", { name: "Choose folder…" }).click();
    await expect(dialog.locator("[data-export-folder]")).toHaveText(FOLDER);
    await dialog.locator("[data-export-submit]").click();
    await expect(dialog).toHaveCount(0);
    const names = [
        "ngne-tilemap.export.json",
        "terrain.png",
        "tiles.png",
        "terrain.atlas.json",
        "tiles.atlas.json",
        "map-1.tilemap.json",
        "ngne-tilemap.ts",
    ];
    await expect(
        infoToast(
            page,
            `Exported “${PROJECT}” to “${FOLDER}”: ${names.length} files written, 0 unchanged`,
        ),
    ).toBeVisible();
    await expect(errorToast(page)).toHaveCount(0);
    const exported = await exportedFiles(page);
    expect(Object.keys(exported).sort()).toEqual([...names].sort());
    expect(errors).toEqual([]);

    // The fixture game: the export, written into the checkout and served by the dev server.
    const directory = testInfo.outputPath("export");
    mkdirSync(directory, { recursive: true });
    for (const [name, base64] of Object.entries(exported))
        writeFileSync(join(directory, name), Buffer.from(base64, "base64"));
    const url = `/${relative(testInfo.config.rootDir, directory).split(sep).join("/")}/`;
    await page.goto("/tests/e2e/harness/te-063-game.html");
    await expect(page.locator("#status")).toHaveText("ready");
    const maps = await page.evaluate((base64) => window.__te063!.load(base64), file);
    await page.evaluate((folder) => window.__te063!.open(folder), url);
    const report = await page.evaluate<FilesReport>(() => window.__te063!.checkFiles());
    expect(report).toEqual({ atlases: 2, tilemaps: 1, problems: [] });
    for (const map of maps) {
        for (const scale of [1, 3]) {
            for (const view of viewsOf(map, scale)) {
                const drawn = await page.evaluate<DrawReport, View>(
                    (request) => window.__te063!.compare(request),
                    view,
                );
                const label = `${view.map} at ${scale}, camera ${view.camera.x}, ${view.camera.y}`;
                expect.soft(drawn.pixelSnap, label).toBe(true);
                expect.soft(drawn.reports, label).toEqual([]);
                expect.soft(drawn.examples, label).toEqual([]);
                expect.soft(drawn.wrong, label).toBe(0);
                expect.soft(drawn.drawn, label).toBeGreaterThan(0);
            }
        }
    }
    expect(errors).toEqual([]);
});
