// Declares `import.meta.glob` wherever this module is compiled.
import type {} from "../../import-meta";
import { createToolRegistry, registerToolModules } from "@ngne/editor-ui/shell";
import { withoutToolKeys } from "./toolKeys";
import type { ToolModule, ToolRegistry, ToolSpec } from "./types";

/**
 * The tool registry the app's own modules read (the active-tool store, the tool keys, the
 * pointer pipeline): every module named `*.tools.ts` or `*.tools.tsx` under `src`, by the same
 * glob `src/app/editorUi.ts` passes to `createEditorUi`, whose registry draws the rail. The
 * instance builds its registry only after the command modules are evaluated, and
 * `tools.commands.ts` makes a command per tool while it is evaluated, so the app keeps this
 * catalogue of the same modules beside the instance's. A feature adds a tool — its rail
 * button, key, options and behaviour — without an edit to a shared file (RULES 6):
 *
 *     // src/app/tools/pencil/pencil.tools.ts
 *     export const tools: ToolSpec[] = [
 *         { id: "pencil", label: "Pencil", paints: true, options: [...], onDown, onMove },
 *     ];
 *
 * A tool module is evaluated while this one loads: it may import the types, but must not use
 * the registry before a stroke.
 */
export const toolRegistry: ToolRegistry = createToolRegistry<ToolSpec>();

const modules = import.meta.glob<ToolModule>("../../**/*.tools.{ts,tsx}", { eager: true });

/** The discovered tool modules, by their path from this file. */
export const toolModulePaths: readonly string[] = Object.keys(modules).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
);

// Without their keys, which the package's registry would refuse where tool sets share them.
registerToolModules(toolRegistry, withoutToolKeys(modules));
