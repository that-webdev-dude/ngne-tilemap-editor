import type { Page } from "@playwright/test";
import type { CellSpec } from "./harness/te-018-page";
import { openEditor as openStampEditor } from "./te-017-support";

// Shared helpers of the TE-018 specs, over the TE-017 ones. The page module
// (harness/te-018-page.ts) re-exports the TE-017 page module, so both share the app's stores.

export {
    LAYERS,
    cellClient,
    clickAt,
    drag,
    expect,
    history,
    moveTo,
    pressAt,
    redo,
    statusMessage,
    undo,
} from "./te-017-support";
export type { CellSpec };

const PAGE_MODULE = "/tests/e2e/harness/te-018-page.ts";

/** Calls an export of the page module with JSON arguments; resolves with its JSON result. */
export function pageCall<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

/** Opens the editor on the TE-017 test map with the stamp brush, the viewport focused. */
export async function openEditor(page: Page, tool = "stamp"): Promise<void> {
    await openStampEditor(page, tool);
    await page.locator("[data-viewport]").focus();
}

export interface StampState {
    width: number;
    height: number;
    cells: CellSpec[];
}

export const setStamp = (page: Page, width: number, height: number, cells: CellSpec[]) =>
    pageCall<void>(page, "setOrientedStamp", width, height, cells);

export const stamp = (page: Page) => pageCall<StampState | null>(page, "stamp");

/** Writes `[x, y, cell]` entries into a tile layer (Ground by default), outside the history. */
export const put = (page: Page, entries: [number, number, CellSpec][], layer = 1) =>
    pageCall<void>(page, "put", layer, entries);

/** The non-empty cells of a tile layer (Ground by default) as "x,y:tile/orientation". */
export const cells = (page: Page, layer = 1) => pageCall<string[]>(page, "orientedCells", layer);

export const activeTool = (page: Page) => pageCall<string>(page, "activeTool");
