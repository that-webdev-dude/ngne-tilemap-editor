import { fileURLToPath } from "node:url";
import { appInfoDefines } from "@ngne/editor-ui/about/build";
import { defineConfig } from "vitest/config";

export default defineConfig({
    // The build facts of the About dialog, as the app's build defines them (vite.config.ts):
    // a unit test that loads src/app/editorUi.ts builds the editor UI instance with them.
    define: appInfoDefines(fileURLToPath(new URL("package.json", import.meta.url))),
    test: {
        environment: "node",
        include: ["tests/unit/**/*.test.ts"],
    },
});
