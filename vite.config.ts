import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Ports apart from the sprite editor's 5173/4173, so the two apps' service workers stay apart
// when both run locally (SUITE §5). The installable app (PWA plugin, manifest, file handler) is
// TE-066's; the GitHub Pages base path is passed by the deploy build (`--base`, SUITE §7).
export default defineConfig({
    plugins: [react()],
    server: { port: 5183, strictPort: true },
    preview: { port: 4183, strictPort: true },
    build: { target: "es2022" },
});
