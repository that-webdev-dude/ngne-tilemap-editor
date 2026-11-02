import type { Page } from "@playwright/test";
import { overlayIdle } from "./te-014-support";
import { TILE_COLOURS } from "./te-017-support";
import type { CellSpec } from "./te-018-support";
import { expect, pageCall } from "./te-018-support";

// Shared helpers of the TE-019 specs, over the TE-018 ones (the TE-017 test map: 40 × 30 cells,
// Ground active, the grid hidden, so the overlay holds the previews only). Cells are
// [tile, orientation] as in TE-018; overlay pixels are read back from the overlay canvas.

export {
    LAYERS,
    activeTool,
    cellClient,
    cells,
    clickAt,
    drag,
    expect,
    history,
    moveTo,
    openEditor,
    pageCall,
    pressAt,
    put,
    redo,
    setStamp,
    stamp,
    statusMessage,
    undo,
} from "./te-018-support";
export { TILE_COLOURS, overlayIdle };
export type { CellSpec };

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** The entries of every cell of `rect` holding `cell`. */
export function rectEntries(rect: Rect, cell: CellSpec): [number, number, CellSpec][] {
    const entries: [number, number, CellSpec][] = [];
    for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x; x < rect.x + rect.width; x++) entries.push([x, y, cell]);
    }
    return entries;
}

/** The border cells of `rect` holding `cell`. */
export function ringEntries(rect: Rect, cell: CellSpec): [number, number, CellSpec][] {
    return rectEntries(rect, cell).filter(
        ([x, y]) =>
            x === rect.x ||
            y === rect.y ||
            x === rect.x + rect.width - 1 ||
            y === rect.y + rect.height - 1,
    );
}

/** `[x, y, cell]` entries as the page module lists cells: "x,y:tile/orientation", row by row. */
export function listed(entries: [number, number, CellSpec][]): string[] {
    return entries
        .filter(([, , cell]) => cell !== null)
        .sort(([ax, ay], [bx, by]) => ay - by || ax - bx)
        .map(([x, y, cell]) => `${x},${y}:${cell![0]}/${cell![1]}`);
}

export const cellDevice = (page: Page, x: number, y: number) =>
    pageCall<Rect>(page, "cellDevice", x, y);
export const pixel = (page: Page, x: number, y: number) =>
    pageCall<number[]>(page, "overlayPixel", x, y);
export const ink = (page: Page) => pageCall<number>(page, "overlayInk");
export const token = (page: Page, name: string) => pageCall<number>(page, "token", name);

const rgb = (colour: number) => [(colour >> 16) & 255, (colour >> 8) & 255, colour & 255];

/** 60% of 255 (DESIGN §4). */
export const PREVIEW_ALPHA = Math.round(0.6 * 255);

/** The overlay pixel at the centre of cell `(x, y)`. */
export async function centreOf(page: Page, x: number, y: number): Promise<number[]> {
    const rect = await cellDevice(page, x, y);
    return pixel(page, rect.x + Math.floor(rect.width / 2), rect.y + Math.floor(rect.height / 2));
}

/** Expects `actual` to be `colour` at `alpha`, each channel within 2 (premultiplied storage). */
export function expectColour(actual: number[], colour: number, alpha: number): void {
    const expected = [...rgb(colour), alpha];
    actual.forEach((channel, n) => expect(Math.abs(channel - expected[n]!)).toBeLessThanOrEqual(2));
}

/** Expects the centre of cell `(x, y)` to preview tile `tile`, or nothing for null. */
export async function expectPreview(
    page: Page,
    x: number,
    y: number,
    tile: number | null,
): Promise<void> {
    const actual = await centreOf(page, x, y);
    if (tile === null) expect(actual[3], `${x},${y}`).toBe(0);
    else expectColour(actual, TILE_COLOURS[tile]!, PREVIEW_ALPHA);
}

/** Holds `keys` down around `action`. */
export async function holding<T>(page: Page, keys: string[], action: () => Promise<T>): Promise<T> {
    for (const key of keys) await page.keyboard.down(key);
    try {
        return await action();
    } finally {
        for (const key of [...keys].reverse()) await page.keyboard.up(key);
    }
}
