import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// ENGINE §7: the rows that 0.4.0 leaves open are backed by the engine's published declarations.
// Each test reads the public surface of the pinned `@ngne/core` (its type declarations, as the
// app compiles against them) and checks that the API a gap asks for is still absent. A release
// that adds to a surface listed here fails the test, so the row is looked at again. The rows
// that need the GPU are checked in tests/e2e/engine-gaps.spec.ts.

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ENGINE = join(ROOT, "node_modules/@ngne/core");
const ENTRY = join(ENGINE, "dist/engine/index.d.ts");

const program = ts.createProgram([ENTRY], {
    target: ts.ScriptTarget.ES2022,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    types: [],
    noEmit: true,
});
const checker = program.getTypeChecker();
const entry = program.getSourceFile(ENTRY)!;
const moduleSymbol = checker.getSymbolAtLocation(entry)!;
const exports = new Map(checker.getExportsOfModule(moduleSymbol).map((s) => [s.name, s]));

/** A list of names written as one string, separated by ", ". */
function names(list: string): string[] {
    return list.split(", ");
}

/** The names of the module's exports. */
function exported(): string[] {
    return [...exports.keys()].sort();
}

/** The public, string-named members of an exported class or interface, static ones prefixed. */
function members(name: string): string[] {
    const symbol = exports.get(name);
    if (!symbol) throw new Error(`@ngne/core exports no ${name}`);
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const names: string[] = [];
    const add = (list: readonly ts.Symbol[], prefix: string) => {
        for (const member of list) {
            const text = member.escapedName as string;
            // Private and `#private` members, symbol-keyed integration hooks and type parameters
            // are not API.
            if (text.startsWith("__") || text === "prototype") continue;
            if (member.flags & ts.SymbolFlags.TypeParameter) continue;
            const declaration = member.declarations?.[0];
            const flags = declaration ? ts.getCombinedModifierFlags(declaration) : 0;
            if (flags & ts.ModifierFlags.Private) continue;
            names.push(prefix + text);
        }
    };
    // Instance members, inherited ones included, then static ones.
    add(checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(target)), "");
    const statics: ts.Symbol[] = [];
    target.exports?.forEach((member) => statics.push(member));
    add(statics, "static ");
    return names.sort();
}

describe("the pinned engine", () => {
    it("is @ngne/core 0.4.0", () => {
        const manifest = JSON.parse(readFileSync(join(ENGINE, "package.json"), "utf8"));
        expect(manifest.version).toBe("0.4.0");
    });
});

describe("ENGINE §7 rows that 0.4.0 leaves open, from its declarations", () => {
    it("Frame has no line, ellipse or polygon primitive: sprites and rects only", () => {
        expect(members("Frame")).toEqual(
            names("count, data, order, rect, reset, scene, sort, sprite, textures"),
        );
    });

    it("Sprite has no blend mode and no additive tint: colour and alpha only", () => {
        expect(members("Sprite")).toEqual(
            names(
                "alpha, clip, color, depth, height, layer, rotation, screen, texture, u, uw, v, vh, width, x, y",
            ),
        );
    });

    it("WebGPURenderer has no texture readback and does not expose its GPU device", () => {
        expect(members("WebGPURenderer")).toEqual(
            names(
                "canvas, createTexture, dispose, drawCalls, height, inspect, onLifecycle, ready, releaseTexture, render, resize, sprites, static create, status, submittedWorkDone, texture, updateTexture, width",
            ),
        );
    });

    it("BrowserGame has no in-scene upload and no resize: its logical size is fixed", () => {
        expect(members("BrowserGame")).toEqual(
            names(
                "audio, dispose, frame, game, height, input, renderer, start, stats, stop, width",
            ),
        );
    });

    it("exports no tilemap or atlas schema, no tileset discovery and no sprite animation", () => {
        for (const name of exported()) expect(name).not.toMatch(/tile|atlas|anim/i);
    });

    it("ImageAsset gains only sampling: no references to follow from one asset to another", () => {
        expect(members("ImageAsset")).toEqual(
            names("dispose, estimateBytes, id, kind, load, sampling"),
        );
    });
});
