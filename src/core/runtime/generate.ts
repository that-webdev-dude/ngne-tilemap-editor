import { GENERATOR } from "../generator";
import emitSource from "./emit.ts?raw";
import runtimeSource from "./runtime.ts?raw";
import { TILEMAP_VERSION } from "./runtime";

// The generator of `ngne-tilemap.ts` (SPEC 11): the header, the quad emitter and the runtime
// source, read as text, and the export folder's tables. The output imports nothing.

/**
 * The second line of the header: the generated file is under MIT-0, the MIT licence without its
 * condition to keep the notice, so a game that copies it carries no notice for it (SPEC 11.1).
 */
const LICENCE_LINE = "// SPDX-License-Identifier: MIT-0";

/** The line of `runtime.ts` where its placeholder tables start; it and the rest are replaced. */
export const TABLES_MARKER =
    "// The export folder's tables. The generator replaces this line and everything below it.";

/** The export names of a folder's files, each a slug (FORMAT 1.1); order does not matter. */
export interface RuntimeTables {
    /** Maps: `<name>.tilemap.json`. */
    readonly tilemaps: readonly string[];
    /** Tilesets: `<name>.atlas.json` and `<name>.png`. */
    readonly tilesets: readonly string[];
    /** Images: `<name>.png`. */
    readonly images: readonly string[];
}

const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
// Line starts only, with `[ \t]*` rather than `\s*`: a `\s*` there spans lines, which makes a
// match take time quadratic in the number of lines.
const IMPORT = /^[ \t]*import[\s{*"']/m;
const EXPORT = /^[ \t]*export\s/m;
const FROM = /\sfrom\s/;
/** An import of the emitter, the one import the runtime source may have: the emitter is inlined. */
const EMIT_IMPORT = /^import\s[^;]*?\sfrom\s+"\.\/emit(?:\.ts)?";\n/gm;

/** The names sorted in UTF-16 code-unit order, each checked to be a distinct slug. */
function names(list: readonly string[], kind: string): string[] {
    const sorted = [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    sorted.forEach((name, index) => {
        if (!SLUG.test(name) || name === "ngne-tilemap") {
            throw new Error(`The ${kind} export name ${JSON.stringify(name)} is no slug.`);
        }
        if (index > 0 && sorted[index - 1] === name) {
            throw new Error(`The ${kind} export name ${JSON.stringify(name)} is repeated.`);
        }
    });
    return sorted;
}

function url(file: string): string {
    return `new URL(${JSON.stringify(`./${file}`)}, import.meta.url).href`;
}

function union(list: readonly string[]): string {
    return list.length === 0 ? "never" : list.map((name) => JSON.stringify(name)).join(" | ");
}

function table(entries: readonly string[]): string {
    return entries.length === 0 ? "{}" : `{\n${entries.join("")}}`;
}

/** The tables part of the output, as static code so that bundlers see every file. */
function tablesCode(tables: RuntimeTables): string {
    const tilemaps = names(tables.tilemaps, "tilemap");
    const tilesets = names(tables.tilesets, "tileset");
    const images = names(tables.images, "image");
    const key = (name: string) => `    ${JSON.stringify(name)}: `;
    return [
        TABLES_MARKER.replace(" The generator replaces this line and everything below it.", ""),
        "",
        "/** The export names of this folder's tilemaps. */",
        `export type TilemapName = ${union(tilemaps)};`,
        "",
        "/** The export names of this folder's tilesets. */",
        `export type TilesetName = ${union(tilesets)};`,
        "",
        "/** Each tilemap's `.tilemap.json`, by export name. */",
        `export const TILEMAP_URLS: Readonly<Record<TilemapName, string>> = ${table(
            tilemaps.map((name) => `${key(name)}${url(`${name}.tilemap.json`)},\n`),
        )};`,
        "",
        "/** Each tileset's atlas, by export name. */",
        `export const ATLAS_URLS: Readonly<Record<TilesetName, AtlasUrls>> = ${table(
            tilesets.map(
                (name) =>
                    `${key(name)}{\n` +
                    `        json: ${url(`${name}.atlas.json`)},\n` +
                    `        png: ${url(`${name}.png`)},\n` +
                    `    },\n`,
            ),
        )};`,
        "",
        "/** Each image's `.png`, by export name. */",
        `export const IMAGE_URLS: Readonly<Record<string, string>> = ${table(
            images.map((name) => `${key(name)}${url(`${name}.png`)},\n`),
        )};`,
        "",
    ].join("\n");
}

/** Whether `code` imports a module: a line that starts an `import` or an `export ... from`. */
export function importsModule(code: string): boolean {
    if (IMPORT.test(code)) return true;
    // An `export` at a line start with ` from ` after it in the same statement, up to its `;`.
    return code.split(";").some((statement) => {
        const exported = EXPORT.exec(statement);
        return exported !== null && FROM.test(statement.slice(exported.index + exported[0].length));
    });
}

/** The runtime source before its placeholder tables, without its import of the emitter. */
function runtimeBody(source: string): string {
    const at = source.indexOf(`${TABLES_MARKER}\n`);
    if (at < 0 || source.indexOf(`${TABLES_MARKER}\n`, at + 1) >= 0) {
        throw new Error("The runtime source does not hold its tables marker exactly once.");
    }
    return source.slice(0, at).replace(EMIT_IMPORT, "");
}

/**
 * The text of `ngne-tilemap.ts` for an export folder with these files (SPEC 11.1): the header,
 * the emitter and the runtime, then the tables `TILEMAP_URLS`, `ATLAS_URLS`, `IMAGE_URLS` and
 * the types `TilemapName`, `TilesetName`. Names are sorted, so the same names give the same
 * bytes in any order. LF line ends, ASCII. Throws when a name is no slug or is repeated within
 * its kind.
 */
export function generateRuntime(tables: RuntimeTables): string {
    const lf = (text: string) => text.replace(/\r\n/g, "\n");
    const body = [
        `// Generated by ${GENERATOR}. Reads ngne-tilemap versions 1..${TILEMAP_VERSION}. Do not edit.`,
        LICENCE_LINE,
        "",
        lf(emitSource).trimEnd(),
        "",
        runtimeBody(lf(runtimeSource)).trimEnd(),
        "",
        tablesCode(tables),
    ].join("\n");
    if (importsModule(body)) {
        throw new Error("The generated runtime would import a module.");
    }
    return body;
}
