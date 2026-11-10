import { useMemo, useSyncExternalStore } from "react";
import { appCommands } from "../../app/commands/appCommands";
import type { CommandRegistry } from "../../app/commands/registry";
import type { Command } from "../../app/commands/types";
import { createCommandTracker } from "./commandTracker";

/**
 * The commands of a registry. The component renders again when a command is added or removed
 * and when a command whose `enabled` or `title` it called gives another value, so it calls
 * those functions while rendering. A refresh that changes nothing it read does not render it:
 * each refresh of the app's registry (a stroke, a file operation starting or ending) would
 * otherwise render every panel that lists commands.
 */
export function useCommands(registry: CommandRegistry = appCommands): readonly Command[] {
    const tracker = useMemo(() => createCommandTracker(registry), [registry]);
    useSyncExternalStore(registry.subscribe, tracker.snapshot);
    return tracker.commands();
}
