import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TE-002: the sprite core subtree (DESIGN §3.1). Computes the import closure of the five entry
// files in the sprite editor's `src/core/` at the recorded commit, read through git (never the
// working tree), and writes each file byte-identical to `src/core/sprite/<path below core/>`,
// replacing whatever the directory held. Prints the file count and the PROVENANCE.md rows.
//
//     node scripts/sprite-core.ts [se-path]
//
// `se-path` defaults to `../ngne-sprite-editor` (SUITE §1). Node 24 runs the TypeScript
// directly; this file imports nothing relative for that reason.

const COMMIT = "ea5c91d";
const CORE = "src/core/";
const ENTRIES = [
    "project/deserialize.ts",
    "composite/compositeFrame.ts",
    "animation/index.ts",
    "export/pack.ts",
    "export/validateAtlas.ts",
];
/** The only bare imports the subtree may make (DESIGN §3.1). */
const PACKAGES = new Set(["fflate", "fast-png"]);

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const TARGET = `${ROOT}src/core/sprite/`;
const se = resolve(ROOT, process.argv[2] ?? "../ngne-sprite-editor");

function git(...args: string[]): Buffer {
    return execFileSync("git", args, { cwd: se, maxBuffer: 64 << 20 });
}

const known = new Set(
    git("ls-tree", "-r", "--name-only", COMMIT, "--", "src/")
        .toString("utf8")
        .split("\n")
        .filter(Boolean),
);

/** The module specifiers of every import, export-from and dynamic import of a source. */
function specifiers(source: string): string[] {
    const pattern =
        /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;
    return [...source.matchAll(pattern)].map((match) => match[1] ?? match[2]!);
}

/** The `se/` path a relative specifier names, as the bundler resolves it. */
function resolveImport(from: string, specifier: string): string {
    const base = posix.join(posix.dirname(from), specifier);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
        if (known.has(candidate)) return candidate;
    }
    throw new Error(`sprite-core: ${from} imports ${specifier}, not found at ${COMMIT}`);
}

const files = new Map<string, Buffer>();
const pending = ENTRIES.map((entry) => CORE + entry);
while (pending.length > 0) {
    const path = pending.pop()!;
    if (files.has(path)) continue;
    const bytes = git("cat-file", "blob", `${COMMIT}:${path}`);
    files.set(path, bytes);
    for (const specifier of specifiers(bytes.toString("utf8"))) {
        if (specifier.startsWith(".")) {
            const target = resolveImport(path, specifier);
            if (!target.startsWith(CORE)) {
                throw new Error(`sprite-core: ${path} imports ${target}, outside ${CORE}`);
            }
            pending.push(target);
        } else if (!PACKAGES.has(specifier)) {
            throw new Error(`sprite-core: ${path} imports ${specifier}, not fflate or fast-png`);
        }
    }
}

rmSync(TARGET, { recursive: true, force: true });
const paths = [...files.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
for (const path of paths) {
    const out = TARGET + path.slice(CORE.length);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, files.get(path)!);
}

for (const path of paths) {
    const hash = createHash("sha256").update(files.get(path)!).digest("hex");
    const local = `src/core/sprite/${path.slice(CORE.length)}`;
    console.log(`| \`${local}\` | \`${path}\` | verbatim | \`${COMMIT}\` | \`${hash}\` | |`);
}
console.log(`${paths.length} files`);
