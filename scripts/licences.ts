import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

// The open-source licences file of the build (`licences.txt` beside `index.html`): this
// program's licence, THIRD_PARTY_NOTICES.md, and the full licence text of every npm package
// whose code ends up in the build. vite.config.ts writes it: the build lists the packages of
// the modules it bundled (the app and its web workers); the development server, which bundles
// nothing, lists the runtime dependencies of package-lock.json. The build adds the bundler
// packages whose virtual modules it rendered (`VIRTUAL_MODULES`); the development server adds
// every one of `BUILD_PACKAGES`. The Open Source Licences command opens the file
// (src/app/licences).
//
// Every package listed must carry a licence of `ALLOWED_LICENCES` and a licence file whose
// text is that licence's (`LICENCE_PHRASES`); a package without them fails the build
// (`LicenceError`). The build also fails on a rendered module that is neither a file of the
// program, nor a package's, nor a virtual module of `VIRTUAL_MODULES` (`unknownModules`), and
// on a written licences file that does not list exactly the build's packages
// (`licencesFileMismatch`). The service worker, which the PWA plugin builds on its own after
// the licences file is written, may render the program's own files only, and the bundler's
// virtual modules when the licences file lists that bundler package.
//
// A package that publishes no licence file of its own may have one under
// scripts/licence-texts/, named after the package (`@scope/name` as `@scope__name.txt`),
// copied from the package's own repository: the exception is explicit and reviewed, never
// made up here.

/** The file the build writes, relative to the app's base. */
export const LICENCES_FILE = "licences.txt";

/** SPDX identifiers a shipped package may carry. */
export const ALLOWED_LICENCES: readonly string[] = [
    "MIT",
    "ISC",
    "0BSD",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "Apache-2.0",
];

/**
 * Development packages whose own code the bundler writes into every build, by their place under
 * the project: rolldown, whose module runtime (`\0rolldown/runtime.js`) and modulepreload
 * polyfill (`\0vite/modulepreload-polyfill.js`, built by rolldown's native plugin) are virtual
 * modules, which `packageDirOf` cannot place. They are listed by this list alone: the stray
 * check leaves them alone, and the runtime dependencies do not include them.
 */
export const BUILD_PACKAGES: readonly string[] = ["node_modules/rolldown"];

/**
 * The virtual modules (ids that name no file) a build may render, each with the package of
 * `BUILD_PACKAGES` whose code it is. A virtual module of another plugin that renders code
 * fails the build until it is added here, with its package and that package's licence.
 */
export const VIRTUAL_MODULES: Readonly<Record<string, string>> = {
    "\0rolldown/runtime.js": "node_modules/rolldown",
    "\0vite/modulepreload-polyfill.js": "node_modules/rolldown",
};

/**
 * Phrases of the text of each licence of `ALLOWED_LICENCES`. A package's licence files must
 * hold every phrase of the licence it declares (of one alternative of an OR, of every part of
 * an AND). They are compared as lower-case words: every run of other characters, line breaks
 * and comment marks included, reads as one space.
 */
export const LICENCE_PHRASES: Readonly<Record<string, readonly string[]>> = {
    MIT: ["Permission is hereby granted, free of charge, to any person obtaining a copy"],
    ISC: [
        "distribute this software for any purpose with or without fee is hereby granted",
        "provided that the above copyright notice and this permission notice appear in all copies",
    ],
    "0BSD": ["distribute this software for any purpose with or without fee is hereby granted"],
    "BSD-2-Clause": [
        "Redistributions of source code must retain the above copyright notice",
        "Redistributions in binary form must reproduce the above copyright notice",
    ],
    "BSD-3-Clause": [
        "Redistributions of source code must retain the above copyright notice",
        "Redistributions in binary form must reproduce the above copyright notice",
        "Neither the name of",
    ],
    "Apache-2.0": ["Apache License", "Version 2.0"],
};

/** Licence files, NOTICE and third-party licence files among them, at a package's top. */
const LICENCE_FILE_NAME = /^(licen[cs]e|copying|notice|third-party-licen[cs]e)([.-].*)?$/i;

/** Why a package cannot be listed. */
export class LicenceError extends Error {
    override name = "LicenceError";
}

/** One file of a package's licence. */
export interface LicenceText {
    /** The file name: "LICENSE", "LICENSE.md", … */
    file: string;
    text: string;
}

/** A package as the licences file lists it. */
export interface PackageLicence {
    name: string;
    version: string;
    /** The package's SPDX licence expression. */
    licence: string;
    texts: readonly LicenceText[];
}

/**
 * The directory of the npm package a bundled module belongs to, or null for a module of the
 * program itself (or a virtual one). The innermost `node_modules` counts, so a nested copy
 * of a package is that copy.
 */
export function packageDirOf(moduleId: string): string | null {
    const id = moduleId.startsWith("\0") ? moduleId.slice(1) : moduleId;
    const query = id.search(/[?#]/);
    const path = (query < 0 ? id : id.slice(0, query)).replaceAll("\\", "/");
    const marker = "/node_modules/";
    const at = path.lastIndexOf(marker);
    if (at < 0) return null;
    const rest = path.slice(at + marker.length).split("/");
    const parts = rest[0]?.startsWith("@") ? rest.slice(0, 2) : rest.slice(0, 1);
    if (parts.length === 0 || parts.includes("")) return null;
    return `${path.slice(0, at + marker.length)}${parts.join("/")}`;
}

/** The package directories of the modules, each once, in order of name. */
export function packageDirsOf(moduleIds: Iterable<string>): string[] {
    const dirs = new Set<string>();
    for (const id of moduleIds) {
        const dir = packageDirOf(id);
        if (dir) dirs.add(dir);
    }
    return [...dirs].sort(
        (a, b) => nameFromDir(a).localeCompare(nameFromDir(b)) || a.localeCompare(b),
    );
}

/** Where the code of a rendered module comes from. */
export type ModuleSource =
    /** A file of the program, under the project and outside `node_modules`. */
    | { kind: "program" }
    /** A file of the npm package in `dir`. */
    | { kind: "package"; dir: string }
    /** A virtual module of `VIRTUAL_MODULES`: code of the bundler package at `path`. */
    | { kind: "bundler"; path: string }
    /** Anything else: a virtual module of another plugin, or a file outside the project. */
    | { kind: "unknown" };

/** Where the code of the module `moduleId` of a build of the project at `root` comes from. */
export function moduleSource(moduleId: string, root: string): ModuleSource {
    const bundler = VIRTUAL_MODULES[moduleId];
    if (bundler !== undefined) return { kind: "bundler", path: bundler };
    const dir = packageDirOf(moduleId);
    if (dir !== null) return { kind: "package", dir };
    const id = moduleId.startsWith("\0") ? moduleId.slice(1) : moduleId;
    const query = id.search(/[?#]/);
    const path = query < 0 ? id : id.slice(0, query);
    // A file is an absolute path, POSIX or Windows; any other id names no file.
    if (!/^([a-z]:)?[\\/]/i.test(path)) return { kind: "unknown" };
    const inside = relative(root, path);
    if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) return { kind: "unknown" };
    return { kind: "program" };
}

/** The modules among `moduleIds` whose code no licence covers (`moduleSource` "unknown"). */
export function unknownModules(moduleIds: Iterable<string>, root: string): string[] {
    return [...moduleIds].filter((id) => moduleSource(id, root).kind === "unknown");
}

/** The packages of `BUILD_PACKAGES` with a virtual module among `moduleIds`, in their order. */
export function bundlerPackagesOf(moduleIds: Iterable<string>): string[] {
    const used = new Set<string>();
    for (const id of moduleIds) {
        const path = VIRTUAL_MODULES[id];
        if (path !== undefined) used.add(path);
    }
    return BUILD_PACKAGES.filter((path) => used.has(path));
}

function nameFromDir(dir: string): string {
    return dir.slice(dir.lastIndexOf("/node_modules/") + "/node_modules/".length);
}

/**
 * Whether an SPDX expression is allowed: one identifier of `allowed`, or an expression of
 * them with OR (one allowed alternative suffices) and AND (every part must be allowed).
 */
export function licenceAllowed(
    expression: string,
    allowed: readonly string[] = ALLOWED_LICENCES,
): boolean {
    return satisfies(expression, (id) => allowed.includes(id));
}

/**
 * Whether `texts` hold the text of an SPDX expression's licence, by `LICENCE_PHRASES`: of one
 * alternative of an OR that is in `allowed`, of every part of an AND. A licence without phrases
 * is never held.
 */
export function licenceTextMatches(
    expression: string,
    texts: readonly string[],
    allowed: readonly string[] = ALLOWED_LICENCES,
): boolean {
    const words = texts.map(wordsOf).join(" | ");
    return satisfies(expression, (id) => {
        const phrases = LICENCE_PHRASES[id];
        if (!allowed.includes(id) || !phrases?.length) return false;
        return phrases.every((phrase) => words.includes(wordsOf(phrase)));
    });
}

/** Lower-case words, each run of other characters as one space. */
function wordsOf(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

/**
 * Whether an SPDX expression holds when each identifier holds as `holds` says: an expression
 * of identifiers with OR (one alternative suffices) and AND (every part must hold).
 */
function satisfies(expression: string, holds: (id: string) => boolean): boolean {
    const bare = expression
        .trim()
        .replace(/^\((.*)\)$/, "$1")
        .trim();
    if (bare === "") return false;
    const tokens = bare.split(/\s+/);
    const alternatives = splitOn(tokens, "OR");
    if (alternatives.length > 1) {
        // An operator at an end or two in a row leave an empty operand: not an expression.
        if (alternatives.includes("")) return false;
        return alternatives.some((part) => satisfies(part, holds));
    }
    const parts = splitOn(tokens, "AND");
    if (parts.length > 1) return parts.every((part) => satisfies(part, holds));
    return holds(bare);
}

/** The operands of `operator` among `tokens`, each joined back with single spaces. */
function splitOn(tokens: readonly string[], operator: string): string[] {
    const operands: string[] = [];
    let current: string[] = [];
    for (const token of tokens) {
        if (token === operator) {
            operands.push(current.join(" "));
            current = [];
        } else {
            current.push(token);
        }
    }
    operands.push(current.join(" "));
    return operands;
}

/** An SPDX identifier as `package.json` gives one: a string, or an object with a string `type`. */
function spdxOf(value: unknown): string | null {
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && "type" in value && typeof value.type === "string") {
        return value.type;
    }
    return null;
}

/**
 * The licence of a `package.json`: `license`, or the older `licenses` list (its entries as
 * alternatives). Null when neither states one, or when an entry of the list is no identifier.
 */
function licenceOf(manifest: Record<string, unknown>): string | null {
    const { license, licenses } = manifest;
    const single = spdxOf(license);
    if (single !== null) return single;
    if (Array.isArray(licenses) && licenses.length > 0) {
        const entries = licenses.map(spdxOf);
        if (entries.includes(null)) return null;
        return entries.join(" OR ");
    }
    return null;
}

/** Orders strings by UTF-16 code unit, as `Array.prototype.sort` does by default. */
function byCodeUnit(a: string, b: string): number {
    if (a === b) return 0;
    return a < b ? -1 : 1;
}

/** The file of scripts/licence-texts/ that stands in for a package's missing licence file. */
export function fallbackFileOf(name: string): string {
    return `${name.replace("/", "__")}.txt`;
}

/** The `package.json` of the package in `dir`, with its name (or its directory's) and version. */
function readManifest(dir: string): {
    manifest: Record<string, unknown>;
    name: string;
    version: string;
} {
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<
        string,
        unknown
    >;
    const name =
        typeof manifest.name === "string" ? manifest.name : nameFromDir(dir.replaceAll("\\", "/"));
    const version = typeof manifest.version === "string" ? manifest.version : "";
    return { manifest, name, version };
}

/**
 * Reads the package in `dir`: its name, version and licence from `package.json`, and the text
 * of each licence file at its top (or of its file in `fallbackDir`). Throws `LicenceError` when
 * the licence is missing or not allowed, or when no licence text is found.
 */
export function readPackageLicence(
    dir: string,
    fallbackDir: string,
    allowed: readonly string[] = ALLOWED_LICENCES,
): PackageLicence {
    const { manifest, name, version } = readManifest(dir);
    const licence = licenceOf(manifest);
    if (licence === null) {
        throw new LicenceError(`${name}@${version} states no licence in its package.json.`);
    }
    if (!licenceAllowed(licence, allowed)) {
        throw new LicenceError(
            `${name}@${version} is licensed ${licence}, which is not one of ${allowed.join(", ")}.`,
        );
    }
    let texts: LicenceText[] = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && LICENCE_FILE_NAME.test(entry.name))
        .map((entry) => entry.name)
        .sort(byCodeUnit)
        .map((file) => ({ file, text: normalise(readFileSync(join(dir, file), "utf8")) }));
    if (texts.length === 0) {
        const fallback = join(fallbackDir, fallbackFileOf(name));
        if (existsSync(fallback)) {
            texts = [
                {
                    file: `scripts/licence-texts/${fallbackFileOf(name)}`,
                    text: normalise(readFileSync(fallback, "utf8")),
                },
            ];
        }
    }
    if (texts.length === 0) {
        throw new LicenceError(
            `${name}@${version} (${licence}) has no licence file. Add its licence text, from ` +
                `the package's repository, as scripts/licence-texts/${fallbackFileOf(name)}.`,
        );
    }
    if (
        !licenceTextMatches(
            licence,
            texts.map(({ text }) => text),
            allowed,
        )
    ) {
        throw new LicenceError(
            `${name}@${version} declares ${licence}, but none of its licence files ` +
                `(${texts.map(({ file }) => file).join(", ")}) holds that licence's text.`,
        );
    }
    return { name, version, licence, texts };
}

/** Line endings LF, no trailing spaces, one final newline. */
function normalise(text: string): string {
    return `${text
        .replace(/^\uFEFF/, "")
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n")
        .trim()}\n`;
}

/**
 * The runtime dependencies of a `package-lock.json` (lockfile version 2 or 3): the directory
 * of every package it does not mark `dev`, relative to the project, in order of name.
 * Packages that hold only type declarations (`@types/*`, or a package with types and no
 * entry point) are left out: none of their code can reach a build.
 */
export function runtimePackageDirs(lockText: string, root: string): string[] {
    const lock = JSON.parse(lockText) as { packages?: Record<string, { dev?: boolean }> };
    if (!lock.packages)
        throw new LicenceError("package-lock.json has no `packages` (lockfile v2+).");
    const dirs: string[] = [];
    for (const [path, entry] of Object.entries(lock.packages)) {
        if (path === "" || entry.dev || !path.includes("node_modules/")) continue;
        const dir = `${root.replaceAll("\\", "/").replace(/\/$/, "")}/${path}`;
        if (typesOnly(dir)) continue;
        dirs.push(dir);
    }
    return packageDirsOf(dirs.map((dir) => `${dir}/package.json`));
}

/** A package's place under the project: "node_modules/a" or "node_modules/a/node_modules/b". */
function packageKey(dir: string): string {
    const path = dir.replaceAll("\\", "/");
    return path.slice(path.indexOf("/node_modules/") + 1);
}

/**
 * The packages of `dirs` that are not among `runtimeDirs` (as `runtimePackageDirs` gives
 * them), by their place under the project: code the build bundles from a development
 * dependency, which the licences file would not vouch for.
 */
export function strayPackages(dirs: readonly string[], runtimeDirs: readonly string[]): string[] {
    const runtime = new Set(runtimeDirs.map(packageKey));
    return dirs.map(packageKey).filter((key) => !runtime.has(key));
}

/**
 * The directories under `root` of `paths`, by default every one of `BUILD_PACKAGES` (the build
 * passes those whose virtual modules it rendered, `bundlerPackagesOf`). Throws `LicenceError`
 * when one is not installed.
 */
export function buildPackageDirs(
    root: string,
    paths: readonly string[] = BUILD_PACKAGES,
): string[] {
    const base = root.replaceAll("\\", "/").replace(/\/$/, "");
    return paths.map((path) => {
        const dir = `${base}/${path}`;
        if (!existsSync(join(dir, "package.json"))) {
            throw new LicenceError(`${path} is not installed; run npm ci.`);
        }
        return dir;
    });
}

function typesOnly(dir: string): boolean {
    const name = nameFromDir(dir);
    if (name.startsWith("@types/")) return true;
    const file = join(dir, "package.json");
    if (!existsSync(file)) return false;
    const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const hasTypes = Boolean(manifest.types ?? manifest.typings);
    const hasEntry = Boolean(
        manifest.main || manifest.module || manifest.exports || manifest.browser,
    );
    return hasTypes && !hasEntry;
}

/** What the licences file is made of. */
export interface LicencesInput {
    /** The program's name, as the file's title. */
    title: string;
    /** The text of the program's LICENSE. */
    licence: string;
    /** The text of THIRD_PARTY_NOTICES.md. */
    notices: string;
    packages: readonly PackageLicence[];
}

const RULE = "=".repeat(78);
const THIN = "-".repeat(78);

/** The text of the licences file; the same input always gives the same text. */
export function licencesText(input: LicencesInput): string {
    const packages = [...input.packages].sort(
        (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
    );
    const sections = [
        `${input.title}: open source licences`,
        RULE,
        "This file holds the licence of this program, the notices of third-party code it",
        "contains, and the licence of every npm package whose code is part of this build.",
        "",
        RULE,
        input.title,
        RULE,
        normalise(input.licence),
        RULE,
        "Third-party notices (THIRD_PARTY_NOTICES.md)",
        RULE,
        normalise(input.notices),
        RULE,
        `npm packages in this build (${packages.length})`,
        RULE,
        ...packages.map((entry) => `${entry.name} ${entry.version} (${entry.licence})`),
        "",
        ...packages.flatMap((entry) => [
            THIN,
            `${entry.name} ${entry.version} (${entry.licence})`,
            THIN,
            ...entry.texts.flatMap(({ file, text }) => [`[${file}]`, "", text]),
        ]),
    ];
    return `${sections
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()}\n`;
}

/**
 * The licences file for the packages in `dirs`, with the program's LICENSE and
 * THIRD_PARTY_NOTICES.md from `root`. Throws `LicenceError` as `readPackageLicence` does.
 */
export function buildLicencesFile(root: string, dirs: readonly string[], title: string): string {
    const fallbackDir = join(root, "scripts", "licence-texts");
    return licencesText({
        title,
        licence: readFileSync(join(root, "LICENSE"), "utf8"),
        notices: readFileSync(join(root, "THIRD_PARTY_NOTICES.md"), "utf8"),
        packages: dirs.map((dir) => readPackageLicence(dir, fallbackDir)),
    });
}

/**
 * The packages a licences file lists, as "name version", in its order. Throws `LicenceError`
 * when the file has no package list or its count is not the number of packages listed.
 */
export function listedPackages(text: string): string[] {
    const heading = /\nnpm packages in this build \((\d+)\)\n={78}\n/.exec(text);
    if (!heading) throw new LicenceError("The licences file has no list of npm packages.");
    const start = heading.index + heading[0].length;
    const end = text.indexOf("\n\n", start);
    const lines = text.slice(start, end < 0 ? undefined : end).split("\n");
    const listed = lines
        .filter((line) => line !== "")
        .map((line) => {
            const entry = /^(\S+) (\S*) \(.+\)$/.exec(line);
            if (!entry) throw new LicenceError(`The licences file lists "${line}", not a package.`);
            return `${entry[1]} ${entry[2]}`;
        });
    if (listed.length !== Number(heading[1])) {
        throw new LicenceError(
            `The licences file counts ${heading[1]} npm packages but lists ${listed.length}.`,
        );
    }
    return listed;
}

/** How the packages a licences file lists differ from a build's. */
export interface LicencesMismatch {
    /** Packages of the build the file does not list, as "name version". */
    missing: string[];
    /** Packages the file lists that are not the build's, as "name version". */
    extra: string[];
}

/**
 * How the packages a licences file lists (`listedPackages`) differ from the packages in `dirs`,
 * the build's, read from their `package.json`. Both lists are empty when they agree.
 */
export function licencesFileMismatch(text: string, dirs: readonly string[]): LicencesMismatch {
    const listed = new Set(listedPackages(text));
    const bundled = new Set(
        dirs.map((dir) => {
            const { name, version } = readManifest(dir);
            return `${name} ${version}`;
        }),
    );
    return {
        missing: [...bundled].filter((entry) => !listed.has(entry)).sort(byCodeUnit),
        extra: [...listed].filter((entry) => !bundled.has(entry)).sort(byCodeUnit),
    };
}
