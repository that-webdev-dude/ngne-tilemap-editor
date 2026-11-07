import type { DockPanel } from "../dock/registry";
import { LayersHeader, LayersPanel } from "../layers/LayersPanel";

/** The layers of the active map (DESIGN §8.2; TE-035). */
export const dockPanel: DockPanel = {
    id: "layers",
    title: "Layers",
    order: 20,
    Body: LayersPanel,
    HeaderExtra: LayersHeader,
};
