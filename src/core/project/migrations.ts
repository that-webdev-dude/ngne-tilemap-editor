import { ProjectError } from "./errors";
import { MANIFEST_ENTRY, PROJECT_VERSION } from "./format";

// Versions and migrations (FORMAT §2.10): a reader of version N reads 1 to N, migrating each
// parsed JSON entry one version at a time, then checks the result as version N. `project.json`
// is migrated before it is checked (§2.9 step 3), each map before it is checked (step 4).

/**
 * Rewrites the parsed JSON entries of one version into those of the next. Each step is given
 * values nothing has checked yet, so it reads defensively and throws `ProjectError` for what it
 * cannot rewrite; the result is checked as the newest version.
 */
export interface Migration {
    project(json: unknown): unknown;
    map(json: unknown): unknown;
}

/** Version 1 is the first: reading it as version 1 changes nothing. */
const identity: Migration = { project: (json) => json, map: (json) => json };

/**
 * One step per version: the one at index n − 1 brings version n to the newest version's
 * shape one step further. The last one is the identity step of `PROJECT_VERSION`.
 */
export const MIGRATIONS: readonly Migration[] = [identity];

/**
 * Throws `ProjectError` unless `version` is a version from 1 to `newest`: "newer-version" for a
 * later one, naming both, "invalid-manifest" for anything that is not a version number.
 */
export function assertReadableVersion(
    version: unknown,
    newest: number = PROJECT_VERSION,
): asserts version is number {
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
        const got = typeof version === "number" ? String(version) : typeof version;
        throw new ProjectError(
            "invalid-manifest",
            `${MANIFEST_ENTRY}: \`version\` must be an integer of at least 1, got ${got}.`,
            { entry: MANIFEST_ENTRY },
        );
    }
    if (version > newest) {
        throw new ProjectError(
            "newer-version",
            `The project has version ${version}, and this version of the editor reads up to ` +
                `version ${newest}. Open it with a newer version of the editor.`,
            { entry: MANIFEST_ENTRY },
        );
    }
}

/**
 * A parsed entry of version `version` in the shape of the newest version: the steps from that
 * version on, applied in order. `migrations` is `MIGRATIONS` outside tests.
 */
export function migrate(
    kind: keyof Migration,
    json: unknown,
    version: number,
    migrations: readonly Migration[] = MIGRATIONS,
): unknown {
    assertReadableVersion(version, migrations.length);
    let migrated = json;
    for (let step = version; step <= migrations.length; step++) {
        migrated = migrations[step - 1]![kind](migrated);
    }
    return migrated;
}
