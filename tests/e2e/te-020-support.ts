import type { Page } from "@playwright/test";
import { expect, overlayIdle } from "./te-019-support";
import type { Rect } from "./te-019-support";

// Shared helpers of the TE-020 specs, over the TE-019 ones (the TE-017 test map: 40 × 30 cells,
// Ground active, the grid hidden, so the overlay holds the ants and the previews only). The
// page module (harness/te-020-page.ts) re-exports the TE-018 one, so all share the app's stores.

export * from "./te-019-support";

const PAGE_MODULE = "/tests/e2e/harness/te-020-page.ts";

/** Calls an export of the page module with JSON arguments; resolves with its JSON result. */
export function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

export interface SelectionState extends Rect {
    rows: string[];
}

/** The active map's tile selection, its rows `#` selected and `.` not; null without one. */
export const selection = (page: Page) => call<SelectionState | null>(page, "selection");

/** Selects the cells of `rect`, outside the history. */
export const setSelection = (page: Page, rect: Rect) =>
    call<void>(page, "setSelectionRect", rect.x, rect.y, rect.width, rect.height);

export const setMode = (page: Page, tool: string, mode: string) =>
    call<void>(page, "setMode", tool, mode);

export const ants = (page: Page) =>
    call<{ animating: boolean; ringWork: string } | null>(page, "ants");

/** The selection of `rect` as the page reports it. */
export function rectSelection(rect: Rect): SelectionState {
    return { ...rect, rows: Array<string>(rect.height).fill("#".repeat(rect.width)) };
}

/** The selection of a picture whose top-left cell is `(x, y)`, cut to its `#` cells by the caller. */
export function pictured(x: number, y: number, rows: string[]): SelectionState {
    return { x, y, width: rows[0]!.length, height: rows.length, rows };
}

/** The status bar's selection size field. */
export const selectionStatus = (page: Page) => page.locator('[data-status="selection"]');

/** Expects the marching ants around cell rectangle `rect`: opaque just outside it, clear inside. */
export async function expectAntsAround(page: Page, rect: Rect): Promise<void> {
    await overlayIdle(page);
    const first = await call<Rect>(page, "cellDevice", rect.x, rect.y);
    const last = await call<Rect>(
        page,
        "cellDevice",
        rect.x + rect.width - 1,
        rect.y + rect.height - 1,
    );
    const pixel = (x: number, y: number) => call<number[]>(page, "overlayPixel", x, y);
    const middleY = first.y + Math.floor(first.height / 2);
    const middleX = first.x + Math.floor(first.width / 2);
    // Left, right, top and bottom of the ring.
    expect((await pixel(first.x - 1, middleY))[3]).toBe(255);
    expect((await pixel(last.x + last.width, last.y + 1))[3]).toBe(255);
    expect((await pixel(middleX, first.y - 1))[3]).toBe(255);
    expect((await pixel(last.x + 1, last.y + last.height))[3]).toBe(255);
    // Nothing over the selected cells, nor two pixels out.
    expect((await pixel(middleX, middleY))[3]).toBe(0);
    expect((await pixel(first.x - 2, middleY))[3]).toBe(0);
}

/** Selects the `#` cells of `rows`, whose top-left cell is `(x, y)`, outside the history. */
export const setSelectionRows = (page: Page, x: number, y: number, rows: string[]) =>
    call<void>(page, "setSelectionRows", x, y, rows);

/** Makes `mapId` the active map, a new 20 × 10 map when null; resolves with both ids. */
export const switchMap = (page: Page, mapId: string | null) =>
    call<{ left: string; active: string }>(page, "switchMap", mapId);
