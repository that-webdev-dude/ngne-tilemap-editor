import { appCommands } from "../commands/appCommands";
import type { CommandSpec } from "../commands/types";
import { projectOpen } from "../state/session";
import { fileWorkflows } from "./workflows";

// The file commands of SPEC §10.1 (the sprite editor's SE-041, on the window's one project).
// They take the File menu items planned for their ids (commands/planned.commands.ts). DESIGN
// §10.3: Ctrl+Alt+N, Ctrl+O, Ctrl+S and Ctrl+Shift+S are marked †, so they also act while a
// text field has focus. Each waits while another file operation runs, during a stroke and while
// a tileset is imported or updated. New Project and Open act on the empty state too.

const TEXT_TOO: CommandSpec["context"] = ["global", "text"];

/** No file operation runs and nothing keeps the project from being taken or saved. */
const idle = () => fileWorkflows.canAct();

export const commands: CommandSpec[] = [
    {
        id: "file.newProject",
        title: "New Project…",
        shortcut: "Ctrl+Alt+N",
        context: TEXT_TOO,
        enabled: idle,
        run: async () => void (await fileWorkflows.newProject()),
    },
    {
        id: "file.open",
        title: "Open…",
        shortcut: "Ctrl+O",
        context: TEXT_TOO,
        enabled: idle,
        run: async () => void (await fileWorkflows.open()),
    },
    {
        id: "file.save",
        title: "Save",
        shortcut: "Ctrl+S",
        context: TEXT_TOO,
        enabled: () => fileWorkflows.canSave(),
        run: async () => void (await fileWorkflows.save()),
    },
    {
        id: "file.saveAs",
        title: "Save As…",
        shortcut: "Ctrl+Shift+S",
        context: TEXT_TOO,
        enabled: () => fileWorkflows.canSave(),
        run: async () => void (await fileWorkflows.saveAs()),
    },
    {
        id: "file.revert",
        title: "Revert",
        // Only a project with a file has something to go back to.
        enabled: () => projectOpen() && idle() && fileWorkflows.file() !== null,
        run: async () => void (await fileWorkflows.revert()),
    },
    {
        id: "file.closeProject",
        title: "Close Project",
        enabled: () => projectOpen() && idle(),
        run: async () => void (await fileWorkflows.close()),
    },
];

// `enabled` reads the workflows' state: an open menu follows it.
fileWorkflows.subscribe(() => appCommands.refresh());
