import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { AliasOptions, Plugin, PluginOption } from "vite";
import {
    LICENCES_FILE,
    LicenceError,
    buildLicencesFile,
    buildPackageDirs,
    bundlerPackagesOf,
    licencesFileMismatch,
    moduleSource,
    packageDirsOf,
    runtimePackageDirs,
    strayPackages,
    unknownModules,
} from "./scripts/licences.ts";

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
        buildPlugins: { vite: Plugin[] };
    };
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
const TITLE = "NGNE Tilemap Editor";

/** The ids of the modules the build's chunks render, the web workers' included. */
const bundledModules = new Set<string>();

/** An output of a build, as far as `renderedModules` reads it. */
type BundleOutput =
    { type: "chunk"; modules: Record<string, { renderedLength: number }> } | { type: "asset" };

/** The ids of the modules that render code in the chunks of `bundle`. */
function renderedModules(bundle: Record<string, BundleOutput>): string[] {
    const ids: string[] = [];
    for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        for (const [id, module] of Object.entries(output.modules)) {
            if (module.renderedLength > 0) ids.push(id);
        }
    }
    return ids;
}

/** Notes the modules of every chunk of `bundle` that renders code. */
function noteModules(bundle: Record<string, BundleOutput>): void {
    for (const id of renderedModules(bundle)) bundledModules.add(id);
}

/** Notes the modules of a web worker's build; the workers are built before the app's chunks. */
function collectModules(): Plugin {
    return {
        name: "ngne-licences-collect",
        apply: "build",
        generateBundle: (_options, bundle) => noteModules(bundle),
    };
}

/**
 * `dirs` and the bundler's packages at `paths` (by default every one of `BUILD_PACKAGES`,
 * scripts/licences.ts), in order of name.
 */
function withBuildPackages(dirs: readonly string[], paths?: readonly string[]): string[] {
    return packageDirsOf(
        [...dirs, ...buildPackageDirs(ROOT, paths)].map((dir) => `${dir}/package.json`),
    );
}

/** The packages whose code the build rendered: npm packages and the bundler's, by name. */
function bundlePackageDirs(): string[] {
    return withBuildPackages(packageDirsOf(bundledModules), bundlerPackagesOf(bundledModules));
}

/**
 * The open-source licences file (scripts/licences.ts): `licences.txt` beside `index.html`,
 * with the licence of every package whose code the build bundled, each of them a runtime
 * dependency of package-lock.json, and of the bundler packages whose virtual modules it
 * rendered. The development server answers the same address with the runtime dependencies'
 * licences and every bundler package's. The build fails on a package without an allowed
 * licence and its text, on a rendered module no licence covers, and when the file it wrote
 * does not list exactly the packages it bundled.
 */
function licencesFile(): Plugin {
    const runtime = () =>
        runtimePackageDirs(readFileSync(join(ROOT, "package-lock.json"), "utf8"), ROOT);
    return {
        name: "ngne-licences",
        // A process may run several builds; the web workers' builds run within the app's.
        buildStart: () => bundledModules.clear(),
        configureServer(server) {
            server.middlewares.use((request, response, next) => {
                const path = (request.url ?? "").split("?")[0];
                if (path !== `${server.config.base}${LICENCES_FILE}`) return next();
                try {
                    const text = buildLicencesFile(ROOT, withBuildPackages(runtime()), TITLE);
                    response.setHeader("Content-Type", "text/plain; charset=utf-8");
                    response.end(text);
                } catch (error) {
                    next(error);
                }
            });
        },
        generateBundle: {
            order: "post",
            handler(_options, bundle) {
                noteModules(bundle);
                const unknown = unknownModules(bundledModules, ROOT);
                if (unknown.length > 0) {
                    this.error(
                        "The build renders code of modules that are neither the program's files " +
                            "nor a package's, which no licence covers: " +
                            `${unknown.map((id) => JSON.stringify(id)).join(", ")}. A virtual ` +
                            "module of the bundler goes into VIRTUAL_MODULES " +
                            "(scripts/licences.ts), with its package.",
                    );
                }
                const bundled = packageDirsOf(bundledModules);
                const strays = strayPackages(bundled, runtime());
                if (strays.length > 0) {
                    this.error(
                        "The build bundles code of packages that are not runtime dependencies " +
                            `in package-lock.json: ${strays.join(", ")}.`,
                    );
                }
                try {
                    this.emitFile({
                        type: "asset",
                        fileName: LICENCES_FILE,
                        source: buildLicencesFile(ROOT, bundlePackageDirs(), TITLE),
                    });
                } catch (error) {
                    if (error instanceof LicenceError) this.error(error.message);
                    throw error;
                }
            },
        },
        // The file as written lists exactly the packages whose code the build rendered.
        writeBundle(options) {
            if (!options.dir) this.error("The build writes to no directory.");
            const file = join(options.dir, LICENCES_FILE);
            try {
                const { missing, extra } = licencesFileMismatch(
                    readFileSync(file, "utf8"),
                    bundlePackageDirs(),
                );
                if (missing.length > 0 || extra.length > 0) {
                    this.error(
                        `${file} does not list the build's packages. Not listed: ` +
                            `${missing.join(", ") || "none"}. Listed, not in the build: ` +
                            `${extra.join(", ") || "none"}.`,
                    );
                }
            } catch (error) {
                if (error instanceof LicenceError) this.error(error.message);
                throw error;
            }
        },
    };
}

/**
 * Checks the service worker's build, which the PWA plugin runs on its own after the app's, once
 * the licences file is written: the worker may render the program's own files, and the
 * bundler's virtual modules when the licences file lists that bundler package. Any other
 * module, a package's code among them, fails the build: the licences file does not cover it.
 */
function serviceWorkerLicences(): Plugin {
    return {
        name: "ngne-licences-service-worker",
        apply: "build",
        generateBundle(_options, bundle) {
            const listed = new Set(bundlerPackagesOf(bundledModules));
            const uncovered = renderedModules(bundle).filter((id) => {
                const source = moduleSource(id, ROOT);
                if (source.kind === "program") return false;
                return source.kind !== "bundler" || !listed.has(source.path);
            });
            if (uncovered.length > 0) {
                this.error(
                    "The service worker renders code the licences file does not cover: " +
                        `${uncovered.map((id) => JSON.stringify(id)).join(", ")}.`,
                );
            }
        },
    };
}

// Ports apart from the sprite editor's 5173/4173, so the two apps' service workers stay apart
// when both run locally (SUITE §5). The GitHub Pages base path is passed by the deploy build
// (`--base`, SUITE §7).
export default defineConfig(({ command }) => ({
    plugins: [
        react(),
        // The open-source licences of what the build ships (licences.txt).
        licencesFile(),
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
                // The worker's own build holds the program's code only (scripts/licences.ts).
                buildPlugins: { vite: [serviceWorkerLicences()] },
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
    // The web workers' builds note their modules for the licences file.
    worker: { plugins: () => [collectModules()] },
    build: { target: "es2022" },
}));
