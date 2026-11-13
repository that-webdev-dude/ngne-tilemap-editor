import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { build, preview } from "vite";
import type { Plugin, PreviewServer } from "vite";

// Shared helpers of the TE-066 specs (adapted from the sprite editor's se-072-support.ts): the
// production build of the app, made by `vite build` with the project's configuration (so with
// its service worker and web manifest) into a folder of its own, served by `vite preview` on a
// free port from inside the test, as tests/perf/te-064-cold-load.perf.ts does. No spec needs
// `npm run build` first, and the dev server of the other specs is untouched. The build has no
// development test hooks: what the specs read is on screen, in the page's service worker and
// caches, or in a stub.

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export interface BuildOptions {
    /**
     * Marks the build as a deployment of its own, so two builds differ as two deployments of
     * the app do: its `index.html` carries `<meta name="te-066-deployment" content="…">`, and
     * its entry chunk starts by setting `window.__te066Deployment` to the name, so the chunk's
     * content and hashed name are the deployment's own too, and a page tells which one it
     * runs, by its shell and by its code.
     */
    deployment?: string;
}

const builds = new Map<string, Promise<string>>();
const folders: string[] = [];
process.once("exit", () => {
    for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

declare global {
    interface Window {
        /** The deployment whose entry chunk runs the page (`BuildOptions.deployment`). */
        __te066Deployment?: string;
    }
}

function deploymentMarker(name: string): Plugin {
    return {
        name: "te-066-deployment",
        renderChunk: (code, chunk) =>
            chunk.isEntry ? `window.__te066Deployment = ${JSON.stringify(name)};\n${code}` : null,
        transformIndexHtml: () => [
            {
                tag: "meta",
                attrs: { name: "te-066-deployment", content: name },
                injectTo: "head",
            },
        ],
    };
}

/** Builds the app for production (once per worker for the same options); returns its folder. */
export function buildApp(options: BuildOptions = {}): Promise<string> {
    const key = JSON.stringify([options.deployment]);
    let built = builds.get(key);
    if (!built) {
        // One build after the other: a build sets NODE_ENV for its run.
        const previous = [...builds.values()].at(-1) ?? Promise.resolve("");
        built = previous.catch(() => "").then(() => runBuild(options));
        builds.set(key, built);
    }
    return built;
}

async function runBuild({ deployment }: BuildOptions): Promise<string> {
    const outDir = mkdtempSync(join(tmpdir(), "te-066-build-"));
    folders.push(outDir);
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
        await build({
            root: ROOT,
            mode: "production",
            logLevel: "error",
            plugins: deployment ? [deploymentMarker(deployment)] : [],
            build: { outDir, emptyOutDir: true },
        });
    } finally {
        if (nodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = nodeEnv;
    }
    return outDir;
}

export interface Served {
    /** The app's address: the origin and the base. */
    url: string;
    port: number;
    close(): Promise<void>;
}

/** Serves the build in `outDir` with `vite preview`, on `port` or a free one. */
export async function serve(outDir: string, port = 0): Promise<Served> {
    const server: PreviewServer = await preview({
        root: ROOT,
        logLevel: "warn",
        build: { outDir },
        preview: { host: "127.0.0.1", port, strictPort: port !== 0, open: false },
    });
    const address = server.httpServer.address();
    if (typeof address !== "object" || !address) throw new Error("te-066: no preview address");
    let closed = false;
    return {
        url: `http://127.0.0.1:${address.port}/`,
        port: address.port,
        close: async () => {
            if (closed) return;
            closed = true;
            await server.close();
        },
    };
}

/** Opens the build at `url` and waits until the app has started (`<html data-app-ready>`). */
export async function openBuilt(page: Page, url: string): Promise<void> {
    await page.goto(url);
    await expect(page.locator("html")).toHaveAttribute("data-app-ready", "");
}

/** Waits until a service worker controls the page: the app's files are all in its cache. */
export async function waitForWorkerControl(page: Page): Promise<void> {
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

/** The deployment marker of the page's `index.html` (`BuildOptions.deployment`). */
export function deploymentOf(page: Page): Promise<string | null> {
    return page.evaluate(
        () =>
            document.querySelector('meta[name="te-066-deployment"]')?.getAttribute("content") ??
            null,
    );
}

/** The deployment whose entry chunk runs the page (`BuildOptions.deployment`). */
export function deploymentCodeOf(page: Page): Promise<string | null> {
    return page.evaluate(() => window.__te066Deployment ?? null);
}

/** Every file in `outDir` and its folders, by its path relative to `outDir` with "/". */
export function filesOf(outDir: string): string[] {
    return readdirSync(outDir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => relative(outDir, join(entry.parentPath, entry.name)).split(sep).join("/"))
        .sort();
}

/** The names of the origin's caches, as the page sees them, sorted. */
export function cacheNames(page: Page): Promise<string[]> {
    return page.evaluate(async () => (await caches.keys()).sort());
}

/** Whether a service worker controls the page and whether a new one waits. */
export function workerState(page: Page): Promise<{ controlled: boolean; waiting: boolean }> {
    return page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return {
            controlled: navigator.serviceWorker.controller !== null,
            waiting: (registration?.waiting ?? null) !== null,
        };
    });
}
