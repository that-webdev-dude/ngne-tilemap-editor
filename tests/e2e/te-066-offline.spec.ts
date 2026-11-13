import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collectErrors } from "./te-003-support";
import { emptyState, newProject, projectName } from "./te-047-support";
import {
    buildApp,
    cacheNames,
    deploymentCodeOf,
    deploymentOf,
    filesOf,
    openBuilt,
    serve,
    waitForWorkerControl,
    workerState,
} from "./te-066-support";

// TE-066 (adapted from the sprite editor's se-072-offline and se-072-update specs): the
// installable app's service worker on the production build (te-066-support).
//
// - Offline: the page loads the build once while online; once its worker controls it (every
//   file of the build is in the worker's cache), the preview server is stopped and the page's
//   context goes offline. The page reloads from the worker's cache alone and works: New Project
//   creates a project, which needs the background worker's script too.
// - Update: two builds that differ as two deployments do are served one after the other on the
//   same port. The app's own check finds the second when the page is shown again (the spec sends
//   that `visibilitychange`); the new worker waits and the update toast offers Reload; the page
//   runs the old deployment until then. Reload lets the new worker take over and reloads the
//   page from the new deployment's cache. The old deployment's cache, and an older one of this
//   app, are deleted then; the sprite editor's cache on the same origin (SUITE §7) and another
//   app's stay.

const UPDATE_TOAST = ".ui-toast:has-text('A new version of the editor is ready.')";
const OWN = "ngne-tilemap-editor-";
const SPRITE_EDITOR_CACHE = "ngne-sprite-editor-0badcafe";
const OTHER_APP_CACHE = "another-app-v1";
const OLDER_OWN_CACHE = `${OWN}00000000`;

test("offline: after one load the production build reloads and works with the network off", async ({
    page,
}) => {
    test.setTimeout(240_000);
    const served = await serve(await buildApp());
    try {
        // Uncaught errors, and console errors of the app's own origin: with the network off,
        // a script that something outside the app injects into pages (a local antivirus) fails
        // to load, and the probe below fails on purpose.
        const errors: string[] = [];
        const probe = "te-066-not-in-the-build.txt";
        page.on("pageerror", (error) => errors.push(`uncaught: ${error.message}`));
        page.on("console", (message) => {
            if (message.type() !== "error") return;
            const { url } = message.location();
            if (!url.startsWith(served.url) || url.endsWith(probe)) return;
            errors.push(`console: ${message.text()} (${url})`);
        });
        await openBuilt(page, served.url);
        await waitForWorkerControl(page);
        // The whole build is in one cache of this app.
        const own = (await cacheNames(page)).filter((name) => name.startsWith(OWN));
        expect(own).toHaveLength(1);
        expect(own[0]).toMatch(/^ngne-tilemap-editor-[0-9a-f]{8}$/);

        await served.close();
        await page.context().setOffline(true);
        // Nothing reaches a server now: a file the build does not have fails to load.
        expect(
            await page.evaluate(async (probe) => {
                try {
                    await fetch(probe);
                    return "loaded";
                } catch {
                    return "failed";
                }
            }, probe),
        ).toBe("failed");

        await page.reload();
        await expect(page.locator("html")).toHaveAttribute("data-app-ready", "");
        await expect(emptyState(page)).toBeVisible();
        await newProject(page, "offline");
        await expect(projectName(page)).toHaveText("offline");
        // Still offline, still the worker's page.
        expect(await page.evaluate(() => navigator.onLine)).toBe(false);
        expect(await workerState(page)).toEqual({ controlled: true, waiting: false });
        expect(errors).toEqual([]);
    } finally {
        await page.context().setOffline(false);
        await served.close();
    }
});

test("update: a new deployment shows the update toast, Reload activates it, and only this app's old caches go", async ({
    page,
    request,
}) => {
    test.setTimeout(240_000);
    const first = await buildApp({ deployment: "first" });
    const second = await buildApp({ deployment: "second" });
    let served = await serve(first);
    try {
        const errors = collectErrors(page);
        await openBuilt(page, served.url);
        await waitForWorkerControl(page);
        expect(await deploymentOf(page)).toBe("first");
        expect(await deploymentCodeOf(page)).toBe("first");
        const [firstCache] = (await cacheNames(page)).filter((name) => name.startsWith(OWN));
        expect(firstCache).toBeDefined();
        // The sprite editor shares the origin on GitHub Pages; another app may too; and an
        // older deployment of this app may have left its cache.
        await page.evaluate(
            async (names) => {
                for (const name of names) {
                    const cache = await caches.open(name);
                    await cache.put(`/te-066/${name}`, new Response(name));
                }
            },
            [SPRITE_EDITOR_CACHE, OTHER_APP_CACHE, OLDER_OWN_CACHE],
        );

        // The second deployment replaces the first on the server.
        const oldScripts = filesOf(first).filter(
            (file) => file.endsWith(".js") && file !== "sw.js" && !filesOf(second).includes(file),
        );
        expect(oldScripts.length).toBeGreaterThan(0);
        await served.close();
        served = await serve(second, served.port);
        // The new server has none of the old deployment's scripts.
        for (const file of oldScripts) {
            const answer = await request.get(new URL(file, served.url).href);
            expect(await answer.text(), file).not.toBe(readFileSync(join(first, file), "utf8"));
        }

        await expect(page.locator(UPDATE_TOAST)).toHaveCount(0);
        await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
        const toast = page.locator(UPDATE_TOAST);
        await expect(toast).toBeVisible();
        // Nothing changes before the user chooses: the old files still run the page, the new
        // worker waits, and every cache is still there.
        expect(await deploymentOf(page)).toBe("first");
        expect(await deploymentCodeOf(page)).toBe("first");
        await expect.poll(() => workerState(page)).toEqual({ controlled: true, waiting: true });
        expect(await cacheNames(page)).toEqual(
            expect.arrayContaining([firstCache, OLDER_OWN_CACHE, SPRITE_EDITOR_CACHE]),
        );

        await toast.getByRole("button", { name: "Reload", exact: true }).click();
        await expect.poll(() => deploymentOf(page).catch(() => null)).toBe("second");
        await expect(page.locator("html")).toHaveAttribute("data-app-ready", "");
        // The new deployment's code runs the page, not only its shell.
        expect(await deploymentCodeOf(page)).toBe("second");
        await expect.poll(() => workerState(page)).toEqual({ controlled: true, waiting: false });
        await expect(page.locator(UPDATE_TOAST)).toHaveCount(0);

        // This app's old caches are gone, one cache of its own is left (the new deployment's);
        // the sprite editor's and the other app's are kept, with what they held.
        await expect
            .poll(async () => (await cacheNames(page)).filter((name) => name.startsWith(OWN)))
            .toEqual([expect.stringMatching(/^ngne-tilemap-editor-[0-9a-f]{8}$/)]);
        const names = await cacheNames(page);
        expect(names).not.toContain(firstCache);
        expect(names).not.toContain(OLDER_OWN_CACHE);
        expect(names).toEqual(expect.arrayContaining([SPRITE_EDITOR_CACHE, OTHER_APP_CACHE]));
        expect(
            await page.evaluate(
                (name) =>
                    caches.match(`/te-066/${name}`, { cacheName: name }).then((r) => r?.text()),
                SPRITE_EDITOR_CACHE,
            ),
        ).toBe(SPRITE_EDITOR_CACHE);
        expect(errors).toEqual([]);
    } finally {
        await served.close();
    }
});
