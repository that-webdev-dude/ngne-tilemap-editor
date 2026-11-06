import { OVERLAY_SELECTOR } from "../../keymap/environment";
import type { PickedFile } from "../import/importSources";
import { pickedFile } from "../import/pickTilesetFiles";
import type { DropTarget } from "../import/tilesetDrop";
import { tilesetWorkflowBusy } from "../tilesetWorkflow";
import { updateTilesetFromFiles } from "./updateFromSource";

// Files dropped on a tileset's tab in the Tilesets panel update that tileset from them (SPEC
// §6.3: "drop works too"; TE-028); files dropped elsewhere on the panel are imported (TE-025).
// The drop is installed on the panel's tab list, below the panel's own drop, and stops there
// when it lands on a tab. As every file drop of the app, it does nothing while a menu or
// dialog is open or a tileset file operation (an import or an update) is in progress.

/** The attribute that names a tab's tileset (`ui/tilesets/TilesetsPanel.tsx`). */
const TAB_SELECTOR = "[data-tileset-tab]";

export interface UpdateDropInstall {
    target: DropTarget;
    /** Whether a menu, dialog or popover is open; the default reads the page. */
    overlayOpen?(): boolean;
    /** What the dropped files are handed to; the default is the app's update. */
    updateFiles?(tilesetId: string, files: readonly PickedFile[]): void;
}

interface DragLike extends Event {
    dataTransfer: DataTransfer | null;
}

/** The tileset of the tab under the event, or null when it is not over a tab. */
function tabTileset(event: Event): string | null {
    const target = event.target;
    if (!target || typeof (target as Element).closest !== "function") return null;
    const tab = (target as Element).closest<HTMLElement>(TAB_SELECTOR);
    return tab?.dataset.tilesetTab ?? null;
}

/** Installs the drop on a tab list; returns the function that removes it. */
export function installUpdateDrop(install: UpdateDropInstall): () => void {
    const { target } = install;
    const overlayOpen =
        install.overlayOpen ?? (() => document.querySelector(OVERLAY_SELECTOR) !== null);
    const updateFiles =
        install.updateFiles ?? ((id, files) => void updateTilesetFromFiles(id, files));
    const accepts = () => !overlayOpen() && !tilesetWorkflowBusy();

    const onDragOver = (event: Event) => {
        const { dataTransfer } = event as DragLike;
        if (!dataTransfer || !Array.from(dataTransfer.types).includes("Files")) return;
        if (tabTileset(event) === null) return;
        event.preventDefault();
        event.stopPropagation();
        dataTransfer.dropEffect = accepts() ? "copy" : "none";
    };
    const onDrop = (event: Event) => {
        const { dataTransfer } = event as DragLike;
        if (!dataTransfer || !Array.from(dataTransfer.types).includes("Files")) return;
        const id = tabTileset(event);
        if (id === null) return;
        event.preventDefault();
        event.stopPropagation();
        const dropped = Array.from(dataTransfer.files);
        if (accepts() && dropped.length > 0) updateFiles(id, dropped.map(pickedFile));
    };
    target.addEventListener("dragover", onDragOver);
    target.addEventListener("drop", onDrop);
    return () => {
        target.removeEventListener("dragover", onDragOver);
        target.removeEventListener("drop", onDrop);
    };
}
