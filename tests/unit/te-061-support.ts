import { readFileSync, readdirSync } from "node:fs";
import { sequentialIds } from "../../src/core/model";
import type { Project } from "../../src/core/model";
import { TmjError, importTmj, tmjRequiredFiles } from "../../src/core/tmj";
import type { TmjFiles, TmjImport, TmjImportReport, TmjRequiredFile } from "../../src/core/tmj";
import { emptyProject } from "./te-022-support";

// Shared by the TE-061 unit tests: the TMJ fixtures of TE-058 read from their folder, imported
// as the dialog imports them, and the golden report of each (tests/fixtures/tmj-reports).

export const FIXTURES = new URL("../fixtures/tmj/", import.meta.url);
export const GOLDENS = new URL("../fixtures/tmj-reports/", import.meta.url);

/** The maps of the fixture folder, by file name. */
export function fixtureMaps(): string[] {
    return readdirSync(FIXTURES)
        .filter((name) => name.endsWith(".tmj"))
        .sort();
}

function read(path: string): Buffer | undefined {
    try {
        return readFileSync(new URL(path, FIXTURES));
    } catch {
        return undefined;
    }
}

/** The fixture folder as the import reads it, without the paths of `missing`. */
export function fixtureFiles(missing: readonly string[] = []): TmjFiles {
    const gone = new Set(missing);
    return {
        text: (path) => (gone.has(path) ? undefined : read(path)?.toString("utf8")),
        bytes: (path) => {
            const bytes = gone.has(path) ? undefined : read(path);
            return bytes === undefined ? undefined : new Uint8Array(bytes);
        },
    };
}

export const fixtureText = (name: string): string => read(name)!.toString("utf8");

/** What a fixture's golden holds: the files it needs, then its report or its refusal. */
export type GoldenReport = {
    readonly fixture: string;
    readonly files: readonly TmjRequiredFile[];
} & ({ readonly refused: { readonly code: string; readonly message: string } } | TmjImportReport);

/**
 * Imports fixture `name` into `project` (an empty one by default), IDs numbered after `prefix`
 * (a second import into one project takes another).
 */
export function importFixture(
    name: string,
    project: Project = emptyProject(),
    files: TmjFiles = fixtureFiles(),
    prefix = "i",
): Promise<TmjImport> {
    return importTmj(project, fixtureText(name), {
        fileName: name,
        files,
        newId: sequentialIds(prefix),
    });
}

/** The report of fixture `name` as its golden holds it. */
export async function fixtureReport(name: string): Promise<GoldenReport> {
    const files = tmjRequiredFiles(fixtureText(name), fixtureFiles());
    try {
        const { report } = await importFixture(name);
        return { fixture: name, files, ...report };
    } catch (error) {
        if (!(error instanceof TmjError)) throw error;
        return { fixture: name, files, refused: { code: error.code, message: error.message } };
    }
}

export const goldenName = (fixture: string): string => fixture.replace(/\.tmj$/, ".report.json");

/** A golden as its file holds it: JSON with four-space indents and a final newline. */
export const goldenText = (report: GoldenReport): string => `${JSON.stringify(report, null, 4)}\n`;
