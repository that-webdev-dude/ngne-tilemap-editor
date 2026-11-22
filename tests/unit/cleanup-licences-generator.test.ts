import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
    ALLOWED_LICENCES,
    BUILD_PACKAGES,
    LICENCES_FILE,
    LICENCE_PHRASES,
    LicenceError,
    VIRTUAL_MODULES,
    buildLicencesFile,
    buildPackageDirs,
    bundlerPackagesOf,
    fallbackFileOf,
    licenceAllowed,
    licenceTextMatches,
    licencesFileMismatch,
    licencesText,
    listedPackages,
    moduleSource,
    packageDirOf,
    packageDirsOf,
    readPackageLicence,
    runtimePackageDirs,
    strayPackages,
    unknownModules,
} from "@ngne/editor-ui/licences/build";
import { LICENCES_PATH } from "@ngne/editor-ui/licences";

// The open-source licences file of the build (scripts/licences.ts): which packages it lists,
// which licences it accepts, and what it holds. The packages of the fixtures are written to
// a temporary directory; the last tests read the repository's own runtime dependencies.

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIT =
    "MIT License\n\nCopyright (c) 2026 Somebody\n\nPermission is hereby granted, free of charge, " +
    "to any person obtaining a copy…\n";
const ISC =
    "ISC License\n\nCopyright (c) 2026 Somebody\n\nPermission to use, copy, modify, and/or " +
    "distribute this software for any purpose with or without fee is hereby granted, provided " +
    "that the above copyright notice and this permission notice appear in all copies.\n";

/** A licence's text as its phrases (`LICENCE_PHRASES`), wrapped, commented and with CRLF. */
function textOf(id: string): string {
    const phrases = LICENCE_PHRASES[id] ?? [];
    return ` * ${phrases.join(" …\r\n * ").replaceAll(", ", ",\r\n *   ")}\r\n`;
}

const temp = mkdtempSync(join(tmpdir(), "licences-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

/** Writes a package under `<temp>/<project>/node_modules/<name>` with the given files. */
function writePackage(
    project: string,
    name: string,
    manifest: Record<string, unknown>,
    files: Record<string, string> = {},
): string {
    const dir = join(temp, project, "node_modules", ...name.split("/"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name, version: "1.0.0", ...manifest }),
    );
    for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
    return dir;
}

describe("packageDirOf", () => {
    it("is the package directory of a bundled module, scoped or nested", () => {
        expect(packageDirOf("/app/node_modules/react/cjs/react.production.js")).toBe(
            "/app/node_modules/react",
        );
        expect(packageDirOf("C:\\app\\node_modules\\@radix-ui\\react-menu\\dist\\index.mjs")).toBe(
            "C:/app/node_modules/@radix-ui/react-menu",
        );
        // A nested copy is that copy.
        expect(packageDirOf("/app/node_modules/a/node_modules/b/index.js?commonjs-es")).toBe(
            "/app/node_modules/a/node_modules/b",
        );
        expect(packageDirOf("\0/app/node_modules/gifenc/dist/gifenc.esm.js")).toBe(
            "/app/node_modules/gifenc",
        );
    });

    it("is null for the program's own modules and virtual ones", () => {
        expect(packageDirOf("/app/src/main.tsx")).toBeNull();
        expect(packageDirOf("\0vite/preload-helper.js")).toBeNull();
        expect(packageDirOf("/app/node_modules/")).toBeNull();
        expect(packageDirOf("/app/node_modules/@scope/")).toBeNull();
    });

    it("lists each package once, in order of name", () => {
        expect(
            packageDirsOf([
                "/app/node_modules/zustand/esm/vanilla.mjs",
                "/app/src/main.tsx",
                "/app/node_modules/@floating-ui/dom/dist/a.mjs",
                "/app/node_modules/zustand/esm/react.mjs",
                "/app/node_modules/react/index.js",
            ]),
        ).toEqual([
            "/app/node_modules/@floating-ui/dom",
            "/app/node_modules/react",
            "/app/node_modules/zustand",
        ]);
    });
});

describe("licenceAllowed", () => {
    it("allows the permissive licences of the allowlist and nothing else", () => {
        expect(ALLOWED_LICENCES).toEqual([
            "MIT",
            "ISC",
            "0BSD",
            "BSD-2-Clause",
            "BSD-3-Clause",
            "Apache-2.0",
        ]);
        for (const licence of ALLOWED_LICENCES) expect(licenceAllowed(licence), licence).toBe(true);
        for (const licence of ["GPL-3.0", "LGPL-2.1", "MPL-2.0", "CC-BY-4.0", "UNLICENSED", ""]) {
            expect(licenceAllowed(licence), licence).toBe(false);
        }
    });

    it("reads OR as a choice and AND as both", () => {
        expect(licenceAllowed("(MIT OR GPL-3.0)")).toBe(true);
        expect(licenceAllowed("GPL-3.0 OR MPL-2.0")).toBe(false);
        expect(licenceAllowed("MIT AND ISC")).toBe(true);
        expect(licenceAllowed("MIT AND GPL-3.0")).toBe(false);
    });
});

describe("readPackageLicence", () => {
    const fallbacks = join(temp, "fallbacks");
    mkdirSync(fallbacks, { recursive: true });

    it("reads the licence and every licence, NOTICE and third-party licence file at the package's top", () => {
        const dir = writePackage(
            "read",
            "@scope/thing",
            { license: "MIT" },
            {
                "LICENSE.txt": `${MIT}\r\n`,
                NOTICE: "Notice text  \n",
                "THIRD-PARTY-LICENSE": "Bundled code\n",
                "README.md": "no",
            },
        );
        expect(readPackageLicence(dir, fallbacks)).toEqual({
            name: "@scope/thing",
            version: "1.0.0",
            licence: "MIT",
            texts: [
                { file: "LICENSE.txt", text: MIT },
                { file: "NOTICE", text: "Notice text\n" },
                { file: "THIRD-PARTY-LICENSE", text: "Bundled code\n" },
            ],
        });
    });

    it("reads the older `licenses` list and a `license` object", () => {
        const list = writePackage(
            "read",
            "old-list",
            { licenses: [{ type: "MIT" }, { type: "GPL-2.0" }] },
            { LICENCE: MIT },
        );
        expect(readPackageLicence(list, fallbacks).licence).toBe("MIT OR GPL-2.0");
        const object = writePackage(
            "read",
            "old-object",
            { license: { type: "ISC" } },
            {
                COPYING: ISC,
            },
        );
        expect(readPackageLicence(object, fallbacks).licence).toBe("ISC");
    });

    it("refuses a package with a licence outside the allowlist", () => {
        const dir = writePackage("read", "copyleft", { license: "GPL-3.0" }, { LICENSE: "GPL" });
        expect(() => readPackageLicence(dir, fallbacks)).toThrow(LicenceError);
        expect(() => readPackageLicence(dir, fallbacks)).toThrow(/copyleft@1\.0\.0 .*GPL-3\.0/);
    });

    it("refuses a package that states no licence", () => {
        const dir = writePackage("read", "silent", {}, { LICENSE: MIT });
        expect(() => readPackageLicence(dir, fallbacks)).toThrow(/states no licence/);
    });

    it("refuses a package without a licence file, unless scripts/licence-texts has one", () => {
        const dir = writePackage("read", "@scope/bare", { license: "MIT" });
        expect(() => readPackageLicence(dir, fallbacks)).toThrow(
            /@scope\/bare@1\.0\.0 \(MIT\) has no licence file.*@scope__bare\.txt/,
        );
        expect(fallbackFileOf("@scope/bare")).toBe("@scope__bare.txt");
        writeFileSync(join(fallbacks, "@scope__bare.txt"), MIT);
        expect(readPackageLicence(dir, fallbacks).texts).toEqual([
            { file: "scripts/licence-texts/@scope__bare.txt", text: MIT },
        ]);
    });

    it("refuses a package whose licence files hold another licence's text", () => {
        const dir = writePackage("read", "mislabelled", { license: "MIT" }, { LICENSE: ISC });
        expect(() => readPackageLicence(dir, fallbacks)).toThrow(LicenceError);
        expect(() => readPackageLicence(dir, fallbacks)).toThrow(
            /mislabelled@1\.0\.0 declares MIT, but none of its licence files \(LICENSE\) holds/,
        );
        // A NOTICE beside it is no licence text either.
        const notice = writePackage(
            "read",
            "notice-only",
            { license: "Apache-2.0" },
            { NOTICE: "Notice text\n" },
        );
        expect(() => readPackageLicence(notice, fallbacks)).toThrow(/declares Apache-2\.0/);
    });

    it("refuses a fallback text of scripts/licence-texts that is another licence's", () => {
        const dir = writePackage("read", "@scope/stand-in", { license: "ISC" });
        writeFileSync(join(fallbacks, "@scope__stand-in.txt"), MIT);
        expect(() => readPackageLicence(dir, fallbacks)).toThrow(
            /declares ISC, but none of its licence files \(scripts\/licence-texts\/@scope__stand-in\.txt\)/,
        );
    });
});

describe("licenceTextMatches", () => {
    it("knows phrases of every licence of the allowlist and of none other", () => {
        expect(Object.keys(LICENCE_PHRASES).sort()).toEqual([...ALLOWED_LICENCES].sort());
        for (const licence of ALLOWED_LICENCES) {
            expect(LICENCE_PHRASES[licence]!.length, licence).toBeGreaterThan(0);
        }
    });

    it("finds each licence's phrases across line breaks, comment marks and case", () => {
        for (const licence of ALLOWED_LICENCES) {
            expect(licenceTextMatches(licence, [textOf(licence)]), licence).toBe(true);
            expect(licenceTextMatches(licence, [textOf(licence).toUpperCase()]), licence).toBe(
                true,
            );
        }
        expect(licenceTextMatches("MIT", [MIT])).toBe(true);
        expect(licenceTextMatches("ISC", [ISC])).toBe(true);
    });

    it("refuses a text of another licence, or a part of one", () => {
        expect(licenceTextMatches("MIT", [ISC])).toBe(false);
        expect(licenceTextMatches("ISC", [MIT])).toBe(false);
        expect(licenceTextMatches("Apache-2.0", [MIT, "Notice text\n"])).toBe(false);
        // BSD-3-Clause adds the endorsement clause to BSD-2-Clause's.
        expect(licenceTextMatches("BSD-3-Clause", [textOf("BSD-2-Clause")])).toBe(false);
        // One phrase of two is not the licence.
        expect(licenceTextMatches("ISC", [LICENCE_PHRASES.ISC![0]!])).toBe(false);
        expect(licenceTextMatches("MIT", [])).toBe(false);
        expect(licenceTextMatches("", [MIT])).toBe(false);
    });

    it("needs the text of one allowed alternative of an OR and of every part of an AND", () => {
        expect(licenceTextMatches("(MIT OR Apache-2.0)", [textOf("Apache-2.0")])).toBe(true);
        expect(licenceTextMatches("MIT OR Apache-2.0", [ISC])).toBe(false);
        // The alternative whose text is there is not allowed.
        expect(licenceTextMatches("MIT OR ISC", [ISC], ["MIT"])).toBe(false);
        expect(licenceTextMatches("GPL-3.0 OR MIT", ["GNU GENERAL PUBLIC LICENSE"])).toBe(false);
        expect(licenceTextMatches("MIT AND ISC", [MIT, ISC])).toBe(true);
        expect(licenceTextMatches("MIT AND ISC", [MIT])).toBe(false);
    });
});

describe("moduleSource", () => {
    const root = "/app";

    it("places the program's files, the packages' and the bundler's virtual modules", () => {
        expect(moduleSource("/app/src/main.tsx", root)).toEqual({ kind: "program" });
        expect(moduleSource("\0/app/src/worker.ts?worker_file&type=module", root)).toEqual({
            kind: "program",
        });
        expect(moduleSource("/app/node_modules/react/index.js", root)).toEqual({
            kind: "package",
            dir: "/app/node_modules/react",
        });
        expect(moduleSource("\0rolldown/runtime.js", root)).toEqual({
            kind: "bundler",
            path: "node_modules/rolldown",
        });
        expect(moduleSource("\0vite/modulepreload-polyfill.js", root)).toEqual({
            kind: "bundler",
            path: "node_modules/rolldown",
        });
    });

    it("knows no other virtual module, and no file outside the project", () => {
        for (const id of [
            "\0virtual:probe",
            "virtual:pwa-register",
            "\0vite/preload-helper.js",
            "\0commonjsHelpers.js",
            "/elsewhere/code.js",
            "/app",
        ]) {
            expect(moduleSource(id, root), id).toEqual({ kind: "unknown" });
        }
        expect(
            unknownModules(["/app/src/a.ts", "\0virtual:probe", "\0rolldown/runtime.js"], root),
        ).toEqual(["\0virtual:probe"]);
    });

    it("maps each bundler virtual module to a package of BUILD_PACKAGES", () => {
        for (const [id, path] of Object.entries(VIRTUAL_MODULES)) {
            expect(BUILD_PACKAGES, id).toContain(path);
        }
        expect(bundlerPackagesOf(["/app/src/a.ts", "\0vite/modulepreload-polyfill.js"])).toEqual([
            "node_modules/rolldown",
        ]);
        expect(bundlerPackagesOf(["/app/src/a.ts", "/app/node_modules/react/index.js"])).toEqual(
            [],
        );
    });
});

describe("listedPackages and licencesFileMismatch", () => {
    const packages = [
        {
            name: "@alpha/one",
            version: "1.0.0",
            licence: "MIT",
            texts: [{ file: "LICENSE", text: "A\n" }],
        },
        {
            name: "zeta",
            version: "2.0.0",
            licence: "(MIT OR Apache-2.0)",
            texts: [{ file: "LICENSE", text: "Z\n" }],
        },
    ];
    const file = licencesText({
        title: "Example",
        licence: "L\n",
        notices: "# Notices\n\nnpm packages in this build (9)\n",
        packages,
    });

    it("reads the packages a licences file lists", () => {
        expect(listedPackages(file)).toEqual(["@alpha/one 1.0.0", "zeta 2.0.0"]);
        const none = licencesText({ title: "E", licence: "L\n", notices: "N\n", packages: [] });
        expect(listedPackages(none)).toEqual([]);
    });

    it("refuses a file without a package list or with a wrong count", () => {
        expect(() => listedPackages("Example\n")).toThrow(/no list of npm packages/);
        expect(() =>
            listedPackages(
                file.replace("npm packages in this build (2)", "npm packages in this build (3)"),
            ),
        ).toThrow(/counts 3 npm packages but lists 2/);
    });

    it("names the build's packages the file does not list, and the ones it lists that are not the build's", () => {
        const one = writePackage("mismatch", "@alpha/one", { license: "MIT" });
        const other = writePackage("mismatch", "other", { license: "MIT" });
        expect(licencesFileMismatch(file, [one, other])).toEqual({
            missing: ["other 1.0.0"],
            extra: ["zeta 2.0.0"],
        });
        const zeta = writePackage("mismatch", "zeta", { license: "MIT", version: "2.0.0" });
        expect(licencesFileMismatch(file, [zeta, one])).toEqual({ missing: [], extra: [] });
    });
});

describe("runtimePackageDirs", () => {
    it("lists the packages the lockfile does not mark dev, without type-only packages", () => {
        const project = "lock";
        writePackage(project, "runtime", { license: "MIT", main: "index.js" });
        writePackage(project, "@types/thing", { license: "MIT", types: "index.d.ts" });
        writePackage(project, "types-only", { license: "MIT", types: "index.d.ts", main: "" });
        writePackage(project, "nested", { license: "MIT", module: "index.mjs" });
        const lock = JSON.stringify({
            lockfileVersion: 3,
            packages: {
                "": { name: "app", dependencies: { runtime: "1" } },
                "node_modules/runtime": { version: "1.0.0" },
                "node_modules/@types/thing": { version: "1.0.0" },
                "node_modules/types-only": { version: "1.0.0" },
                "node_modules/tool": { version: "1.0.0", dev: true },
                "node_modules/runtime/node_modules/nested": { version: "1.0.0" },
            },
        });
        const root = join(temp, project);
        const prefix = root.replace(/\\/g, "/");
        expect(runtimePackageDirs(lock, root)).toEqual([
            `${prefix}/node_modules/runtime/node_modules/nested`,
            `${prefix}/node_modules/runtime`,
        ]);
    });

    it("needs a lockfile of version 2 or later", () => {
        expect(() => runtimePackageDirs(JSON.stringify({ dependencies: {} }), temp)).toThrow(
            LicenceError,
        );
    });
});

describe("strayPackages", () => {
    it("names the bundled packages that are not runtime dependencies", () => {
        const runtime = ["C:/app/node_modules/react", "C:/app/node_modules/a/node_modules/b"];
        expect(
            strayPackages(
                [
                    "C:\\app\\node_modules\\react",
                    "C:/app/node_modules/a/node_modules/b",
                    "C:/app/node_modules/vite",
                ],
                runtime,
            ),
        ).toEqual(["node_modules/vite"]);
    });
});

describe("licencesText", () => {
    const input = {
        title: "Example",
        licence: "MIT License\r\n\r\nCopyright (c) 2026 Owner\r\n",
        notices: "# Third-party notices\n\nPorted code.\n",
        packages: [
            {
                name: "zeta",
                version: "2.0.0",
                licence: "ISC",
                texts: [{ file: "LICENSE", text: "Z\n" }],
            },
            {
                name: "@alpha/one",
                version: "1.0.0",
                licence: "MIT",
                texts: [
                    { file: "LICENSE", text: "A\n" },
                    { file: "NOTICE", text: "N\n" },
                ],
            },
        ],
    };

    it("holds the program's licence, the notices and each package's licence, sorted by name", () => {
        const text = licencesText(input);
        expect(text.startsWith("Example: open source licences\n")).toBe(true);
        expect(text).toContain("MIT License\n\nCopyright (c) 2026 Owner\n");
        expect(text).toContain("Third-party notices (THIRD_PARTY_NOTICES.md)");
        expect(text).toContain("# Third-party notices\n\nPorted code.\n");
        expect(text).toContain("npm packages in this build (2)\n");
        const alpha = text.indexOf("@alpha/one 1.0.0 (MIT)");
        const zeta = text.indexOf("zeta 2.0.0 (ISC)");
        expect(alpha).toBeGreaterThan(0);
        expect(zeta).toBeGreaterThan(alpha);
        expect(text).toContain("[LICENSE]\n\nA\n\n[NOTICE]\n\nN\n");
        expect(text).not.toContain("\r");
        expect(text).not.toMatch(/\n{3}/);
        expect(text.endsWith("Z\n")).toBe(true);
    });

    it("gives the same text for the same input, whatever the order of the packages", () => {
        const reversed = { ...input, packages: [...input.packages].reverse() };
        expect(licencesText(reversed)).toBe(licencesText(input));
    });
});

describe("buildPackageDirs", () => {
    it("places the bundler's packages under the project, and needs them installed", () => {
        expect(BUILD_PACKAGES).toEqual(["node_modules/rolldown"]);
        const prefix = ROOT.replaceAll("\\", "/").replace(/\/$/, "");
        expect(buildPackageDirs(ROOT)).toEqual([`${prefix}/node_modules/rolldown`]);
        expect(() => buildPackageDirs(join(temp, "empty"))).toThrow(LicenceError);
        expect(() => buildPackageDirs(join(temp, "empty"))).toThrow(
            /node_modules\/rolldown is not installed/,
        );
    });
});

describe("the repository's licences file", () => {
    const lock = readFileSync(join(ROOT, "package-lock.json"), "utf8");
    const runtime = runtimePackageDirs(lock, ROOT);
    // As vite.config.ts lists them: the runtime dependencies (the development server's list,
    // which holds every package a build can bundle) and the bundler.
    const dirs = packageDirsOf(
        [...runtime, ...buildPackageDirs(ROOT)].map((dir) => `${dir}/package.json`),
    );
    const text = buildLicencesFile(ROOT, dirs, "NGNE Tilemap Editor");
    const fallbacks = join(ROOT, "scripts", "licence-texts");

    it("is the file the app opens", () => {
        expect(LICENCES_FILE).toBe(LICENCES_PATH);
    });

    it("lists every runtime dependency with an allowed licence and its text", () => {
        const names = runtime.map((dir) => dir.slice(dir.lastIndexOf("node_modules/") + 13));
        for (const name of [
            "@ngne/core",
            "react",
            "react-dom",
            "fflate",
            "fast-png",
            "lucide-react",
            "zustand",
        ]) {
            expect(names).toContain(name);
        }
        // Type declarations reach no build.
        expect(names.filter((name) => name.startsWith("@types/"))).toEqual([]);
        expect(names).not.toContain("csstype");
        for (const name of names) expect(text, name).toMatch(new RegExp(`\\n${name} \\S+ \\(`));
    });

    it("allows the licence of every package it lists, the bundler's included", () => {
        for (const dir of dirs) {
            const { name, licence } = readPackageLicence(dir, fallbacks);
            expect(licenceAllowed(licence), `${name} ${licence}`).toBe(true);
        }
    });

    it("holds, for every package it lists, a licence file with the text of its declared licence", () => {
        for (const dir of dirs) {
            const { name, licence, texts } = readPackageLicence(dir, fallbacks);
            const held = licenceTextMatches(
                licence,
                texts.map(({ text }) => text),
            );
            expect(held, `${name} ${licence}`).toBe(true);
        }
    });

    it("lists exactly the packages it was made for", () => {
        expect(licencesFileMismatch(text, dirs)).toEqual({ missing: [], extra: [] });
        expect(listedPackages(text)).toHaveLength(new Set(listedPackages(text)).size);
    });

    it("holds this project's licence and its notices: libtiled, Zingl, Aseprite, pixman, qjsonparser", () => {
        expect(text.startsWith("NGNE Tilemap Editor: open source licences\n")).toBe(true);
        expect(text).toContain(readFileSync(join(ROOT, "LICENSE"), "utf8").split("\n")[2]);
        expect(text).toContain("## libtiled (BSD-2-Clause)");
        expect(text).toContain("Copyright 2008-2011, Thorbjørn Lindeijer <thorbjorn@lindeijer.nl>");
        expect(text).toContain("## Bresenham curve rasterizing algorithms (MIT)");
        expect(text).toContain("Copyright (c) 2020 zingl");
        expect(text).toContain("## Aseprite Document Library (MIT)");
        expect(text).toContain("## pixman (MIT)");
        expect(text).toContain("## qjsonparser (permissive notice)");
        expect(text).toContain("Copyright (c) 2010 Girish Ramakrishnan <girish@forwardbias.in>");
        expect(text).toContain("Use, modification and distribution is allowed without limitation,");
    });

    it("lists rolldown, the bundler, with its licence and its third-party licence", () => {
        // A development dependency, listed by BUILD_PACKAGES alone.
        expect(strayPackages(buildPackageDirs(ROOT), runtime)).toEqual(["node_modules/rolldown"]);
        const [rolldown] = buildPackageDirs(ROOT);
        const entry = readPackageLicence(rolldown!, fallbacks);
        expect(entry.texts.map(({ file }) => file)).toEqual(["LICENSE", "THIRD-PARTY-LICENSE"]);
        const heading = `rolldown ${entry.version} (MIT)`;
        expect(text).toContain(`\n${heading}\n`);
        const section = text.slice(text.indexOf(`${"-".repeat(78)}\n${heading}\n`));
        expect(section).toMatch(/^-{78}\nrolldown \S+ \(MIT\)\n-{78}\n\[LICENSE\]\n/);
        expect(section).toContain("\n[THIRD-PARTY-LICENSE]\n");
    });

    it("takes the licence of react-remove-scroll-bar, which ships none, from scripts/licence-texts", () => {
        expect(text).toContain("[scripts/licence-texts/react-remove-scroll-bar.txt]");
        expect(text).toContain("Copyright (c) 2025 Anton Korzunov");
    });
});

describe("the service worker's code", () => {
    /** The specifiers a module imports or exports from, type-only ones included. */
    function specifiersOf(file: string): string[] {
        const source = readFileSync(file, "utf8");
        const pattern = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;
        return [...source.matchAll(pattern)].map((match) => match[1]!);
    }

    it("imports the program's own modules only: no package reaches sw.js", () => {
        // The PWA plugin builds src/app/pwa/sw.ts on its own, outside the build that writes the
        // licences file; vite.config.ts fails that build on any module the file does not cover.
        const src = join(ROOT, "src");
        const seen = new Set<string>();
        const queue = [join(src, "app", "pwa", "sw.ts")];
        while (queue.length > 0) {
            const file = queue.pop()!;
            if (seen.has(file)) continue;
            seen.add(file);
            for (const specifier of specifiersOf(file)) {
                expect(specifier, `${relative(ROOT, file)} imports ${specifier}`).toMatch(
                    /^\.\.?\//,
                );
                const target = resolve(dirname(file), specifier.replace(/(\.ts)?$/, ".ts"));
                expect(relative(src, target).startsWith(".."), target).toBe(false);
                queue.push(target);
            }
        }
        expect([...seen].map((file) => relative(src, file).replaceAll("\\", "/")).sort()).toEqual([
            "app/pwa/precache.ts",
            "app/pwa/sw.ts",
        ]);
    });
});
