import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TE-002: upstream drift of the verbatim copies (SUITE §6). For every verbatim row of
// docs/PROVENANCE.md, reports whether its file in the local sprite editor checkout differs
// from the recorded commit: a later commit or an uncommitted change. A row whose source is
// missing at its commit, or hashes there to another SHA-256, is reported as wrong. Exits 1
// when any row is changed or wrong.
// Not part of `npm run check` (CI has no `se/` checkout).
//
//     npm run drift [-- se-path]
//
// `se-path` defaults to `../ngne-sprite-editor` (SUITE §1). Node 24 runs the TypeScript
// directly; this file imports nothing relative for that reason.

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const se = resolve(ROOT, process.argv[2] ?? "../ngne-sprite-editor");

interface Row {
    path: string;
    source: string;
    commit: string;
    sha256: string;
}

const rows: Row[] = readFileSync(`${ROOT}docs/PROVENANCE.md`, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("| `"))
    .map((line) => line.split("|").map((cell) => cell.trim().replaceAll("`", "")))
    .filter((cells) => cells[3] === "verbatim")
    .map((cells) => ({ path: cells[1]!, source: cells[2]!, commit: cells[4]!, sha256: cells[5]! }));

/** Whether the row's source exists at its commit with the recorded SHA-256. */
function recorded(row: Row): boolean {
    try {
        const blob = execFileSync(
            "git",
            ["-C", se, "cat-file", "blob", `${row.commit}:${row.source}`],
            {
                stdio: ["ignore", "pipe", "ignore"],
                maxBuffer: 64 << 20,
            },
        );
        return createHash("sha256").update(blob).digest("hex") === row.sha256;
    } catch {
        return false;
    }
}

// One diff per recorded commit, against the working tree, so uncommitted edits count too.
const changed = new Map<string, string>();
for (const commit of new Set(rows.map((row) => row.commit))) {
    const sources = rows.filter((row) => row.commit === commit).map((row) => row.source);
    const out = execFileSync("git", ["-C", se, "diff", "--name-status", commit, "--", ...sources]);
    for (const line of out.toString("utf8").split("\n").filter(Boolean)) {
        const [status, path] = line.split("\t");
        changed.set(`${commit}:${path}`, status === "D" ? "deleted" : "changed");
    }
}

let drifted = 0;
for (const row of rows) {
    const state = recorded(row) ? changed.get(`${row.commit}:${row.source}`) : "wrong row";
    if (state) drifted += 1;
    console.log(`${state ?? "unchanged"}  ${row.source}  (${row.commit}) -> ${row.path}`);
}
const head = execFileSync("git", ["-C", se, "rev-parse", "--short", "HEAD"]).toString().trim();
console.log(`${rows.length} verbatim rows, ${drifted} changed or wrong in ${se} at ${head}`);
process.exitCode = drifted > 0 ? 1 : 0;
