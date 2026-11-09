import { MANIFEST_ENTRY, PROJECT_FORMAT, PROJECT_GENERATOR, PROJECT_VERSION } from "./format";
import { JsonReader } from "./json";
import { assertReadableVersion } from "./migrations";

/** `manifest.json` (FORMAT §2.3). */
export interface ProjectManifest {
    format: typeof PROJECT_FORMAT;
    version: number;
    generator: string;
}

// The annotation lets the compiler see that `reader.fail` never returns.
const reader: JsonReader = new JsonReader("invalid-manifest", MANIFEST_ENTRY);

/** The `manifest.json` this writer writes, members in the order of the table. */
export function projectManifest(): ProjectManifest {
    return { format: PROJECT_FORMAT, version: PROJECT_VERSION, generator: PROJECT_GENERATOR };
}

/**
 * Checks a parsed `manifest.json`. `format` and `version` are read first and alone, as every
 * version keeps them, so a project of a newer version is refused naming both versions without
 * reading further; the other members are then those of the version found.
 *
 * Throws `ProjectError`: "invalid-manifest", or "newer-version".
 */
export function readManifest(value: unknown): ProjectManifest {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        reader.fail("", "must be an object");
    }
    const { format, version } = value as Record<string, unknown>;
    if (format !== PROJECT_FORMAT) {
        reader.fail("format", `must be "${PROJECT_FORMAT}": the file is not a tilemap project`);
    }
    assertReadableVersion(version);
    const members = reader.object(value, "", ["format", "version", "generator"]);
    return { format, version, generator: reader.text(members.generator, "generator") };
}
