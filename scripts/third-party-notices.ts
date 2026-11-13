import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The npm section of public/THIRD-PARTY-NOTICES.txt, which the build copies into dist/: the
// copyright notice and licence text of every npm package whose code can reach the built app.
// Those are the production dependencies and the packages they depend on (the entries of
// package-lock.json not marked dev), read from node_modules, and the bundler, which adds its
// module runtime and modulepreload polyfill to the bundle. The section runs from its heading
// to the end of the file; everything above it is written by hand. A unit test
// (tests/unit/cleanup-third-party-notices.test.ts) fails when the committed section differs
// from a fresh run. After installing or updating a package, write it again with
//
//     node scripts/third-party-notices.ts
//
// (Node 24 runs the TypeScript directly; this file imports nothing relative for that reason.)

const ROOT = new URL("../", import.meta.url);
export const NOTICES_FILE = new URL("public/THIRD-PARTY-NOTICES.txt", ROOT);
export const SECTION_HEADING = "6. npm packages";

/** Development packages whose own code the build writes into the bundle. */
const BUILD_CODE = ["node_modules/rolldown"];

/** A licence or notice file at the top of a package. */
const LICENCE_FILE = /^(licen[cs]e|copying|notice|third-party-licen[cs]e)([.-].*)?$/i;

/** The MIT terms, for a package that states MIT but ships no licence file. */
const MIT_TERMS = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

interface LockEntry {
    readonly version?: string;
    readonly dev?: boolean;
    readonly devOptional?: boolean;
    readonly optional?: boolean;
}

interface Manifest {
    readonly name: string;
    readonly version: string;
    readonly license?: string;
    readonly author?: string | { readonly name?: string };
}

/** An installed package and its licence text. */
export interface PackageNotice {
    readonly name: string;
    readonly version: string;
    readonly licence: string;
    readonly text: string;
}

const lf = (text: string) => text.replace(/\r\n?/g, "\n");
const trimLines = (text: string) =>
    lf(text)
        .replace(/[ \t]+$/gm, "")
        .trim();

/** The lockfile paths of the packages the section covers. */
export function noticePaths(lockText = readFileSync(new URL("package-lock.json", ROOT), "utf8")) {
    const lock = JSON.parse(lockText) as { packages: Record<string, LockEntry> };
    const production = Object.entries(lock.packages)
        .filter(([path, entry]) => path !== "" && !entry.dev && !entry.devOptional)
        .map(([path]) => path);
    for (const path of BUILD_CODE) {
        if (!lock.packages[path]) throw new Error(`third-party-notices: ${path} is not installed`);
    }
    return { lock: lock.packages, paths: [...production, ...BUILD_CODE] };
}

function authorName(author: Manifest["author"]): string | undefined {
    const name = typeof author === "string" ? author : author?.name;
    return name?.replace(/\s*[<(].*$/, "").trim() || undefined;
}

/** The notice of the package installed at `path` (a lockfile path such as node_modules/x). */
function packageNotice(path: string, entry: LockEntry): PackageNotice {
    const folder = new URL(`${path}/`, ROOT);
    const manifest = JSON.parse(readFileSync(new URL("package.json", folder), "utf8")) as Manifest;
    if (manifest.version !== entry.version) {
        throw new Error(
            `third-party-notices: ${path} is ${manifest.version}, package-lock.json wants ` +
                `${entry.version}; run npm ci`,
        );
    }
    const files = readdirSync(folder)
        .filter((file) => LICENCE_FILE.test(file))
        .sort((a, b) => a.localeCompare(b, "en"));
    const licence = manifest.license ?? "other";
    let text: string;
    if (files.length > 0) {
        text = files
            .map((file) => trimLines(readFileSync(new URL(file, folder), "utf8")))
            .join("\n\n---\n\n");
    } else if (manifest.license === "MIT") {
        const author = authorName(manifest.author);
        if (!author) throw new Error(`third-party-notices: ${path} names no author`);
        text =
            `The package ships no licence file; its package.json states the MIT licence and\n` +
            `names ${author} as its author.\n\n${MIT_TERMS}`;
    } else {
        throw new Error(`third-party-notices: ${path} has no licence file`);
    }
    return { name: manifest.name, version: manifest.version, licence, text };
}

/** Every package of the section, sorted by name. */
export function packageNotices(lockText?: string): PackageNotice[] {
    const { lock, paths } = noticePaths(lockText);
    return (
        paths
            // An optional package for another platform is not installed here, and not bundled.
            .filter((path) => !lock[path]!.optional || existsSync(new URL(`${path}/`, ROOT)))
            .map((path) => packageNotice(path, lock[path]!))
            .sort(
                (a, b) =>
                    a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en"),
            )
    );
}

/** The npm section, from its heading to the end of the file. */
export function npmSection(notices = packageNotices()): string {
    // Packages with the same licence text share one copy of it, in the order of their first
    // package's name.
    const groups = new Map<string, PackageNotice[]>();
    for (const notice of notices) {
        groups.set(notice.text, [...(groups.get(notice.text) ?? []), notice]);
    }
    const lines = [
        SECTION_HEADING,
        "",
        "Written by `node scripts/third-party-notices.ts` from node_modules: the editor's",
        "production npm dependencies and the packages they depend on (package-lock.json), and",
        "rolldown, the bundler, which adds its module runtime and modulepreload polyfill to the",
        "bundle. The bundle holds the code the app uses from these packages. Packages with the",
        "same licence text share one copy of it.",
    ];
    let index = 0;
    for (const [text, group] of groups) {
        index++;
        const licences = [...new Set(group.map((notice) => notice.licence))].join(", ");
        lines.push("", "", `6.${index} ${licences} licence`, "");
        for (const notice of group) lines.push(`- ${notice.name} ${notice.version}`);
        lines.push("", text);
    }
    return `${lines.join("\n")}\n`;
}

/** The notices file with its npm section replaced by `section`, or added at its end. */
export function withNpmSection(file: string, section: string): string {
    const text = lf(file);
    const at = text.indexOf(`\n${SECTION_HEADING}\n`);
    return at < 0 ? `${text.trimEnd()}\n\n\n${section}` : text.slice(0, at + 1) + section;
}

/** The npm section of the notices file as committed. */
export function committedNpmSection(file = readFileSync(NOTICES_FILE, "utf8")): string {
    const text = lf(file);
    const at = text.indexOf(`\n${SECTION_HEADING}\n`);
    return at < 0 ? "" : text.slice(at + 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const section = npmSection();
    writeFileSync(NOTICES_FILE, withNpmSection(readFileSync(NOTICES_FILE, "utf8"), section));
    console.log(`public/THIRD-PARTY-NOTICES.txt: ${packageNotices().length} npm packages`);
}
