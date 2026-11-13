import { Buffer } from "node:buffer";
import { error, log } from "node:console";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import process from "node:process";

// SE-073: offline check of every tracked Markdown file, independent of npm dependencies.
// Git's index supplies the inventory (including staged files), never node_modules or build
// output. TE-067: read from the index file itself, so no `git` program is looked up on the
// PATH; run from the repository's top folder. The vendored engine packages of the runtime
// compile matrix (tests/runtime-compat/<version>/vendor/) are left out: their docs link into
// the engine's own repository. The Markdown constructs whose regular expressions could
// backtrack (links and HTML tags in headings, closing hashes, fences, reference definitions,
// link labels) are read by linear scans that match what those expressions matched.
const root = process.cwd();

/** The repository's git directory: `.git`, or the folder a worktree's `.git` file names. */
function gitDirectory(top) {
    const dotGit = resolve(top, ".git");
    if (statSync(dotGit).isDirectory()) return dotGit;
    const pointer = readFileSync(dotGit, "utf8").trim();
    if (!pointer.startsWith("gitdir:")) throw new Error(`${dotGit} names no git directory`);
    return resolve(top, pointer.slice("gitdir:".length).trim());
}

/** A variable-length offset of an index v4 entry (git's `decode_varint`). */
function varint(bytes, at) {
    let next = at;
    let byte = bytes[next];
    let value = byte & 127;
    while ((byte & 128) !== 0) {
        next += 1;
        byte = bytes[next];
        value = ((value + 1) << 7) + (byte & 127);
    }
    return { value, next: next + 1 };
}

/** Refuses a split index: its `link` extension keeps entries in another file. */
function refuseSplitIndex(index, from, gitDir) {
    // Extensions follow the entries, then the index's hash.
    let at = from;
    while (at + 8 <= index.length - 20) {
        if (index.toString("latin1", at, at + 4) === "link") {
            throw new Error(`${gitDir}/index is a split index`);
        }
        at += 8 + index.readUInt32BE(at + 4);
    }
}

/**
 * The paths of the index entries, in index order, each once (as `git ls-files`): index
 * versions 2 to 4; directory entries of a sparse index are left out.
 */
function indexPaths(gitDir) {
    const index = readFileSync(resolve(gitDir, "index"));
    const version = index.readUInt32BE(4);
    if (index.toString("latin1", 0, 4) !== "DIRC" || version < 2 || version > 4) {
        throw new Error(`${gitDir}/index is no git index of version 2 to 4`);
    }
    const paths = new Set();
    let previous = Buffer.alloc(0);
    let at = 12;
    for (let n = index.readUInt32BE(8); n > 0; n--) {
        const start = at;
        const mode = index.readUInt32BE(at + 24);
        const extended = version >= 3 && (index.readUInt16BE(at + 60) & 0x4000) !== 0;
        at += extended ? 64 : 62;
        let path;
        if (version === 4) {
            const { value: strip, next } = varint(index, at);
            const end = index.indexOf(0, next);
            path = Buffer.concat([
                previous.subarray(0, previous.length - strip),
                index.subarray(next, end),
            ]);
            at = end + 1;
        } else {
            const end = index.indexOf(0, at);
            path = index.subarray(at, end);
            // NULs pad each entry to a multiple of 8 bytes, at least one.
            at = start + ((end - start + 8) & ~7);
        }
        previous = path;
        if ((mode & 0o170000) !== 0o040000) paths.add(path.toString("utf8"));
    }
    refuseSplitIndex(index, at, gitDir);
    return [...paths];
}

/** Whether a path lies under tests/runtime-compat/<version>/vendor/. */
function isVendored(path) {
    const parts = path.split("/");
    return parts[0] === "tests" && parts[1] === "runtime-compat" && parts[3] === "vendor";
}

const files = indexPaths(gitDirectory(root)).filter(
    (path) => path.endsWith(".md") && !isVendored(path),
);
const problems = [];
const anchors = new Map();
const blank = (text) => text.replace(/[^\n]/g, " ");
const ID_ATTRIBUTES = /\b(?:id|name)\s*=\s*["']([^"']+)["']/gi;
const isSpaceOrTab = (char) => char === " " || char === "\t";
const isLineTerminator = (char) =>
    char === "\n" || char === "\r" || char === "\u2028" || char === "\u2029";

/** A code fence line: up to 3 spaces, 3 or more of one of ` and ~, then its info; else null. */
function fenceMarker(line) {
    let start = 0;
    while (start < 3 && line[start] === " ") start++;
    const char = line[start];
    if (char !== "`" && char !== "~") return null;
    let end = start;
    while (line[end] === char) end++;
    const info = line.slice(end);
    if (end - start < 3 || [...info].some(isLineTerminator)) return null;
    return { fence: line.slice(start, end), info };
}

function prose(source) {
    let fence;
    const lists = [];
    return source
        .replaceAll("\r\n", "\n")
        .replace(/<!--[^]*?-->/g, blank)
        .split("\n")
        .map((line) => {
            // Headings and links inside quotes/lists are rendered too. Remove container
            // prefixes before deciding whether indentation denotes a code block.
            while (/^ {0,3}>[ \t]?/.test(line)) line = line.replace(/^ {0,3}>[ \t]?/, "");
            if (line.trim()) {
                const indent = /^ */.exec(line)[0].length;
                while (lists.length && indent < lists.at(-1)) lists.pop();
                const list = /^( *)(?:[-+*]|\d+[.)])[ \t]+(?=\S)/.exec(line);
                if (list && list[1].length <= (lists.at(-1) ?? 0) + 3 && !fence) {
                    lists.push(list[0].length);
                    line = line.slice(list[0].length);
                } else if (lists.length) line = line.slice(lists.at(-1));
            }
            const marker = fenceMarker(line);
            if (fence) {
                const closes =
                    marker?.fence.startsWith(fence[0]) &&
                    marker.fence.length >= fence.length &&
                    !marker.info.trim();
                if (closes) fence = undefined;
                return blank(line);
            }
            if (marker) {
                fence = marker.fence;
                return blank(line);
            }
            return /^( {4}|\t)/.test(line) ? blank(line) : line;
        })
        .join("\n");
}

function entities(text) {
    const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
    return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, key) => {
        if (key[0] !== "#") return named[key.toLowerCase()] ?? whole;
        const point =
            key[1].toLowerCase() === "x" ? Number.parseInt(key.slice(2), 16) : Number(key.slice(1));
        return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "�";
    });
}

/** `text` without HTML tags: each `<` up to the next `>` (as `/<[^>]*>/g`). */
function withoutTags(text) {
    let out = "";
    let from = 0;
    for (;;) {
        const open = text.indexOf("<", from);
        const close = open < 0 ? -1 : text.indexOf(">", open + 1);
        if (close < 0) return out + text.slice(from);
        out += text.slice(from, open);
        from = close + 1;
    }
}

/**
 * `text` with each link `[label]` + `next` … `last` replaced by its label, and with `image`
 * an `!` before it removed too: inline links `[a](b)` (as `/!?\[([^\]]*)\]\([^)]*\)/g`) and
 * full reference links `[a][b]` (as `/\[([^\]]*)\](?:\[[^\]]*\])/g`).
 */
function withoutLinks(text, next, last, image) {
    let out = "";
    let from = 0;
    let open = text.indexOf("[");
    while (open >= 0) {
        const close = text.indexOf("]", open + 1);
        if (close < 0) break;
        // Every `[` before `close` closes there too, and fails the same way.
        if (text[close + 1] !== next) {
            open = text.indexOf("[", close + 1);
            continue;
        }
        const end = text.indexOf(last, close + 2);
        if (end < 0) break;
        const start = image && open > from && text[open - 1] === "!" ? open - 1 : open;
        out += text.slice(from, start) + text.slice(open + 1, close);
        from = end + 1;
        open = text.indexOf("[", from);
    }
    return out + text.slice(from);
}

function headingText(text) {
    const code = [];
    text = text.replace(/(`+)([^]*?)\1/g, (_, marks, value) => {
        code.push(value);
        return `${code.length - 1}`;
    });
    return entities(
        withoutLinks(withoutLinks(withoutTags(text), "(", ")", true), "[", "]", false)
            .replace(/\\([\p{P}\p{S}])/gu, "$1")
            .replace(/[*~`]/g, "")
            .replace(/(?<!\w)_{1,3}|_{1,3}(?!\w)/g, "")
            .replace(/(\d+)/g, (_, index) => code[Number(index)]),
    );
}

/** An ATX heading's text without its closing sequence (as `/[ \t]+#+[ \t]*$/`). */
function withoutClosingHashes(text) {
    let end = text.length;
    while (end > 0 && isSpaceOrTab(text[end - 1])) end--;
    let hashes = end;
    while (hashes > 0 && text[hashes - 1] === "#") hashes--;
    let space = hashes;
    while (space > 0 && isSpaceOrTab(text[space - 1])) space--;
    return hashes < end && space < hashes ? text.slice(0, space) : text;
}

// GitHub's heading rules: lowercase, remove punctuation/symbols except connector
// punctuation and '-', keep alphabetic Unicode, replace each ASCII space with '-'.
// Category rules: github-slugger/script/generate-regex.js.
function slugChar(char) {
    if (char === " ") return "-";
    return char === "-" || /[\p{Alphabetic}\p{M}\p{Nd}\p{Nl}\p{Pc}]/u.test(char) ? char : "";
}

function headingIds(source) {
    const ids = new Set();
    const counts = new Map();
    const lines = prose(source).split("\n");
    for (let i = 0; i < lines.length; i++) {
        const atx = /^ {0,3}#{1,6}(?:[ \t]+(.*)|$)/.exec(lines[i]);
        const setext =
            i + 1 < lines.length && /^ {0,3}(?:=+|-+)\s*$/.test(lines[i + 1]) && lines[i].trim();
        if (!atx && !setext) continue;
        const text = atx ? withoutClosingHashes(atx[1] ?? "").trim() : lines[i].trim();
        if (setext && !atx) i++;
        // Duplicate slugs are collision-aware ("a", "a", "a-1" => "a", "a-1", "a-1-1").
        const base = [...headingText(text).toLowerCase()].map(slugChar).join("");
        let id = base;
        while (counts.has(id)) {
            const next = (counts.get(base) ?? 0) + 1;
            counts.set(base, next);
            id = `${base}-${next}`;
        }
        counts.set(id, 0);
        ids.add(id);
    }
    for (const match of prose(source).matchAll(ID_ATTRIBUTES)) ids.add(entities(match[1]));
    return ids;
}

/** The file a link's path names, from the Markdown file `file`. */
function targetOf(file, path) {
    if (!path) return resolve(root, file);
    const base = path.startsWith("/") ? root : dirname(resolve(root, file));
    return resolve(base, path.replace(/^\//, ""));
}

/** The anchors of a file: heading slugs and IDs of Markdown, else its `id`/`name` attributes. */
function anchorsOf(target) {
    if (!anchors.has(target)) {
        const source = readFileSync(target, "utf8");
        anchors.set(
            target,
            extname(target).toLowerCase() === ".md"
                ? headingIds(source)
                : new Set([...source.matchAll(ID_ATTRIBUTES)].map((match) => entities(match[1]))),
        );
    }
    return anchors.get(target);
}

/** Why a local link does not resolve, or undefined when it does. */
function problemOf(file, link) {
    const hash = link.indexOf("#");
    const path = decodeURIComponent((hash < 0 ? link : link.slice(0, hash)).split("?")[0]);
    const fragment = hash < 0 ? "" : decodeURIComponent(link.slice(hash + 1));
    let target = targetOf(file, path);
    if (!existsSync(target)) return "file does not exist";
    if (statSync(target).isDirectory()) target = resolve(target, "README.md");
    if (!existsSync(target)) return fragment ? "directory has no README for its anchor" : undefined;
    if (!fragment || anchorsOf(target).has(fragment)) return undefined;
    return `anchor #${fragment} does not exist`;
}

function check(file, line, raw) {
    const link = entities(raw.replace(/\\([\p{P}\p{S}])/gu, "$1"));
    if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(link)) return; // Never fetch an external URL.
    let reason;
    try {
        reason = problemOf(file, link);
    } catch (cause) {
        reason = cause.message;
    }
    if (reason) problems.push(`${file}:${line}: ${raw} — ${reason}`);
}

// Read a Markdown destination, including <paths with spaces> or balanced parentheses.
function destination(text, start) {
    let i = start;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] === "<") {
        const end = text.indexOf(">", i + 1);
        return end < 0 ? undefined : { value: text.slice(i + 1, end), end: end + 1 };
    }
    return bareDestination(text, i);
}

function bareDestination(text, begin) {
    let depth = 0;
    let i = begin;
    for (; i < text.length; i++) {
        const char = text[i];
        if (char === "\\") {
            i++;
            continue;
        }
        if (char === ")" && depth === 0) break;
        if (char === "(") depth++;
        else if (char === ")") depth--;
        else if (depth === 0 && /\s/.test(char)) break;
    }
    return { value: text.slice(begin, i), end: i };
}

/** The first line start at or after `from` (as `^` with the `m` flag). */
function lineStart(source, from) {
    let i = from;
    while (i > 0 && i < source.length && !isLineTerminator(source[i - 1])) i++;
    return i;
}

/**
 * The link reference definition `[label]: rest` at line start `at`, as
 * `/^ {0,3}\[([^\]]+)\]:\s*(.*)$/gm` reads it (the label and the space after the colon may
 * span lines): `{ label, rest, end }`; else `{ resume }`, the next line start that can hold one;
 * else null when no later line can.
 */
function definitionAt(source, at) {
    let open = at;
    while (open < at + 3 && source[open] === " ") open++;
    if (source[open] !== "[") return { resume: lineStart(source, at + 1) };
    const close = source.indexOf("]", open + 1);
    if (close < 0) return null;
    // A line between `at` and `close` closes its label there too, and fails the same way.
    if (close === open + 1) return { resume: lineStart(source, at + 1) };
    if (source[close + 1] !== ":") return { resume: lineStart(source, close + 1) };
    let rest = close + 2;
    while (rest < source.length && /\s/.test(source[rest])) rest++;
    let end = rest;
    while (end < source.length && !isLineTerminator(source[end])) end++;
    return { label: source.slice(open + 1, close), rest: source.slice(rest, end), end };
}

/** `source` with each reference definition blanked, after `found(label, rest, offset)`. */
function blankDefinitions(source, found) {
    let out = "";
    let from = 0;
    let at = 0;
    while (at <= source.length) {
        const definition = definitionAt(source, at);
        if (!definition) break;
        if (definition.end === undefined) {
            at = definition.resume;
            continue;
        }
        found(definition.label, definition.rest, at);
        out += source.slice(from, at) + blank(source.slice(at, definition.end));
        from = definition.end;
        at = lineStart(source, definition.end + 1);
    }
    return out + source.slice(from);
}

/**
 * Where a link label that opens at `from` - 1 closes, or -1: escapes, characters other than
 * brackets, and nested `[…]` groups, up to `]` (as `((?:\\.|[^[\]\\]|\[[^\]]*\])*)\]`).
 */
function labelEnd(text, from) {
    let i = from;
    while (i < text.length) {
        const char = text[i];
        if (char === "]") return i;
        if (char === "[") {
            const inner = text.indexOf("]", i + 1);
            if (inner < 0) return -1;
            i = inner + 1;
        } else if (char === "\\") {
            if (i + 1 >= text.length || isLineTerminator(text[i + 1])) return -1;
            i += 2;
        } else i++;
    }
    return -1;
}

/**
 * Inline links, images, full/collapsed reference links and defined shortcut links: each
 * bracketed label not after a backslash, as `/(?<!\\)!?\[(…)\]/g` finds them.
 */
function* labels(content) {
    let open = content.indexOf("[");
    while (open >= 0) {
        const close = open > 0 && content[open - 1] === "\\" ? -1 : labelEnd(content, open + 1);
        if (close < 0) {
            open = content.indexOf("[", open + 1);
            continue;
        }
        yield { index: open, end: close + 1, label: content.slice(open + 1, close) };
        open = content.indexOf("[", close + 1);
    }
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

for (const file of files) {
    const source = prose(readFileSync(resolve(root, file), "utf8"));
    const references = new Map();
    const key = (label) => label.replace(/\s+/g, " ").trim().toLowerCase();
    const content = blankDefinitions(source, (label, rest, offset) => {
        const target = destination(rest, 0);
        if (!target) return;
        if (!references.has(key(label))) references.set(key(label), target.value);
        check(file, lineOf(source, offset), target.value);
    }).replace(/(`+)([^]*?)\1/g, blank);
    for (const match of labels(content)) {
        const line = lineOf(content, match.index);
        if (content[match.end] === "(") {
            const target = destination(content, match.end + 1);
            if (target) check(file, line, target.value);
        } else {
            const reference = /^\[([^\]]*)\]/.exec(content.slice(match.end));
            const target = references.get(key(reference?.[1] || match.label));
            if (target !== undefined) check(file, line, target);
        }
    }
    for (const match of content.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
        check(file, lineOf(content, match.index), match[1]);
    }
}

if (problems.length) {
    problems.forEach((problem) => error(problem));
    process.exitCode = 1;
} else log(`Links OK: ${files.length} tracked Markdown files`);
