import { GENERATOR } from "../generator";
import type { Project } from "../model";
import { encodeJson, parseJson } from "../project/json";

// The marker of an export folder (FORMAT §5): `ngne-tilemap.export.json` names the project that
// exports into the folder, so another project's export asks before it replaces anything there.

/** The marker's file name. */
export const EXPORT_MARKER_FILE = "ngne-tilemap.export.json";
export const EXPORT_MARKER_FORMAT = "ngne-tilemap-export";
export const EXPORT_MARKER_VERSION = 1;

/** What a marker says: the project that owns the folder. */
export interface ExportMarker {
    projectId: string;
    projectName: string;
}

/** The marker of `project`: four-space JSON with a line feed at the end. */
export function exportMarkerBytes(project: Pick<Project, "id" | "name">): Uint8Array<ArrayBuffer> {
    return encodeJson({
        format: EXPORT_MARKER_FORMAT,
        version: EXPORT_MARKER_VERSION,
        generator: GENERATOR,
        projectId: project.id,
        projectName: project.name,
    });
}

/**
 * The project a marker names, or null when the bytes are no marker of version 1: not JSON, not
 * an object, another `format` or `version`, or `projectId` or `projectName` not text. A folder
 * whose marker reads as null is no project's folder (FORMAT §5).
 */
export function readExportMarker(bytes: Uint8Array): ExportMarker | null {
    let value: unknown;
    try {
        value = parseJson(bytes, EXPORT_MARKER_FILE);
    } catch {
        return null;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const { format, version, projectId, projectName } = value as Record<string, unknown>;
    if (format !== EXPORT_MARKER_FORMAT || version !== EXPORT_MARKER_VERSION) return null;
    if (typeof projectId !== "string" || projectId === "") return null;
    if (typeof projectName !== "string") return null;
    return { projectId, projectName };
}
