import { pickedFile } from "../tilesets/import/pickTilesetFiles";
import type { PickedFile } from "../tilesets/import/importSources";

// The picker of an image layer's PNG (New Image Layer…, the layer popover's image field). It
// touches the page only when called, so the modules that import it load in Node.

/** The types the picker offers. */
export const IMAGE_PICKER_ACCEPT = "image/png,.png";

/** Asks for one PNG; resolves null when the user cancels. */
export function pickImageFile(): Promise<PickedFile | null> {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = IMAGE_PICKER_ACCEPT;
        input.hidden = true;
        input.dataset.imageLayerInput = "";
        const finish = (file: File | null) => {
            input.remove();
            resolve(file ? pickedFile(file) : null);
        };
        input.addEventListener("change", () => finish(input.files?.[0] ?? null), { once: true });
        input.addEventListener("cancel", () => finish(null), { once: true });
        document.body.append(input);
        input.click();
    });
}
