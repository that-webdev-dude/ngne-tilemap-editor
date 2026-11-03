import { OVERLAY_SELECTOR } from "../../keymap/environment";
import { importTilesetFiles, importingTileset } from "./importTileset";
import type { PickedFile } from "./importSources";
import { isSpriteName } from "./importSources";
import { pickedFile } from "./pickTilesetFiles";

// A `.ngsprite` dropped anywhere in the window opens the Import Tileset dialog for it (SPEC
// §6.1; TE-024). A drop on the Tilesets panel is TE-025's, a `.ngtilemap` drop TE-047's. Every
// file drag has its default prevented, so a dropped file never replaces the app; a drop while a
// menu or dialog is open, or while an import is in progress, does nothing (as the sprite
// editor's file drop, `app/file/install.ts`).

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
    /** What a dropped sprite is handed to; the default is the app's import. */
    importFiles?(files: readonly PickedFile[]): void;
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
    const accepts = () => !overlayOpen() && !importingTileset();

    const onDragOver = (event: Event) => {
        const { dataTransfer } = event as DragLike;
        if (!carriesFiles(dataTransfer)) return;
        event.preventDefault();
        dataTransfer.dropEffect = accepts() ? "copy" : "none";
    };
    const onDrop = (event: Event) => {
        const { dataTransfer } = event as DragLike;
        if (!carriesFiles(dataTransfer)) return;
        event.preventDefault();
        if (!accepts()) return;
        const sprite = Array.from(dataTransfer.files).find((file) => isSpriteName(file.name));
        if (sprite) importFiles([pickedFile(sprite)]);
    };
    target.addEventListener("dragover", onDragOver);
    target.addEventListener("drop", onDrop);
    return () => {
        target.removeEventListener("dragover", onDragOver);
        target.removeEventListener("drop", onDrop);
    };
}
