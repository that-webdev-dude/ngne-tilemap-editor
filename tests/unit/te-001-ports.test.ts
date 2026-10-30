import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "vite";
import { describe, expect, it } from "vitest";

// SUITE §5: the dev server on 5183 and the preview server on 4183, apart from the sprite
// editor's 5173/4173. `strictPort` makes a taken port an error instead of a silent move.
const configFile = fileURLToPath(new URL("../../vite.config.ts", import.meta.url));
const { scripts } = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { scripts: Record<string, string> };

describe("vite.config.ts", () => {
    it("is what `npm run dev` and `npm run preview` use, without a port of their own", () => {
        expect(scripts.dev).toBe("vite");
        expect(scripts.preview).toBe("vite preview");
    });

    it("serves `npm run dev` on 5183", async () => {
        const config = await resolveConfig({ configFile }, "serve", "development");
        expect(config.server.port).toBe(5183);
        expect(config.server.strictPort).toBe(true);
    });

    it("serves `npm run preview` on 4183", async () => {
        const config = await resolveConfig({ configFile }, "serve", "production");
        expect(config.preview.port).toBe(4183);
        expect(config.preview.strictPort).toBe(true);
    });
});
