import { useEffect } from "react";
import { installAutosave } from "../../app/autosave/install";
import { installFileWorkflows } from "../../app/file/install";

/**
 * The page-wide parts of the file workflows (TE-047): the unload guard while the project is
 * dirty and the drop of a project file on the window (app/file/install.ts), then autosave, the
 * session state and the recovery offered on launch (TE-048, app/autosave/install.ts). `App`
 * attaches the toasts of the app's notices already. The files the installed app is launched
 * with are TE-066's. Renders nothing.
 */
export function FileWorkflows() {
    useEffect(() => installFileWorkflows(), []);
    useEffect(() => installAutosave(), []);
    return null;
}
