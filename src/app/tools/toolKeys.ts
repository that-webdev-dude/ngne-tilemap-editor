import type { PlannedToolSpec, Tool, ToolModule, ToolSpec } from "./types";

// The keys of the tools (DESIGN §10.3), kept by the app. The tool sets of the layer kinds share
// letters (DESIGN §10.2: U is the shape fill of a tile layer and the rectangle of a marker
// layer), and the package's tool registry refuses a key two tools or planned slots use. Until
// it takes keys per tool set, the tool modules reach the registries without their keys
// (`withoutToolKeys`), and the tool commands and the active-tool store read them here
// (`toolKey`): as the registry resolved them, a tool's own key, else its planned slot's.

/** The key each tool module gives a tool, by tool id. */
const ownKeys = new Map<string, string>();
/** The key of each planned rail slot, by slot id. */
const plannedKeys = new Map<string, string>();

function withoutKey<Spec extends ToolSpec | PlannedToolSpec>(
    spec: Spec,
    keys: Map<string, string>,
): Spec {
    if (spec.shortcut === undefined) return spec;
    keys.set(spec.id, spec.shortcut);
    const copy = { ...spec };
    delete copy.shortcut;
    return copy;
}

/** `modules` with every tool's and planned slot's key taken out and kept for `toolKey`. */
export function withoutToolKeys(
    modules: Readonly<Record<string, ToolModule>>,
): Record<string, ToolModule> {
    return Object.fromEntries(
        Object.entries(modules).map(([path, module]) => [
            path,
            {
                ...module,
                ...(module.tools && {
                    tools: module.tools.map((spec) => withoutKey(spec, ownKeys)),
                }),
                ...(module.plannedTools && {
                    plannedTools: module.plannedTools.map((spec) => withoutKey(spec, plannedKeys)),
                }),
            },
        ]),
    );
}

/** The key that selects `tool`: its own, else the one of the planned slot of its id. */
export function toolKey(tool: Pick<Tool, "id" | "shortcut">): string | undefined {
    return tool.shortcut ?? ownKeys.get(tool.id) ?? plannedKeys.get(tool.id);
}
