import type { DockPanel } from "../registryTypes";
import { LayersHeader, LayersPanel } from "../layers/LayersPanel";
import { showsActiveMap } from "./showsActiveMap";

/** The layers of the active map (DESIGN §8.2; TE-035). */
export const dockPanel: DockPanel = {
    id: "layers",
    title: "Layers",
    order: 20,
    Body: showsActiveMap(LayersPanel),
    HeaderExtra: LayersHeader,
};
