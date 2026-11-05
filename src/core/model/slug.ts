import { MAX_SLUG_LENGTH } from "./limits";
import type { Project } from "./types";

// Slugs of FORMAT §1.1: export names of maps, tilesets and images, which name files in one
// export folder and asset IDs in the generated runtime. The rules follow the sprite editor's
// `core/sprite/export/names.ts` (Tiled has no export names): ASCII lowering only, no
// transliteration, every run of other characters one `-`; here `_` is kept, as the pattern
// allows it.

/** The one slug no export name may be: the runtime's own file (FORMAT §1.1). */
export const RESERVED_SLUG = "ngne-tilemap";

/** Base names Windows keeps for devices, whatever the extension: `con.png` cannot be written. */
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/;

const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** Whether `value` is a slug: 1 to 64 characters of `[a-z0-9][a-z0-9_-]*`, not reserved. */
export function isSlug(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length <= MAX_SLUG_LENGTH &&
        SLUG_PATTERN.test(value) &&
        value !== RESERVED_SLUG
    );
}

/** A text with its letters A–Z as a–z and no other character changed. */
function lowerAscii(text: string): string {
    return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/**
 * The slug of a name, or `fallback` when nothing of the name is left: A–Z lowered, every run
 * of characters other than `a-z`, `0-9` and `_` one `-`, no `-` or `_` at the start, no `-`
 * at the end, cut to 64 characters. A Windows device name (`con`, `lpt1`, …) gets
 * `-<fallback>` appended, as the sprite editor does, so `<slug>.<ext>` is writable there. The
 * result is unique against nothing; see `uniqueSlug`.
 */
export function slugify(name: string, fallback = "untitled"): string {
    const slug = lowerAscii(name)
        .replace(/[^a-z0-9_]+/g, "-")
        .replace(/^[-_]+|-+$/g, "")
        .slice(0, MAX_SLUG_LENGTH)
        .replace(/-+$/, "");
    if (slug === "") return fallback;
    return DEVICE_NAME.test(slug) ? `${slug}-${fallback}` : slug;
}

/**
 * A slug made from `name` that is none of `taken` (compared after ASCII lowering) and not
 * reserved: the slug itself, else the slug with `-2`, `-3`, … appended, cut so the suffix
 * fits in 64 characters. `taken` holds the project's export names, the ones of `exportNames`.
 */
export function uniqueSlug(name: string, taken: Iterable<string>, fallback = "untitled"): string {
    const used = new Set<string>();
    for (const slug of taken) used.add(lowerAscii(slug));
    const base = slugify(name, fallback);
    if (base !== RESERVED_SLUG && !used.has(base)) return base;
    for (let n = 2; ; n += 1) {
        const suffix = `-${n}`;
        const stem = base.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/, "");
        const candidate = `${stem}${suffix}`;
        if (!used.has(candidate)) return candidate;
    }
}

/** Every export name of the project: its maps, tilesets and images (FORMAT §2.4). */
export function exportNames(project: Project): string[] {
    return [
        ...project.maps.map((map) => map.exportName),
        ...project.tilesets.map((tileset) => tileset.exportName),
        ...project.images.map((image) => image.exportName),
    ];
}
