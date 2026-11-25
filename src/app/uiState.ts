import { createCommandRunner } from "@ngne/editor-ui/commands";
import type { CommandRefreshSource } from "@ngne/editor-ui";

// The editor UI instance's state that the app creates itself (`sources`, @ngne/editor-ui SPEC
// §5), beside the key contexts (`keymap/contextState.ts`) and the tool registry
// (`tools/toolRegistry.ts`). This module imports no instance: the command, dialog, dock and
// other modules the instance's globs load, and the components they render, run commands and
// refresh them through it without importing `src/app/editorUi.ts`, which loads them first.

/** Runs a command of the instance (`commandRunner.run(id)`, as `runCommand`). */
export const commandRunner = createCommandRunner();

const refreshListeners = new Set<() => void>();

/**
 * One of the instance's `refreshOn` sources: a feature whose commands' `enabled` or `title`
 * read a store of its own calls `refreshCommands()` when that store changes, and an open menu
 * follows.
 */
export const commandRefresh: CommandRefreshSource = {
    subscribe(listener) {
        refreshListeners.add(listener);
        return () => {
            refreshListeners.delete(listener);
        };
    },
};

/** Refreshes the instance's commands: their enabled states and titles may have changed. */
export function refreshCommands(): void {
    for (const listener of [...refreshListeners]) listener();
}
