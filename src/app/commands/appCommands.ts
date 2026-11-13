// Declares `import.meta.glob` wherever this module is compiled.
import type {} from "../../import-meta";
import { keyContextStore } from "../keymap/contextState";
import { projectOpen, sessionStore } from "../state/session";
import { createCommandRegistry, registerCommandModules } from "./registry";
import type { CommandRegistry } from "./registry";
import type { CommandModule, CommandSpec } from "./types";

/**
 * The commands that act while no project is open (the empty state, TE-047): those that open
 * or create one, and those of the window itself (command palette, shortcut sheet,
 * preferences, regions, bottom panel). Every other command is disabled until a project opens,
 * whatever its own `enabled` says: it acts on a project.
 */
const WITHOUT_PROJECT =
    /^(file\.(newProject|open|openRecent\..+|clearRecent|importTiledMap)|edit\.(commandPalette|shortcuts|preferences)|focus\.(nextRegion|previousRegion)|view\.bottomPanel)$/;

/** `registry`, whose commands outside `WITHOUT_PROJECT` are enabled only with a project open. */
function withProjectGate(registry: CommandRegistry): CommandRegistry {
    const gate = (spec: CommandSpec): CommandSpec => {
        if (WITHOUT_PROJECT.test(spec.id)) return spec;
        const { enabled } = spec;
        return { ...spec, enabled: () => projectOpen() && (enabled ? enabled() : true) };
    };
    return { ...registry, register: (spec, source) => registry.register(gate(spec), source) };
}

/**
 * The command registry of the app. It holds what every module named `*.commands.ts` or
 * `*.commands.tsx` under `src` exports as `commands` (and `plannedCommands`); the glob import
 * finds those modules, so a feature adds its commands, shortcuts and menu items without an
 * edit to a shared file (RULES 6). See `CommandSpec` in types.ts.
 *
 * A command module is evaluated while this one loads: it may import the registry, but must
 * not use it before a command runs.
 */
export const appCommands: CommandRegistry = withProjectGate(createCommandRegistry());

const modules = import.meta.glob<CommandModule>("../../**/*.commands.{ts,tsx}", { eager: true });

/** The discovered command modules, by their path from this file. */
export const commandModulePaths: readonly string[] = Object.keys(modules).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
);

registerCommandModules(appCommands, modules);

// `enabled` and `title` functions read these stores; an open menu follows their changes. A
// feature whose commands depend on a store of its own calls `appCommands.refresh()` from it.
sessionStore.subscribe(() => appCommands.refresh());
keyContextStore.subscribe(() => appCommands.refresh());
