import { useEffect } from "react";
import { installAutosave } from "../../app/autosave/install";
import { installFileWorkflows } from "../../app/file/install";
import { installLaunchQueue } from "../../app/pwa/launchQueue";

/**
 * The page-wide parts of the file workflows (TE-047): the unload guard while the project is
 * dirty and the drop of a project file on the window (app/file/install.ts), then autosave, the
 * session state and the recovery offered on launch (TE-048, app/autosave/install.ts). `App`
 * attaches the toasts of the app's notices already. Last, the files the installed app is
 * launched with (TE-066, app/pwa/launchQueue.ts), once their toasts can be shown. Renders
 * nothing.
 */
export function FileWorkflows() {
    useEffect(() => installFileWorkflows(), []);
    useEffect(() => installAutosave(), []);
    useEffect(() => installLaunchQueue(), []);
    return null;
}
