// Declares `import.meta.glob` wherever this module is compiled.
import type {} from "../../import-meta";
import {
    createToolRegistry as createPackageToolRegistry,
    registerToolModules,
} from "@ngne/editor-ui/shell";
import type { ToolModule, ToolRegistry, ToolSpec } from "./types";

/** An empty registry of this editor's tools, on the package's factory. */
export function createToolRegistry(): ToolRegistry {
    return createPackageToolRegistry<ToolSpec>();
}

/**
 * The editor's tool registry: every module named `*.tools.ts` or `*.tools.tsx` under `src`.
 * It is the editor UI instance's (`sources.tools`, @ngne/editor-ui SPEC §5), so the rail, the
 * context bar, the active-tool store, the tool keys and the pointer pipeline read the same
 * tools. It imports no instance: `tools.commands.ts` makes a command per tool while the
 * instance loads the command modules. A feature adds a tool — its rail button, key, options and
 * behaviour — without an edit to a shared file (RULES 6):
 *
 *     // src/app/tools/pencil/pencil.tools.ts
 *     export const tools: ToolSpec[] = [
 *         { id: "pencil", label: "Pencil", paints: true, options: [...], onDown, onMove },
 *     ];
 *
 * A tool module is evaluated while this one loads: it may import the types, but must not use
 * the registry before a stroke.
 */
export const toolRegistry: ToolRegistry = createToolRegistry();

const modules = import.meta.glob<ToolModule>("../../**/*.tools.{ts,tsx}", { eager: true });

/** Orders two paths by their UTF-16 code units. */
function byCodeUnits(a: string, b: string): number {
    if (a < b) return -1;
    return a > b ? 1 : 0;
}

/** The discovered tool modules, by their path from this file. */
export const toolModulePaths: readonly string[] = Object.keys(modules).sort(byCodeUnits);

registerToolModules(toolRegistry, modules);
