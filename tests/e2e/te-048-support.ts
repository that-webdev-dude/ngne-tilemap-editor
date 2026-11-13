import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// Shared helpers of the TE-048 specs (adapted from the sprite editor's se-042 support): what
// the autosave database of the origin holds (read with IndexedDB from the page; the worker
// writes it), the launch check's mark, the recovery dialog, and Web Locks seen from a page.

const DATABASE = "ngne-tilemap-editor-autosave";

/** What a spec reads of one snapshot record. */
export interface SnapshotSummary {
    key: string;
    projectId: string;
    name: string;
    savedAt: number;
    owner: string;
    mapIds: string[];
    thumbnails: { mapId: string; name: string; width: number; height: number }[];
}

/** The autosave database's contents: its snapshot records and its record names. */
export interface AutosaveContents {
    snapshots: SnapshotSummary[];
    /** `key/name` of every entry record. */
    entries: string[];
    /** `key/name` of every pixel record. */
    pixels: string[];
}

/** Reads the autosave database without creating it. */
export function autosaveContents(page: Page): Promise<AutosaveContents> {
    return page.evaluate(async (name) => {
        const empty = { snapshots: [], entries: [], pixels: [] };
        const known = await indexedDB.databases();
        if (!known.some((database) => database.name === name)) return empty;
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const opening = indexedDB.open(name);
            opening.onsuccess = () => resolve(opening.result);
            opening.onerror = () => reject(opening.error);
        });
        try {
            if (!db.objectStoreNames.contains("snapshots")) return empty;
            const transaction = db.transaction(["snapshots", "entries", "pixels"], "readonly");
            const ask = <T>(request: IDBRequest<T>) =>
                new Promise<T>((resolve, reject) => {
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
            const [records, entries, pixels] = await Promise.all([
                ask(transaction.objectStore("snapshots").getAll()),
                ask(transaction.objectStore("entries").getAllKeys()),
                ask(transaction.objectStore("pixels").getAllKeys()),
            ]);
            type Stored = Omit<SnapshotSummary, "thumbnails"> & {
                thumbnails: { mapId: string; name: string; image: ImageData }[];
            };
            const snapshots = (records as Stored[]).map((record) => ({
                key: record.key,
                projectId: record.projectId,
                name: record.name,
                savedAt: record.savedAt,
                owner: record.owner,
                mapIds: [...record.mapIds],
                thumbnails: record.thumbnails.map(({ mapId, name, image }) => ({
                    mapId,
                    name,
                    width: image.width,
                    height: image.height,
                })),
            }));
            const names = (keys: IDBValidKey[]) =>
                keys
                    .map((key) => (key as string[]).join("/"))
                    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
            return { snapshots, entries: names(entries), pixels: names(pixels) };
        } finally {
            db.close();
        }
    }, DATABASE);
}

/** Waits until the database holds one snapshot that `accept` accepts; returns it. */
export async function waitForSnapshot(
    page: Page,
    accept: (snapshot: SnapshotSummary) => boolean = () => true,
): Promise<SnapshotSummary> {
    let found: SnapshotSummary | undefined;
    await expect
        .poll(
            async () => {
                const { snapshots } = await autosaveContents(page);
                found = snapshots.length === 1 && accept(snapshots[0]!) ? snapshots[0] : undefined;
                return found !== undefined;
            },
            { timeout: 10_000 },
        )
        .toBe(true);
    return found!;
}

/** Waits until the database holds no record at all. */
export async function expectNoSnapshot(page: Page): Promise<void> {
    await expect
        .poll(() => autosaveContents(page), { timeout: 10_000 })
        .toEqual({ snapshots: [], entries: [], pixels: [] });
}

/**
 * Waits until the launch check of the page is done; returns how many snapshots it offered
 * (the detail of its User Timing mark).
 */
export async function recoveryOffered(page: Page): Promise<number> {
    await page.waitForFunction(
        () => performance.getEntriesByName("ngne-autosave:recovery-checked").length > 0,
    );
    return page.evaluate(() => {
        const [mark] = performance.getEntriesByName(
            "ngne-autosave:recovery-checked",
        ) as PerformanceMark[];
        return (mark!.detail as { offered: number }).offered;
    });
}

/**
 * Waits, from `page`, until the lock the editor page `owner` held while it was open
 * (`ngne-tilemap-editor-page:<owner>`) is released: the page is gone for Web Locks.
 */
export async function waitForLockReleased(page: Page, owner: string): Promise<void> {
    await expect
        .poll(() =>
            page.evaluate(async (name) => {
                const { held = [] } = await navigator.locks.query();
                return held.some((lock) => lock.name === name);
            }, `ngne-tilemap-editor-page:${owner}`),
        )
        .toBe(false);
}

/** Leaves the page whatever the unload guard asks (`beforeunload`), from now on. */
export function acceptUnload(page: Page): void {
    page.on("dialog", (dialog) => {
        if (dialog.type() === "beforeunload") void dialog.accept();
    });
}

export const recoveryDialog = (page: Page): Locator =>
    page.getByRole("dialog", { name: "Recover unsaved work?" });

export const recoveryEntry = (page: Page, name: string): Locator =>
    recoveryDialog(page).locator(`[data-recovery-entry="${name}"]`);

/** Waits until the dialog has taken the focus (Radix moves it in after it opens). */
export async function dialogFocused(dialog: Locator): Promise<void> {
    await expect
        .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
        .toBe(true);
}
