import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { AliasOptions } from "vite";

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

// Ports apart from the sprite editor's 5173/4173, so the two apps' service workers stay apart
// when both run locally (SUITE §5). The installable app (PWA plugin, manifest, file handler) is
// TE-066's; the GitHub Pages base path is passed by the deploy build (`--base`, SUITE §7).
export default defineConfig({
    plugins: [react()],
    resolve: { alias: engineAlias() },
    server: { port: 5183, strictPort: true },
    preview: { port: 4183, strictPort: true },
    build: { target: "es2022" },
});
