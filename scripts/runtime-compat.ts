import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { BROKEN_FIELD, renameSpriteField } from "../tests/runtime-compat/contract.ts";
import { COMPAT_TABLES } from "../tests/runtime-compat/tables.ts";

// TE-052: the runtime compile matrix (SPEC 11.4). For each folder of tests/runtime-compat/,
// installs its engine, writes the generated `ngne-tilemap.ts` beside its fixture game and
// compiles both with `tsc` under the settings of BRIEF 6 plus `strict`,
// `exactOptionalPropertyTypes`, `noUnusedLocals` and `noUnusedParameters`
// (tests/runtime-compat/tsconfig.base.json). Then breaks the engine contract on purpose: a copy
// of the folder's engine declarations with the `Sprite` field `depth` renamed must fail the
// compile. Exits 1 when a folder does not compile or its break is not caught.
//
//     npm run compat [-- <folder>...]
//
// Without folders it checks the pinned ones: `ngne` 0.1.0 (the tarball games vendor, from NGNE
// revision a127e59, stored unpacked; 0.1.0/vendor/engine.json lists its files' SHA-256),
// `@ngne/core` 0.2.2 and 0.3.0, each installed
// from its own lockfile (`npm ci`). `latest` installs the newest published `@ngne/core` without
// a lockfile and needs the network; the weekly workflow runs it, report-only. Vite loads the
// generator, as it reads the runtime sources through `?raw` imports.

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const FOLDERS = join(ROOT, "tests/runtime-compat");
const PINNED = ["0.1.0", "0.2.2", "0.3.0"];
const TSC = join(ROOT, "node_modules/typescript/bin/tsc");

/** Runs a command; its output is returned, and printed when it fails. */
function run(command: string, args: readonly string[], cwd: string): { ok: boolean; out: string } {
    // npm is a batch file on Windows, which Node starts through a shell only. The arguments are
    // fixed strings of this script.
    const shell = command === "npm" && process.platform === "win32";
    const result = spawnSync(command, args, { cwd, encoding: "utf8", shell });
    const out = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.message ?? ""}`;
    return { ok: result.status === 0, out };
}

/** The text of `ngne-tilemap.ts` for the fixture export folder. */
async function generated(): Promise<string> {
    const server = await createServer({
        configFile: false,
        root: ROOT,
        logLevel: "silent",
        appType: "custom",
        server: { middlewareMode: true, hmr: false, ws: false },
        optimizeDeps: { noDiscovery: true, include: [] },
    });
    try {
        const generator = await server.ssrLoadModule("/src/core/runtime/generate.ts");
        return generator.generateRuntime(COMPAT_TABLES) as string;
    } finally {
        await server.close();
    }
}

/** The folder's one engine package, by name. */
function enginePackage(folder: string): string {
    const manifest = JSON.parse(readFileSync(join(folder, "package.json"), "utf8"));
    const names = Object.keys(manifest.dependencies ?? {});
    if (names.length !== 1) throw new Error(`${folder}/package.json must list one engine.`);
    return names[0];
}

/** The directory of the installed engine's type declarations, and its entry file name. */
function engineTypes(folder: string, name: string): { dir: string; entry: string } {
    const root = join(folder, "node_modules", name);
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const types: unknown = manifest.exports?.["."]?.types ?? manifest.types;
    if (typeof types !== "string") throw new Error(`${name} declares no types entry.`);
    const entry = join(root, types);
    return { dir: dirname(entry), entry: entry.slice(dirname(entry).length + 1) };
}

/**
 * Compiles the fixture game against a copy of the engine's declarations whose `Sprite` has
 * `depth` renamed; an error is returned when that compile does not fail on the field.
 */
function contractBreak(folder: string, name: string): string | null {
    const temp = mkdtempSync(join(tmpdir(), "ngne-tilemap-compat-"));
    try {
        const types = engineTypes(folder, name);
        const copy = join(temp, "types");
        cpSync(types.dir, copy, { recursive: true, filter: (path) => !/\.js(\.map)?$/.test(path) });
        let renamed = 0;
        for (const file of readdirSync(copy, { recursive: true, encoding: "utf8" })) {
            if (!file.endsWith(".d.ts")) continue;
            const text = renameSpriteField(readFileSync(join(copy, file), "utf8"));
            if (text === null) continue;
            writeFileSync(join(copy, file), text);
            renamed += 1;
        }
        if (renamed !== 1) {
            return (
                `The break could not be applied: ${renamed} declarations of ` +
                `Sprite.${BROKEN_FIELD} found in ${name}, expected 1. The engine's Sprite ` +
                "changed shape; update tests/runtime-compat/contract.ts."
            );
        }
        const slash = (path: string) => path.replace(/\\/g, "/");
        const config = {
            extends: slash(join(folder, "tsconfig.json")),
            compilerOptions: { paths: { [name]: [slash(join(copy, types.entry))] } },
            files: [slash(join(folder, "game.ts")), slash(join(folder, "ngne-tilemap.ts"))],
        };
        writeFileSync(join(temp, "tsconfig.json"), JSON.stringify(config, null, 4));
        const result = run(process.execPath, [TSC, "-p", join(temp, "tsconfig.json")], temp);
        if (result.ok) return `It compiled against a Sprite without ${BROKEN_FIELD}.`;
        if (!result.out.includes(`"${BROKEN_FIELD}"`)) {
            return `It failed for another reason than the renamed field:\n${result.out}`;
        }
        return null;
    } finally {
        rmSync(temp, { recursive: true, force: true });
    }
}

/** Checks one folder; returns its failures. */
function check(version: string, runtime: string): string[] {
    const folder = join(FOLDERS, version);
    const name = enginePackage(folder);
    const latest = version === "latest";
    // npm keeps an installed package that a dist-tag still names, so `latest` starts empty to
    // get the newest release.
    if (latest) rmSync(join(folder, "node_modules"), { recursive: true, force: true });
    const install = latest
        ? ["install", "--no-package-lock", "--no-audit", "--no-fund", "--ignore-scripts"]
        : ["ci", "--no-audit", "--no-fund", "--ignore-scripts"];
    const installed = run("npm", install, folder);
    if (!installed.ok) return [`npm ${install[0]} failed:\n${installed.out}`];
    const manifest = JSON.parse(
        readFileSync(join(folder, "node_modules", name, "package.json"), "utf8"),
    );
    console.log(`${version}: ${name} ${manifest.version}`);

    writeFileSync(join(folder, "ngne-tilemap.ts"), runtime);
    const compiled = run(process.execPath, [TSC, "-p", join(folder, "tsconfig.json")], folder);
    if (!compiled.ok) return [`The fixture game does not compile:\n${compiled.out}`];
    console.log(`${version}: compiles`);

    const broken = contractBreak(folder, name);
    if (broken !== null) return [`Contract-break check: ${broken}`];
    console.log(`${version}: a renamed Sprite.${BROKEN_FIELD} fails the compile`);
    return [];
}

const versions = process.argv.slice(2);
const runtime = await generated();
let failed = false;
for (const version of versions.length > 0 ? versions : PINNED) {
    for (const failure of check(version, runtime)) {
        failed = true;
        console.error(`${version}: ${failure}`);
    }
}
process.exit(failed ? 1 : 0);
