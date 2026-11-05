// Declares `import.meta.glob` wherever this module is compiled.
import type {} from "../../import-meta";
import type { ProjectMap, ProjectSession } from "../../core/model";

/**
 * Status bar field registry (DESIGN §8.7, TE-014). A feature adds a field by creating a module
 * named `*.status.ts` anywhere under `src` that exports `statusFields`; this file finds it
 * with a glob import, so no shared file is edited (RULES 6):
 *
 *     // src/ui/status/selection.status.ts
 *     export const statusFields: StatusField[] = [
 *         { id: "selection", order: 500, text: ({ map }) => "…" },
 *     ];
 *
 * Fields are shown left to right in ascending `order`; the message (tool hint or transient
 * feedback) sits at the right end and is not a field.
 */

/** What a field reads: the project's session and the transient status values. */
export interface StatusFieldInput {
    session: ProjectSession;
    /** The active map; null while the project has none. */
    map: ProjectMap | null;
    /** The cell under the pointer; null while the pointer is not over the map. */
    cursor: { x: number; y: number } | null;
}

export interface StatusField {
    /** Stable and unique: "cell"; also the `data-status` attribute of the field. */
    id: string;
    /** Position, ascending, left to right. TE-014 uses 100 to 400. */
    order: number;
    /** The text of the field; the empty string shows nothing. */
    text(input: StatusFieldInput): string;
    /**
     * The width in characters the field keeps while it has no text, so the fields after it do
     * not move when the pointer leaves the map. Without it an empty field is not rendered.
     */
    reserve?: number;
    /** A command shown as a quiet button right after the text ("Fit" after the zoom). */
    action?: { commandId: string };
    /**
     * For a field that also reads a store of its own feature (the Tilesets panel's hovered
     * tile): subscribes `listener` to it, returning the function that stops it. The bar
     * redraws on every call.
     */
    subscribe?(listener: () => void): () => void;
}

/** What a `*.status.ts` module exports. */
export interface StatusFieldModule {
    statusFields?: readonly StatusField[];
}

/** Thrown when the discovered fields cannot form one bar; the message names the module. */
export class StatusFieldError extends Error {
    override readonly name = "StatusFieldError";
}

/** Validates the discovered modules and returns their fields in display order. */
export function collectStatusFields(modules: Record<string, StatusFieldModule>): StatusField[] {
    const seen = new Map<string, string>();
    const fields: StatusField[] = [];
    for (const [path, module] of Object.entries(modules)) {
        const exported = module.statusFields;
        if (!Array.isArray(exported)) {
            throw new StatusFieldError(`${path} does not export "statusFields".`);
        }
        for (const field of exported as readonly StatusField[]) {
            if (typeof field.id !== "string" || field.id.trim() === "") {
                throw new StatusFieldError(`A field of ${path} has no id.`);
            }
            const first = seen.get(field.id);
            if (first !== undefined) {
                throw new StatusFieldError(
                    `Status field id "${field.id}" is used by ${first} and ${path}.`,
                );
            }
            if (!Number.isFinite(field.order)) {
                throw new StatusFieldError(`Status field "${field.id}" (${path}) has no order.`);
            }
            seen.set(field.id, path);
            fields.push(field);
        }
    }
    return fields.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Every status field of the app, left to right. */
export const statusFields: readonly StatusField[] = collectStatusFields(
    import.meta.glob<StatusFieldModule>("../../**/*.status.{ts,tsx}", { eager: true }),
);
