import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as runtime from "../../src/core/runtime/runtime";
import * as tilemap from "../../src/core/tilemap";
import * as errors from "../../src/core/tilemap/errors";

// TE-049: one reader. It lives in `core/runtime/runtime.ts`, which becomes the generated
// runtime, so it imports nothing; `core/tilemap` re-exports it.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE = readFileSync(resolve(ROOT, "src/core/runtime/runtime.ts"), "utf8");

describe("core/runtime/runtime.ts", () => {
    it("contains no import statement", () => {
        expect(SOURCE).not.toMatch(/^\s*import[\s{*"']/m);
        expect(SOURCE).not.toMatch(/\bimport\s*\(/);
        expect(SOURCE).not.toMatch(/^\s*export\s[^;]*\sfrom\s/m);
        expect(SOURCE).not.toMatch(/\brequire\s*\(/);
    });

    it("is ASCII, as every text file of an export is", () => {
        expect([...SOURCE].filter((char) => char.charCodeAt(0) > 0x7f)).toEqual([]);
    });

    it("is the one implementation: core/tilemap re-exports its reader and error", () => {
        expect(tilemap.validateTilemap).toBe(runtime.validateTilemap);
        expect(tilemap.TilemapError).toBe(runtime.TilemapError);
        expect(errors.TilemapError).toBe(runtime.TilemapError);
        expect(tilemap.MAX_TILEMAP_LAYERS).toBe(runtime.MAX_TILEMAP_LAYERS);
    });
});
