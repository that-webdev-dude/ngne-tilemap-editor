import type { CommandSpec } from "../commands/types";
import { canAddLayer } from "../layers/layers";
import { newImageLayerFromDialog } from "./imageLayers";

// New Image Layer… of the Layer menu and the Layers panel's new-layer variants (DESIGN §5, §8.2;
// SPEC §7.2): asks for the image, then adds the layer above the active one.

export const commands: CommandSpec[] = [
    {
        id: "layer.newImage",
        title: "New Image Layer…",
        enabled: canAddLayer,
        run: async () => void (await newImageLayerFromDialog()),
    },
];
