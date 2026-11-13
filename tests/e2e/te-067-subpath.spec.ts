import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { emptyState, newProject, projectName } from "./te-047-support";
import { openBuilt, waitForWorkerControl } from "./te-066-support";

// TE-067: the release build at the GitHub Pages base path (SUITE §7). The deploy workflow's
// build, `vite build --base=/ngne-tilemap-editor/`, run as `npm run build` runs it (the Vite
// command line), into a folder of its own; then served by `vite preview --base` on a free port.
// The app starts at the sub-path, creates a project (which loads the background worker's script),
// its manifest and service worker take the sub-path as their scope, and every request of the page
// stays inside the sub-path and succeeds.

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const VITE = join(ROOT, "node_modules/vite/bin/vite.js");
const BASE = "/ngne-tilemap-editor/";

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            server.close(() =>
                typeof address === "object" && address
                    ? resolve(address.port)
                    : reject(new Error("no port")),
            );
        });
    });
}

/** Serves `outDir` with `vite preview --base`; resolves once the server answers. */
async function preview(outDir: string, port: number): Promise<ChildProcess> {
    const server = spawn(
        process.execPath,
        [
            VITE,
            "preview",
            `--base=${BASE}`,
            "--outDir",
            outDir,
            "--host",
            "127.0.0.1",
            "--port",
            String(port),
            "--strictPort",
        ],
        { cwd: ROOT, stdio: "ignore" },
    );
    const url = `http://127.0.0.1:${port}${BASE}`;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        if (server.exitCode !== null) throw new Error(`vite preview exited (${server.exitCode})`);
        try {
            if ((await fetch(url)).ok) return server;
        } catch {
            // Not listening yet.
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    server.kill();
    throw new Error(`vite preview did not answer at ${url}`);
}

test("the release build serves the app from /ngne-tilemap-editor/", async ({ page }) => {
    test.setTimeout(240_000);
    const outDir = mkdtempSync(join(tmpdir(), "te-067-build-"));
    let server: ChildProcess | null = null;
    try {
        const built = spawnSync(
            process.execPath,
            [VITE, "build", `--base=${BASE}`, "--outDir", outDir, "--emptyOutDir"],
            { cwd: ROOT, encoding: "utf8" },
        );
        expect(built.status, `${built.stdout}${built.stderr}`).toBe(0);
        const port = await freePort();
        server = await preview(outDir, port);
        const origin = `http://127.0.0.1:${port}`;

        const outside: string[] = [];
        const failed: string[] = [];
        page.on("request", (request) => {
            const url = new URL(request.url());
            if (url.origin === origin && !url.pathname.startsWith(BASE)) outside.push(url.href);
        });
        page.on("requestfailed", (request) => failed.push(`${request.url()} failed`));
        page.on("response", (response) => {
            if (response.status() >= 400) failed.push(`${response.url()} ${response.status()}`);
        });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));

        await openBuilt(page, `${origin}${BASE}`);
        await expect(emptyState(page)).toBeVisible();
        await newProject(page, "sub-path");
        await expect(projectName(page)).toHaveText("sub-path");

        // The manifest lies at the base, and its scope and start URL resolve to it.
        const manifestHref = await page.evaluate(
            () => (document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null)?.href,
        );
        expect(manifestHref).toBeDefined();
        expect(new URL(manifestHref!).pathname.startsWith(BASE)).toBe(true);
        const manifest = (await (await page.request.get(manifestHref!)).json()) as {
            scope: string;
            start_url: string;
        };
        expect(new URL(manifest.scope, manifestHref).href).toBe(`${origin}${BASE}`);
        expect(new URL(manifest.start_url, manifestHref).href).toBe(`${origin}${BASE}`);

        // The service worker is registered for the base and takes the page.
        await waitForWorkerControl(page);
        const scope = await page.evaluate(
            async () => (await navigator.serviceWorker.getRegistration())?.scope,
        );
        expect(scope).toBe(`${origin}${BASE}`);

        expect(outside).toEqual([]);
        expect(failed).toEqual([]);
        expect(errors).toEqual([]);
    } finally {
        server?.kill();
        rmSync(outDir, { recursive: true, force: true });
    }
});
