import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { writeZip } from "../../src/core/codec";

// A `.ngsprite` test fixture kept unpacked: the folder `<name>.ngsprite.d/` holds the entries of
// the archive as files. JSON entries carry a `.golden` ending, as the export goldens do, so that
// Prettier leaves their bytes alone. A `<entry>.trailer` file holds bytes the entry carries after
// its own end (a PNG with data after IEND). `packNgsprite` zips the folder with the project's
// writer: `manifest.json` first, then `doc.json`, then the other entries by name; PNG entries
// stored, the rest deflated, as the sprite editor writes them.

const FIRST = ["manifest.json", "doc.json"];

/** The `.ngsprite` archive of the unpacked fixture folder `folder` (a URL ending in `/`). */
export function packNgsprite(folder: URL): Uint8Array<ArrayBuffer> {
    const root = fileURLToPath(folder);
    const files = readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"));
    const read = (file: string) => new Uint8Array(readFileSync(join(root, file)));
    const entries = files
        .filter((file) => !file.endsWith(".trailer"))
        .map((file) => {
            const name = file.replace(/\.golden$/, "");
            const trailer = files.includes(`${file}.trailer`) ? read(`${file}.trailer`) : undefined;
            const data = trailer === undefined ? read(file) : append(read(file), trailer);
            return { name, data, stored: name.endsWith(".png") };
        });
    entries.sort((a, b) => rank(a.name) - rank(b.name) || compare(a.name, b.name));
    return writeZip(entries);
}

function rank(name: string): number {
    const index = FIRST.indexOf(name);
    return index < 0 ? FIRST.length : index;
}

function compare(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

function append(bytes: Uint8Array, tail: Uint8Array): Uint8Array {
    const out = new Uint8Array(bytes.length + tail.length);
    out.set(bytes);
    out.set(tail, bytes.length);
    return out;
}
