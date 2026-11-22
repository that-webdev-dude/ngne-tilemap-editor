import { editorUi } from "../../../src/app/editorUi";

// What the E2E specs load inside the app's page from modules the editor's copies were before
// it moved onto @ngne/editor-ui: the package's exports, and the parts of the editor UI
// instance (`src/app/editorUi.ts`) that took the place of the app's own surfaces and dialog
// registry. The page loads this module by its URL, `/tests/e2e/harness/pageModules.ts`, so it
// shares the app's instances.

export { formatChord } from "@ngne/editor-ui/commands";
export { commandDialogs, toast } from "@ngne/editor-ui/messages";
export { STORAGE_WRITE_FAILED_MESSAGE } from "@ngne/editor-ui/platform";

/** The app's surfaces: the package's and Preferences. */
export const surfaces = editorUi.surfaces;

/** The ids of the app's surfaces. */
export const SURFACE_IDS = editorUi.surfaces.ids;

/** The app's dialogs by request kind: the package's and the `*.dialog.tsx` modules'. */
export const registeredDialogs = editorUi.dialogs;
