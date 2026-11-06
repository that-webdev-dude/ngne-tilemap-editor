import { OVERLAY_SELECTOR } from "../../keymap/environment";
import { tilesetWorkflowBusy } from "../tilesetWorkflow";
import { importTilesetFiles } from "./importTileset";
import type { PickedFile } from "./importSources";
import { isSpriteName } from "./importSources";
import { pickedFile } from "./pickTilesetFiles";

// A `.ngsprite` dropped anywhere in the window opens the Import Tileset dialog for it (SPEC
// §6.1; TE-024); files dropped on the Tilesets panel open it for whatever they hold, a PNG, a
// sprite or an atlas with its PNG (TE-025), and that drop does not reach the window's. A
// `.ngtilemap` drop is TE-047's. Every file drag has its default prevented, so a dropped file
// never replaces the app; a drop while a menu or dialog is open, or while a tileset file
// operation (an import or an update) is in progress, does nothing (as the sprite editor's file
// drop, `app/file/install.ts`).

/** The part of `window` the drop listens on; tests pass an `EventTarget`. */
export interface DropTarget {
    addEventListener(type: string, listener: (event: Event) => void): void;
    removeEventListener(type: string, listener: (event: Event) => void): void;
}

export interface TilesetDropInstall {
    /** Where the page's events arrive; the default is `window`. */
    target?: DropTarget;
    /** Whether a menu, dialog or popover is open; the default reads the page. */
    overlayOpen?(): boolean;
    /** What the dropped files are handed to; the default is the app's import. */
    importFiles?(files: readonly PickedFile[]): void;
    /**
     * "sprite" (the default): only a `.ngsprite` among the files is imported. "all": every
     * file is handed on, and the drop stops at the target (the Tilesets panel).
     */
    files?: "sprite" | "all";
}

/** The part of a drag event the drop reads. */
interface DragLike extends Event {
    dataTransfer: DataTransfer | null;
}

/** Whether a drag carries files. */
function carriesFiles(transfer: DataTransfer | null): transfer is DataTransfer {
    return !!transfer && Array.from(transfer.types).includes("Files");
}

/** Installs the window's `.ngsprite` drop; returns the function that removes it. */
export function installTilesetDrop(install: TilesetDropInstall = {}): () => void {
    const target: DropTarget = install.target ?? window;
    const overlayOpen =
        install.overlayOpen ?? (() => document.querySelector(OVERLAY_SELECTOR) !== null);
    const importFiles = install.importFiles ?? ((files) => void importTilesetFiles(files));
    const all = install.files === "all";
    const accepts = () => !overlayOpen() && !tilesetWorkflowBusy();

    const onDragOver = (event: Event) => {
        const { dataTransfer } = event as DragLike;
        if (!carriesFiles(dataTransfer)) return;
        event.preventDefault();
        if (all) event.stopPropagation();
        dataTransfer.dropEffect = accepts() ? "copy" : "none";
    };
    const onDrop = (event: Event) => {
        const { dataTransfer } = event as DragLike;
        if (!carriesFiles(dataTransfer)) return;
        event.preventDefault();
        if (all) event.stopPropagation();
        if (!accepts()) return;
        const dropped = Array.from(dataTransfer.files);
        if (all) {
            if (dropped.length > 0) importFiles(dropped.map(pickedFile));
            return;
        }
        const sprite = dropped.find((file) => isSpriteName(file.name));
        if (sprite) importFiles([pickedFile(sprite)]);
    };
    target.addEventListener("dragover", onDragOver);
    target.addEventListener("drop", onDrop);
    return () => {
        target.removeEventListener("dragover", onDragOver);
        target.removeEventListener("drop", onDrop);
    };
}
