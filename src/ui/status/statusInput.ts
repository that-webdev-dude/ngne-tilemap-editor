import type { StatusField as PackageStatusField } from "@ngne/editor-ui/shell";
import type { ProjectMap, ProjectSession } from "../../core/model";

// What this editor's status fields read (DESIGN §8.7). A feature adds a field by creating a
// module named `*.status.ts` anywhere under `src` that exports `statusFields`; `editorUi.ts`
// finds it with a glob import, so no shared file is edited (RULES 6):
//
//     // src/ui/status/selection.status.ts
//     export const statusFields: StatusField[] = [
//         { id: "selection", order: 500, text: ({ map }) => "…" },
//     ];
//
// Fields are shown left to right in ascending `order`; the message (tool hint or transient
// feedback) sits at the right end and is not a field (`statusSource.ts`).

/** What a field reads: the project's session and the transient status values. */
export interface StatusFieldInput {
    session: ProjectSession;
    /** The active map; null while the project has none. */
    map: ProjectMap | null;
    /** The cell under the pointer; null while the pointer is not over the map. */
    cursor: { x: number; y: number } | null;
}

/** A field of the status bar, reading `StatusFieldInput`. */
export type StatusField = PackageStatusField<StatusFieldInput>;
