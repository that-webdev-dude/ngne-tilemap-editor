import type { CommandSpec } from "../commands/types";
import { fileWorkflows } from "../file/workflows";
import { exportPipeline } from "./exportProject";

// The export commands of SPEC §10.2 (the sprite editor's SE-052). Export… and Export Again take
// the File menu items planned for them (commands/planned.commands.ts). DESIGN §10.3: Ctrl+E and
// Ctrl+Shift+X are marked †, so they also act while a text field has focus. Each is a file
// operation: it waits while another one runs and never acts during a stroke. The file
// workflows' `subscribe` already refreshes the registry when `busy` changes (file.commands.ts).

const TEXT_TOO: CommandSpec["context"] = ["global", "text"];

const enabled = () => exportPipeline.canExport();

export const commands: CommandSpec[] = [
    {
        id: "file.export",
        title: "Export…",
        shortcut: "Ctrl+E",
        context: TEXT_TOO,
        enabled,
        run: async () => void (await exportPipeline.exportWithDialog()),
    },
    {
        id: "file.exportAgain",
        title: "Export Again",
        shortcut: "Ctrl+Shift+X",
        context: TEXT_TOO,
        enabled,
        run: async () => void (await exportPipeline.exportAgain()),
    },
];

// Export on Save (SPEC §10.2): a successful save exports again, inside its file operation.
fileWorkflows.onSaved(() => exportPipeline.exportOnSave());
