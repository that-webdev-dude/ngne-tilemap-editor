import { createHash } from "node:crypto";
import {
    existsSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterAll, describe, expect, it } from "vitest";
import { generateRuntime } from "../../src/core/runtime/generate";
import { BROKEN_FIELD, RENAMED_FIELD, renameSpriteField } from "../runtime-compat/contract";
import { COMPAT_TABLES } from "../runtime-compat/tables";

// TE-052: the runtime compile matrix (SPEC 11.4). `npm run compat` installs each folder's engine
// and compiles its fixture game; these tests check the folders, the workflows, and compile the
// 0.3.0 game against the app's own @ngne/core 0.3.0, intact and with its contract broken.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const COMPAT = join(ROOT, "tests/runtime-compat");
const PINNED = { "0.1.0": "ngne", "0.2.2": "@ngne/core", "0.3.0": "@ngne/core" } as const;
const FOLDERS = [...Object.keys(PINNED), "latest"];

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const json = (path: string) => JSON.parse(read(path)) as Record<string, unknown>;

interface Lockfile {
    packages: Record<string, { version?: string; resolved?: string }>;
}

describe("runtime compat folders", () => {
    it("pins each engine version in its own folder, with its own lockfile", () => {
        for (const [version, name] of Object.entries(PINNED)) {
            const folder = `tests/runtime-compat/${version}`;
            const manifest = json(`${folder}/package.json`);
            const spec = version === "0.1.0" ? "file:vendor/ngne-0.1.0" : version;
            expect(manifest.dependencies, version).toEqual({ [name]: spec });
            expect(manifest.devDependencies, version).toBeUndefined();
            const lock = json(`${folder}/package-lock.json`) as unknown as Lockfile;
            expect(Object.keys(lock.packages).sort(), version).toEqual([
                "",
                `node_modules/${name}`,
            ]);
            expect(lock.packages[`node_modules/${name}`]?.version, version).toBe(version);
        }
        // Not dependencies of the app.
        const app = json("package.json");
        expect(Object.keys({ ...(app.dependencies as object) })).not.toContain("ngne");
        expect(Object.keys({ ...(app.devDependencies as object) })).not.toContain("ngne");
    });

    it("installs ngne 0.1.0 from the unpacked tarball games vendor, as recorded", () => {
        const folder = "tests/runtime-compat/0.1.0";
        const record = json(`${folder}/vendor/engine.json`);
        expect(record.filename).toBe("ngne-0.1.0.tgz");
        expect(record.revision).toMatch(/^[0-9a-f]{40}$/);
        expect(record.sha256).toMatch(/^[0-9a-f]{64}$/);
        // Every member of the tarball, byte for byte, and nothing else.
        const unpacked = join(ROOT, folder, "vendor/ngne-0.1.0");
        const files: Record<string, string> = {};
        for (const file of readdirSync(unpacked, { recursive: true, encoding: "utf8" }).sort()) {
            const path = join(unpacked, file);
            if (!statSync(path).isFile()) continue;
            const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
            files[file.split(sep).join("/")] = hash;
        }
        expect(files).toEqual(record.files);
        expect(Object.keys(files)).toHaveLength(48);
        const manifest = json(`${folder}/vendor/ngne-0.1.0/package.json`);
        expect([manifest.name, manifest.version]).toEqual(["ngne", "0.1.0"]);
        // The manifest alone differs from the tarball: without the engine's own build scripts
        // and development dependencies, which an installed package never uses.
        expect(record.trimmed).toEqual({
            "package.json": {
                sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
                removed: ["scripts", "devDependencies"],
            },
        });
        expect(manifest.scripts).toBeUndefined();
        expect(manifest.devDependencies).toBeUndefined();
        expect(manifest.exports).toEqual({
            ".": { types: "./dist/engine/index.d.ts", import: "./dist/engine/index.js" },
        });
        // Installed as a copy: a link would install the engine's own development dependencies.
        expect(read(`${folder}/.npmrc`)).toBe("install-links=true\n");
        const lock = json(`${folder}/package-lock.json`) as unknown as Lockfile;
        expect(lock.packages["node_modules/ngne"]?.resolved).toBe("file:vendor/ngne-0.1.0");
    });

    it("installs the newest @ngne/core in latest, with no lockfile", () => {
        expect(json("tests/runtime-compat/latest/package.json").dependencies).toEqual({
            "@ngne/core": "latest",
        });
        expect(existsSync(join(COMPAT, "latest/package-lock.json"))).toBe(false);
    });

    it("compiles under the settings of BRIEF 6 plus the strict flags of SPEC 11.4", () => {
        const base = ts.readConfigFile(join(COMPAT, "tsconfig.base.json"), ts.sys.readFile);
        expect(base.config.compilerOptions).toEqual({
            target: "ES2022",
            lib: ["ES2022", "DOM"],
            module: "ESNext",
            moduleResolution: "Bundler",
            types: [],
            skipLibCheck: false,
            noEmit: true,
            verbatimModuleSyntax: true,
            allowImportingTsExtensions: false,
            resolveJsonModule: false,
            strict: true,
            exactOptionalPropertyTypes: true,
            noUnusedLocals: true,
            noUnusedParameters: true,
        });
        for (const folder of FOLDERS) {
            expect(json(`tests/runtime-compat/${folder}/tsconfig.json`), folder).toEqual({
                extends: "../tsconfig.base.json",
                include: ["*.ts"],
            });
        }
    });

    it("keeps the fixture games equal but for the engine's package name", () => {
        const game = read("tests/runtime-compat/0.3.0/game.ts");
        expect(game.split("\n")[0]).toContain('from "@ngne/core";');
        expect(read("tests/runtime-compat/0.2.2/game.ts")).toBe(game);
        expect(read("tests/runtime-compat/latest/game.ts")).toBe(game);
        expect(read("tests/runtime-compat/0.1.0/game.ts")).toBe(
            game.replace('from "@ngne/core";', 'from "ngne";'),
        );
    });

    it("calls every function the generated runtime exports, and draws in scene.render", () => {
        const runtime = generateRuntime(COMPAT_TABLES);
        const game = read("tests/runtime-compat/0.3.0/game.ts");
        const functions = [...runtime.matchAll(/^export (?:async )?function (\w+)/gm)].map(
            (match) => match[1]!,
        );
        expect(functions.length).toBeGreaterThanOrEqual(15);
        for (const name of functions) expect(game, name).toMatch(new RegExp(`\\b${name}\\(`));
        expect(game).toContain('from "./ngne-tilemap";');
        expect(game).toMatch(/instanceof TilemapError/);
        expect(game).toMatch(/scene\.render\(\(frame\) => \{\s*drawTilemap\(frame,/);
    });
});

describe("the 0.3.0 fixture game against the app's @ngne/core 0.3.0", () => {
    const folder = mkdtempSync(join(tmpdir(), "te-052-"));
    afterAll(() => rmSync(folder, { recursive: true, force: true }));
    writeFileSync(join(folder, "ngne-tilemap.ts"), generateRuntime(COMPAT_TABLES));
    writeFileSync(join(folder, "game.ts"), read("tests/runtime-compat/0.3.0/game.ts"));

    const engine = join(ROOT, "node_modules/@ngne/core");
    const renderer = join(engine, "dist/engine/renderer.d.ts").replace(/\\/g, "/");

    /** The messages of compiling the game, with `edit` applied to the engine's renderer types. */
    function compile(edit: (source: string) => string = (source) => source): string[] {
        const base = ts.readConfigFile(join(COMPAT, "tsconfig.base.json"), ts.sys.readFile);
        const { options } = ts.parseJsonConfigFileContent(
            { compilerOptions: base.config.compilerOptions, files: [] },
            ts.sys,
            folder,
        );
        expect(JSON.parse(read("node_modules/@ngne/core/package.json")).version).toBe("0.3.0");
        options.paths = { "@ngne/core": [join(engine, "dist/engine/index.d.ts")] };
        const host = ts.createCompilerHost(options);
        const getSourceFile = host.getSourceFile.bind(host);
        host.getSourceFile = (name, language, ...rest) =>
            name.replace(/\\/g, "/") === renderer
                ? ts.createSourceFile(name, edit(readFileSync(renderer, "utf8")), language)
                : getSourceFile(name, language, ...rest);
        const program = ts.createProgram([join(folder, "game.ts")], options, host);
        return ts
            .getPreEmitDiagnostics(program)
            .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    }

    it("compiles", () => {
        expect(compile()).toEqual([]);
    }, 60_000);

    it("fails to compile when the engine's Sprite renames a field the runtime sets", () => {
        const messages = compile((source) => renameSpriteField(source) ?? "");
        expect(messages.length).toBeGreaterThan(0);
        expect(messages.join("\n")).toContain(`"${BROKEN_FIELD}"`);
    }, 60_000);
});

describe("renameSpriteField", () => {
    it("renames the depth field of Sprite and nothing else", () => {
        const source = read("node_modules/@ngne/core/dist/engine/renderer.d.ts");
        const renamed = renameSpriteField(source);
        expect(renamed).not.toBeNull();
        const before = source.split("\n");
        const after = renamed!.split("\n");
        const changed = before.flatMap((line, index) =>
            line === after[index] ? [] : [[line, after[index]]],
        );
        expect(changed).toEqual([
            [`    ${BROKEN_FIELD}?: number;`, `    ${RENAMED_FIELD}?: number;`],
        ]);
    });

    it("renames it when Sprite is a type alias", () => {
        expect(
            renameSpriteField("export type Sprite = {\n    x: number;\n    depth?: number;\n};\n"),
        ).toBe(`export type Sprite = {\n    x: number;\n    ${RENAMED_FIELD}?: number;\n};\n`);
    });

    it("finds nothing in a file without Sprite's depth", () => {
        expect(renameSpriteField("export interface Sprite {\n    x: number;\n}\n")).toBeNull();
        expect(renameSpriteField("export interface Other {\n    depth?: number;\n}\n")).toBeNull();
    });
});

describe("workflows", () => {
    it("compile the pinned folders in the required CI run", () => {
        const ci = read(".github/workflows/ci.yml");
        const job = /^ {4}runtime-compat:\n((?: {8}.*\n|\n)*)/m.exec(ci)?.[1] ?? "";
        expect(job).toContain("- run: npm ci\n");
        expect(job).toContain("- run: npm run compat\n");
        expect(ci).not.toContain("continue-on-error");
        expect(ci).not.toMatch(/compat -- latest/);
    });

    it("check latest weekly in a workflow of its own, report-only", () => {
        const latest = read(".github/workflows/runtime-latest.yml");
        expect(latest).toMatch(/^ {4}schedule:\n {8}- cron: "[^"]+"\n/m);
        expect(latest).toContain("workflow_dispatch:");
        expect(latest).not.toMatch(/^ {4}(push|pull_request):/m);
        expect(latest).toContain("- run: npm run compat -- latest\n");
    });
});
