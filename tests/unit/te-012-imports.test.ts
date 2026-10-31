import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// TE-012: the compositor is a test reference for the emitter, so it must not reach
// `core/runtime/emit.ts`, directly or through another module.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const COMPOSITOR = join(ROOT, "src/core/compositor");
const EMIT = join(ROOT, "src/core/runtime/emit.ts");

const IMPORT = /(?:import|export)\s[^"';]*?from\s*["']([^"']+)["']|import\s*["']([^"']+)["']/g;

function resolveImport(from: string, specifier: string): string | undefined {
    if (!specifier.startsWith(".")) return undefined;
    const base = resolve(dirname(from), specifier);
    return [`${base}.ts`, join(base, "index.ts"), base].find(
        (path) => existsSync(path) && path.endsWith(".ts"),
    );
}

/** Every file reachable from `entries` through relative imports. */
function reachable(entries: string[]): Set<string> {
    const seen = new Set<string>();
    const queue = [...entries];
    while (queue.length > 0) {
        const file = queue.pop()!;
        if (seen.has(file)) continue;
        seen.add(file);
        const source = readFileSync(file, "utf8");
        for (const match of source.matchAll(IMPORT)) {
            const target = resolveImport(file, match[1] ?? match[2]!);
            if (target !== undefined) queue.push(target);
        }
    }
    return seen;
}

describe("core/compositor imports", () => {
    const files = readdirSync(COMPOSITOR)
        .filter((name) => name.endsWith(".ts"))
        .map((name) => join(COMPOSITOR, name));

    it("has source files to check", () => {
        expect(files.length).toBeGreaterThan(1);
    });

    it("does not import core/runtime/emit.ts, directly or transitively", () => {
        const reached = [...reachable(files)].map((file) =>
            relative(ROOT, file).replaceAll("\\", "/"),
        );
        expect(reached).not.toContain("src/core/runtime/emit.ts");
        expect(reached.some((file) => file.startsWith("src/core/runtime/"))).toBe(false);
        expect(existsSync(EMIT)).toBe(true);
    });

    it("the walk finds the imports it is meant to follow", () => {
        const reached = [...reachable(files)].map((file) =>
            relative(ROOT, file).replaceAll("\\", "/"),
        );
        expect(reached).toContain("src/core/model/layers.ts");
        expect(reached).toContain("src/core/sprite/composite/blend.ts");
    });
});
