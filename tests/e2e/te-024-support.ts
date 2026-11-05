import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { strFromU8, strToU8, unzipSync } from "fflate";
import { encodePng, writeZip } from "../../src/core/codec";
import type { PixelBuffer } from "../../src/core/codec";
// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../src/app/testing/testHooks";
import { packNgsprite } from "../support/ngsprite";
import { menuItem, openEditor, openMenu } from "./te-007-support";

// Shared by the TE-024 specs: files made in Node (grid PNGs, PNG headers, sprite projects,
// atlases), picking them through File → Import Tileset…, dropping them on the window, the
// dialog's parts, and the worker tasks the page sends.

export { expect, openEditor };

/** A file as Playwright's file chooser and the drop helper take it. */
export interface FilePayload {
    name: string;
    mimeType: string;
    buffer: Buffer;
}

const FIXTURES = new URL("../fixtures/sprite/", import.meta.url);

/**
 * A file of the TE-023 fixture pair (`tests/fixtures/sprite/`). A `.ngsprite` is stored unpacked
 * and packed from its folder (tests/support/ngsprite.ts).
 */
export function fixture(name: string): Buffer {
    if (name.endsWith(".ngsprite"))
        return Buffer.from(packNgsprite(new URL(`${name}.d/`, FIXTURES)));
    return readFileSync(new URL(name, FIXTURES));
}

export function png(name: string, pixels: PixelBuffer): FilePayload {
    return { name, mimeType: "image/png", buffer: Buffer.from(encodePng(pixels)) };
}

/** A `width × height` PNG whose pixel `(x, y)` is `x, y, 7, 255`. */
export function gridPng(name: string, width: number, height: number): FilePayload {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) data.set([x, y, 7, 255], (y * width + x) * 4);
    }
    return png(name, { width, height, data });
}

/**
 * The signature and IHDR of a PNG of `width × height`, without pixels: enough for its size,
 * and any decoder fails on it.
 */
export function pngHeader(name: string, width: number, height: number): FilePayload {
    const bytes = Buffer.alloc(33);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
    bytes.writeUInt32BE(width, 16);
    bytes.writeUInt32BE(height, 20);
    bytes.set([8, 6, 0, 0, 0], 24);
    return { name, mimeType: "image/png", buffer: bytes };
}

export function spriteFile(name: string, bytes: Uint8Array): FilePayload {
    return { name, mimeType: "application/zip", buffer: Buffer.from(bytes) };
}

/**
 * A sprite project of one frame, `size × size` px, its grid cell the whole canvas, so it has
 * no default grid when `size` is above 256 (SPEC §6.1). Made from the fixture's manifest and
 * document.
 */
export function squareSprite(size: number): Uint8Array {
    const entries = unzipSync(new Uint8Array(fixture("tiles.ngsprite")));
    const doc = JSON.parse(strFromU8(entries["doc.json"]!)) as Record<string, unknown> & {
        settings: { grid: Record<string, unknown>; symmetry: Record<string, unknown> };
    };
    doc.width = size;
    doc.height = size;
    doc.layers = [
        {
            id: "layer-ground",
            kind: "pixel",
            name: "Ground",
            visible: true,
            locked: false,
            opacity: 255,
            blend: "normal",
        },
    ];
    doc.frames = [{ id: "frame-a", durationMs: 100 }];
    doc.cels = [
        { layerId: "layer-ground", frameId: "frame-a", imageId: "image-big", opacity: 255 },
    ];
    doc.tags = [];
    doc.settings.grid = { ...doc.settings.grid, width: size, height: size };
    doc.settings.symmetry = { ...doc.settings.symmetry, axisX: size, axisY: size };
    const data = new Uint8ClampedArray(size * size * 4);
    for (let at = 0; at < data.length; at += 4) data.set([(at / 4) % 251, 40, 90, 255], at);
    return writeZip([
        { name: "manifest.json", data: entries["manifest.json"]!, stored: false },
        { name: "doc.json", data: strToU8(JSON.stringify(doc)), stored: false },
        {
            name: "images/image-big.png",
            data: encodePng({ width: size, height: size, data }),
            stored: true,
        },
    ]);
}

/** The fixture atlas as parsed JSON, to change before it is picked. */
export function fixtureAtlas(): Record<string, unknown> & {
    frames: Record<string, Record<string, unknown>>;
} {
    return JSON.parse(fixture("tiles.atlas.json.golden").toString("utf8"));
}

export function atlasFile(name: string, json: unknown): FilePayload {
    return {
        name,
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(json, null, 4)),
    };
}

/** Records the tasks the page sends to workers, in `window.__workerTasks`. */
export async function recordWorkerTasks(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const tasks: string[] = [];
        (window as unknown as { __workerTasks: string[] }).__workerTasks = tasks;
        const post = Worker.prototype.postMessage as (
            this: Worker,
            message: unknown,
            transfer: Transferable[],
        ) => void;
        Worker.prototype.postMessage = function (
            this: Worker,
            message: unknown,
            transfer?: Transferable[] | StructuredSerializeOptions,
        ) {
            const task = (message as { task?: unknown } | null)?.task;
            if (typeof task === "string") tasks.push(task);
            post.call(this, message, Array.isArray(transfer) ? transfer : []);
        };
    });
}

/** The worker tasks the page has sent, in order. */
export function workerTasks(page: Page): Promise<string[]> {
    return page.evaluate(() => [
        ...(window as unknown as { __workerTasks: string[] }).__workerTasks,
    ]);
}

export function importDialog(page: Page): Locator {
    return page.getByRole("dialog", { name: "Import Tileset" });
}

/** File → Import Tileset…, then `files` picked in the file chooser; returns the dialog. */
export async function importFiles(page: Page, files: FilePayload[]): Promise<Locator> {
    await openMenu(page, "File");
    const chooser = page.waitForEvent("filechooser");
    await menuItem(page, "file.importTileset").click();
    await (await chooser).setFiles(files);
    const dialog = importDialog(page);
    await expect(dialog).toBeVisible();
    return dialog;
}

/** Drops `files` on the page's body, as a drop from the system's file manager does. */
export async function dropFiles(page: Page, files: FilePayload[]): Promise<void> {
    const payload = files.map((file) => ({
        name: file.name,
        type: file.mimeType,
        bytes: [...file.buffer],
    }));
    const transfer = await page.evaluateHandle((files) => {
        const transfer = new DataTransfer();
        for (const file of files) {
            transfer.items.add(
                new File([new Uint8Array(file.bytes)], file.name, { type: file.type }),
            );
        }
        return transfer;
    }, payload);
    await page.dispatchEvent("body", "dragover", { dataTransfer: transfer });
    await page.dispatchEvent("body", "drop", { dataTransfer: transfer });
    await transfer.dispose();
}

/** A number field of the dialog. */
export const field = (dialog: Locator, label: string) =>
    dialog.getByRole("spinbutton", { name: label, exact: true });

/** Sets a number field of the dialog by typing a value and Enter. */
export async function setField(dialog: Locator, label: string, value: number): Promise<void> {
    const input = field(dialog, label);
    await input.fill(String(value));
    await input.press("Enter");
    await expect(input).toHaveValue(String(value));
}

export const confirmButton = (dialog: Locator) =>
    dialog.getByRole("button", { name: "Import", exact: true });

/** The counts line of the form. */
export const summary = (dialog: Locator) => dialog.locator("[data-import-summary]");

/** The refusals the form shows. */
export const problems = (dialog: Locator) => dialog.locator("[data-import-problem]");

/** The warnings the form shows. */
export const warnings = (dialog: Locator) => dialog.locator("[data-import-warnings] li");

/** The grid overlay's tiles, as `x,y,width,height` in source pixels. */
export function overlayCells(dialog: Locator): Promise<string[]> {
    return dialog
        .locator("[data-import-cell]")
        .evaluateAll((cells) => cells.map((cell) => cell.getAttribute("data-import-cell") ?? ""));
}

export interface TilesetSummary {
    name: string;
    exportName: string;
    tiles: number;
    animated: number;
    tileWidth: number;
    tileHeight: number;
}

/** What the project holds of its tilesets. */
export function tilesets(page: Page): Promise<TilesetSummary[]> {
    return page.evaluate(() =>
        window.__ngneTest!.session.getState().session.project.tilesets.map((tileset) => ({
            name: tileset.name,
            exportName: tileset.exportName,
            tiles: tileset.tiles.length,
            animated: tileset.tiles.filter((tile) => tile.animation.length > 0).length,
            tileWidth: tileset.tileWidth,
            tileHeight: tileset.tileHeight,
        })),
    );
}

/** The label of the history's next undo, or null. */
export function undoLabel(page: Page): Promise<string | null> {
    return page.evaluate(() => window.__ngneTest!.session.getState().history.undoLabel);
}

/** Edit → Undo, through the menu. */
export async function undoFromMenu(page: Page): Promise<void> {
    await openMenu(page, "Edit");
    await menuItem(page, "edit.undo").click();
}
