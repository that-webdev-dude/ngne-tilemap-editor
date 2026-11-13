import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { AliasOptions, PluginOption } from "vite";

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
    injectManifest: { globPatterns: string[]; maximumFileSizeToCacheInBytes: number };
    manifest: Record<string, unknown>;
}
const PWA_PLUGIN: string = "vite-plugin-pwa";
const { VitePWA } = (await import(PWA_PLUGIN)) as {
    VitePWA(options: PwaOptions): PluginOption;
};

/** A colour of the design tokens' default (dark) set, as `#rrggbb` (DESIGN §3.2). */
function tokenColour(name: string): string {
    const css = readFileSync(new URL("src/ui/styles/tokens.css", import.meta.url), "utf8");
    const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const value = new RegExp(`${name}:\\s*(#[0-9a-f]{6})\\s*;`).exec(root)?.[1];
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
    .sort()
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
    // Relative to the manifest, which lies at Vite's `base`: the app works at a nested path
    // (`--base=/ngne-tilemap-editor/`, SUITE §7).
    id: "./",
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

// Ports apart from the sprite editor's 5173/4173, so the two apps' service workers stay apart
// when both run locally (SUITE §5). The GitHub Pages base path is passed by the deploy build
// (`--base`, SUITE §7).
export default defineConfig(({ command }) => ({
    plugins: [
        react(),
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
                // The whole build: the shell, every chunk, the web workers, the icons.
                globPatterns: ["**/*.{html,js,css,png,webmanifest}"],
                // The main chunk holds NGNE and React; a build with the development test hooks
                // (tests/e2e/te-066-support.ts) is several times larger.
                maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
            },
            manifest,
        }),
    ],
    resolve: { alias: engineAlias() },
    define: {
        // Whether this is a build with the service worker beside it (src/main.tsx).
        "import.meta.env.SERVICE_WORKER": JSON.stringify(command === "build"),
    },
    server: { port: 5183, strictPort: true },
    preview: { port: 4183, strictPort: true },
    build: { target: "es2022" },
}));
