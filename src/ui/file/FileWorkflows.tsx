import { useEffect } from "react";
import { installFileWorkflows } from "../../app/file/install";

/**
 * The page-wide parts of the file workflows (TE-047): the unload guard while the project is
 * dirty and the drop of a project file on the window (app/file/install.ts). `App` attaches the
 * toasts of the app's notices already. Autosave and recovery are TE-048's, the files the
 * installed app is launched with TE-066's. Renders nothing.
 */
export function FileWorkflows() {
    useEffect(() => installFileWorkflows(), []);
    return null;
}
