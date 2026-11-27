import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { AliasOptions, PluginOption } from "vite";
import { appInfoDefines } from "@ngne/editor-ui/about/build";
import { generateLicences } from "@ngne/editor-ui/licences/build";
import type { LicencesServiceWorkerPlugin } from "@ngne/editor-ui/licences/build";

/**
 * `@ngne/core` from another install, when `NGNE_CORE_DIR` names one: the weekly runtime-latest
 * workflow draws the TE-055 conformance game against the newest published engine (SPEC §11.4).
 */
function engineAlias(): AliasOptions | undefined {
    const directory = process.env.NGNE_CORE_DIR;
    if (!directory) return undefined;
    const manifest = JSON.parse(readFileSync(resolve(directory, "package.json"), "utf8"));
    const entry: unknown = manifest.exports?.["."]?.import ?? manifest.module ?? manifest.main;
    if (typeof entry !== "string") throw new Error(`${directory} names no ES module entry.`);
    return [{ find: /^@ngne\/core$/, replacement: resolve(directory, entry) }];
}

// TE-066: the PWA build plugin (vite-plugin-pwa, a development dependency). Its declarations
// do not compile under this project's `skipLibCheck: false`: they import the types of an
// optional peer that is not installed (@vite-pwa/assets-generator) and Workbox's, which need
// the WebWorker library. So the plugin is loaded without its declarations, by a specifier the
// compiler does not follow, and the options passed are typed here.
interface PwaOptions {
    strategies: "injectManifest";
    srcDir: string;
    filename: string;
    injectRegister: false;
    includeManifestIcons: boolean;
    injectManifest: {
        globPatterns: string[];
        maximumFileSizeToCacheInBytes: number;
        buildPlugins: { vite: LicencesServiceWorkerPlugin[] };
    };
    manifest: Record<string, unknown>;
}
const PWA_PLUGIN: string = "vite-plugin-pwa";
const { VitePWA } = (await import(PWA_PLUGIN)) as {
    VitePWA(options: PwaOptions): PluginOption;
};

/**
 * A colour of the design tokens' default (dark) set, as `#rrggbb` (DESIGN §3.2): the first
 * `:root` block of the package stylesheet, its `tokens.css`.
 */
function tokenColour(name: string): string {
    const css = readFileSync(
        new URL("node_modules/@ngne/editor-ui/dist/styles.css", import.meta.url),
        "utf8",
    );
    const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const value = new RegExp(String.raw`${name}:\s*(#[0-9a-f]{6})\s*;`).exec(root)?.[1];
    if (!value) throw new Error(`vite.config: no colour token ${name}`);
    return value;
}

const colours = {
    /** The installed window's title bar: the menu bar's panel colour. */
    theme: tokenColour("--bg-panel"),
    /** Behind the icon while the installed app starts: the workspace colour. */
    background: tokenColour("--bg-workspace"),
};

/** The icons scripts/icons.ts draws: public/icons/{icon,maskable}-<size>.png. */
const icons = readdirSync(new URL("public/icons/", import.meta.url))
    // By code unit, as the default sort: the order does not depend on the machine's locale.
    .sort((a, b) => Number(a > b) - Number(a < b))
    .flatMap((file) => {
        const match = /^(icon|maskable)-(\d+)\.png$/.exec(file);
        if (!match) return [];
        const [, kind, size] = match;
        return [
            {
                src: `icons/${file}`,
                sizes: `${size}x${size}`,
                type: "image/png",
                purpose: kind === "icon" ? "any" : "maskable",
            },
        ];
    });

/** The web manifest (SUITE §1, §7). */
export const manifest = {
    // The app's identity. Browsers resolve `id` against the origin, not against the manifest's
    // path, so a relative "./" names the origin's root, which the sprite editor on the same
    // GitHub Pages origin would share: the browser then takes both for one app and offers to
    // install only the first. This id names this app alone, whatever the `base`.
    id: "/ngne-tilemap-editor/",
    // Relative to the manifest, which lies at Vite's `base`: the app works at a nested path
    // (`--base=/ngne-tilemap-editor/`, SUITE §7).
    start_url: "./",
    scope: "./",
    name: "NGNE Tilemap Editor",
    short_name: "NGNE Tilemaps",
    description: "Tile map editor rendered by the NGNE engine",
    lang: "en",
    display: "standalone",
    theme_color: colours.theme,
    background_color: colours.background,
    icons,
    // The installed app opens `.ngtilemap` files (src/app/pwa/launchQueue.ts). An open window
    // takes the file as its project instead of a second window opening.
    file_handlers: [
        {
            action: "./",
            accept: { "application/x-ngtilemap": [".ngtilemap"] },
        },
    ],
    launch_handler: { client_mode: ["focus-existing", "auto"] },
};

/**
 * The files of the build the service worker precaches, relative to the build's folder: the
 * shell, every chunk, the web workers, the icons and the licences file, which View → Open
 * Source Licences… shows offline too.
 */
export const precachePatterns: readonly string[] = ["**/*.{html,js,css,png,webmanifest,txt}"];

const ROOT = fileURLToPath(new URL(".", import.meta.url));

/**
 * The open-source licences file (@ngne/editor-ui SPEC §11): `licences.txt` beside `index.html`,
 * with the licence of every package whose code the build bundled, each of them a runtime
 * dependency of package-lock.json, and of the build tools whose own code a build can hold:
 * rolldown, whose virtual modules the bundler writes into every build, and vite, whose preload
 * helper a build with a dynamic import holds (the development gallery route,
 * src/ui/galleryRoute.tsx). The development server answers the same address. The build fails on
 * a package without an allowed licence and its text, and the service worker's build on code of
 * a package the file does not list.
 */
const licences = generateLicences({
    root: ROOT,
    title: "NGNE Tilemap Editor",
    buildPackages: ["node_modules/rolldown", "node_modules/vite"],
});

// Ports apart from the sprite editor's 5173/4173, so the two apps' service workers stay apart
// when both run locally (SUITE §5). The GitHub Pages base path is passed by the deploy build
// (`--base`, SUITE §7).
export default defineConfig(({ command }) => ({
    plugins: [
        react(),
        // The open-source licences of what the build ships (licences.txt).
        licences.plugin,
        // The colour of the browser's chrome around the page, as the installed window's.
        {
            name: "ngne-theme-color",
            apply: "build",
            transformIndexHtml: () => [
                {
                    tag: "meta",
                    attrs: { name: "theme-color", content: colours.theme },
                    injectTo: "head",
                },
            ],
        },
        // TE-066: installable app and offline use. Only `vite build` emits the service worker
        // and the web manifest (the plugin's `devOptions` stay off): the dev server, which the
        // E2E suite runs on, registers no worker and links no manifest.
        VitePWA({
            strategies: "injectManifest",
            srcDir: "src/app/pwa",
            filename: "sw.ts",
            // The app registers the worker itself (src/app/pwa/updates.ts).
            injectRegister: false,
            // The icons are among the files the patterns find.
            includeManifestIcons: false,
            injectManifest: {
                globPatterns: [...precachePatterns],
                // The main chunk holds NGNE and React; a build with the development test hooks
                // (tests/e2e/te-066-support.ts) is several times larger.
                maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
                // The worker's own build, after the app's: only what licences.txt lists.
                buildPlugins: { vite: [licences.serviceWorkerPlugin] },
            },
            manifest,
        }),
    ],
    resolve: { alias: engineAlias() },
    define: {
        // The build facts of the About dialog (src/app/editorUi.ts).
        ...appInfoDefines(fileURLToPath(new URL("package.json", import.meta.url))),
        // Whether this is a build with the service worker beside it (src/main.tsx).
        "import.meta.env.SERVICE_WORKER": JSON.stringify(command === "build"),
    },
    server: { port: 5183, strictPort: true },
    preview: { port: 4183, strictPort: true },
    // The web workers' builds note their modules for the licences file.
    worker: { plugins: () => [licences.workerPlugin] },
    build: { target: "es2022" },
}));
