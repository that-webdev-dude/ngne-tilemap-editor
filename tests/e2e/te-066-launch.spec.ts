import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createProject } from "../../src/core/model";
import { deserialize, serialize } from "../../src/core/project";
import { collectErrors } from "./te-003-support";
import {
    emptyState,
    errorToast,
    infoToast,
    opfsFile,
    projectName,
    saveDialog,
    unsavedMarker,
} from "./te-047-support";
import { buildApp, openBuilt, serve } from "./te-066-support";
import type { Served } from "./te-066-support";

// TE-066 (adapted from the sprite editor's se-072-launch spec): the installed app opens the
// `.ngtilemap` file it is launched with (the manifest's `file_handlers`) as the window's
// project. Chrome hands the file to the page through `window.launchQueue`, which this spec
// stubs before the app loads: a launch is kept until the page sets its consumer, as Chrome
// keeps it, and is then delivered with File System Access handles. The handles are real ones,
// of files the spec writes to the origin private file system (OPFS), so Save writes back to
// the launched file as it would to the disk. The production build, without test hooks: what
// the spec reads is on screen, in OPFS or in the stub.

declare global {
    interface Window {
        /** Delivers one launch of the OPFS files `names` (the stub below). */
        __te066Launch?(names: string[]): Promise<void>;
    }
}

/** The bytes of a project file `name` with one `width` × `height` map. */
function projectBytes(name: string, width: number, height: number): number[] {
    return Array.from(serialize(createProject({ name, map: { width, height } })));
}

/** Writes `files` to the page's OPFS. */
async function writeFiles(page: Page, files: Record<string, number[]>): Promise<void> {
    await page.evaluate(async (files) => {
        const root = await navigator.storage.getDirectory();
        for (const [name, bytes] of Object.entries(files)) {
            const handle = await root.getFileHandle(name, { create: true });
            const writable = await handle.createWritable();
            await writable.write(Uint8Array.from(bytes));
            await writable.close();
        }
    }, files);
}

/**
 * Replaces `window.launchQueue` before the app loads. `launched` are the OPFS files of the
 * launch pending when the page starts (the app was launched with them; the spec writes them
 * before the page loads the app); `__te066Launch` delivers one more later (a file opened while
 * the app runs: `launch_handler` `focus-existing` brings it to the open window).
 */
async function stubLaunchQueue(page: Page, launched: string[]): Promise<void> {
    await page.addInitScript((launched) => {
        const handles = async (names: string[]) => {
            const root = await navigator.storage.getDirectory();
            return Promise.all(names.map((name) => root.getFileHandle(name)));
        };
        const pending: Promise<{ files: FileSystemFileHandle[] }>[] = [];
        if (launched.length > 0) pending.push(handles(launched).then((files) => ({ files })));
        let consumer: ((params: unknown) => void) | null = null;
        const deliver = async () => {
            if (!consumer) return;
            for (const params of pending.splice(0)) consumer(await params);
        };
        Object.defineProperty(window, "launchQueue", {
            configurable: true,
            value: {
                setConsumer(next: (params: unknown) => void) {
                    consumer = next;
                    setTimeout(() => void deliver(), 0);
                },
            },
        });
        window.__te066Launch = async (names) => {
            pending.push(handles(names).then((files) => ({ files })));
            await deliver();
        };
    }, launched);
}

let served: Served;

test.beforeAll(async () => {
    test.setTimeout(180_000);
    served = await serve(await buildApp());
});

test.afterAll(async () => {
    await served?.close();
});

/** Opens the build with the launch queue stubbed and OPFS holding `files`. */
async function launchApp(page: Page, files: Record<string, number[]>, launched: string[]) {
    // OPFS is the origin's: the files are written from a page of the origin first.
    await openBuilt(page, served.url);
    await writeFiles(page, files);
    await stubLaunchQueue(page, launched);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-app-ready", "");
}

test("launch queue: the file the app is launched with opens as the project, and Save writes back to it", async ({
    page,
}) => {
    const errors = collectErrors(page);
    const launched = projectBytes("Launched", 8, 6);
    await launchApp(page, { "launched.ngtilemap": launched }, ["launched.ngtilemap"]);
    await expect(infoToast(page, "Opened launched.ngtilemap")).toBeVisible();
    await expect(projectName(page)).toHaveText("Launched");
    await expect(emptyState(page)).toHaveCount(0);

    // The project keeps the launched file's handle: Save writes to it without a picker. An
    // unchanged project is written as the same bytes (FORMAT §2: same project, same bytes).
    await page.keyboard.press("Control+KeyS");
    await expect(infoToast(page, "Saved launched.ngtilemap")).toBeVisible();
    expect(await opfsFile(page, "launched.ngtilemap")).toEqual(launched);
    expect(errors).toEqual([]);
});

test("launch queue: a later launch takes the window's project after Save / Discard / Cancel, and a launch without a project file is reported", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await launchApp(
        page,
        {
            "first.ngtilemap": projectBytes("First", 4, 4),
            "second.ngtilemap": projectBytes("Second", 5, 5),
            "tiles.png": [1, 2, 3],
        },
        ["first.ngtilemap"],
    );
    await expect(projectName(page)).toHaveText("First");

    // An unsaved change: a new tile layer (Shift+N).
    await page.keyboard.press("Shift+KeyN");
    await expect(unsavedMarker(page)).toBeVisible();

    // A file opened while the app runs comes to the same window: one project per window, so
    // the unsaved project asks first. Cancel keeps it.
    await page.evaluate(() => window.__te066Launch!(["tiles.png", "second.ngtilemap"]));
    await expect(saveDialog(page)).toBeVisible();
    await saveDialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(saveDialog(page)).toHaveCount(0);
    await expect(projectName(page)).toHaveText("First");
    await expect(unsavedMarker(page)).toBeVisible();

    // Launched again, Discard: the launch's project file becomes the window's project.
    await page.evaluate(() => window.__te066Launch!(["second.ngtilemap"]));
    await expect(saveDialog(page)).toBeVisible();
    await saveDialog(page).getByRole("button", { name: "Discard", exact: true }).click();
    await expect(infoToast(page, "Opened second.ngtilemap")).toBeVisible();
    await expect(projectName(page)).toHaveText("Second");
    await expect(unsavedMarker(page)).toHaveCount(0);
    // The first file is as it was: the discarded change was never written.
    const first = await deserialize(Uint8Array.from(await opfsFile(page, "first.ngtilemap")));
    expect(first.maps[0]!.layers).toHaveLength(1);

    // A launch of no project file changes nothing and says why, as a drop does.
    await page.evaluate(() => window.__te066Launch!(["tiles.png"]));
    await expect(
        errorToast(page).filter({ hasText: "“tiles.png” is not a tilemap project (.ngtilemap)." }),
    ).toBeVisible();
    await expect(projectName(page)).toHaveText("Second");
    expect(errors).toEqual([]);
});
