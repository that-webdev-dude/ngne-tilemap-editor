import type { PickedFile } from "./importSources";

// The picker of File → Import Tileset… (SUITE §7): `.png`, `.ngsprite` (`application/zip`) and
// `.atlas.json`, several at once so an atlas and its PNG are picked together. It touches the
// page only when called, so the modules that import it load in Node.

/** The types the picker offers (SUITE §7). */
export const TILESET_PICKER_ACCEPT = "image/png,.png,.ngsprite,application/zip,.atlas.json";

/** Asks for the files of a tileset; resolves null when the user cancels. */
export function pickTilesetFiles(): Promise<PickedFile[] | null> {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = TILESET_PICKER_ACCEPT;
        input.multiple = true;
        input.hidden = true;
        input.dataset.importTilesetInput = "";
        const finish = (files: readonly File[] | null) => {
            input.remove();
            resolve(files && files.length > 0 ? files.map(pickedFile) : null);
        };
        input.addEventListener("change", () => finish(Array.from(input.files ?? [])), {
            once: true,
        });
        input.addEventListener("cancel", () => finish(null), { once: true });
        document.body.append(input);
        input.click();
    });
}

/** A browser file as the import reads it. */
export function pickedFile(file: File): PickedFile {
    return { name: file.name, read: async () => new Uint8Array(await file.arrayBuffer()) };
}
