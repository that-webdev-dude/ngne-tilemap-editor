import { refreshCommands } from "../uiState";
import type { CommandSpec } from "../commands/commandTypes";
import { subscribeTilesetWorkflow } from "./tilesetWorkflow";

// No command of its own: the commands that wait for a tileset file operation to end read
// `tilesetWorkflowBusy()` in their `enabled`, and an open menu is told when it changes.
export const commands: CommandSpec[] = [];

subscribeTilesetWorkflow(() => refreshCommands());
