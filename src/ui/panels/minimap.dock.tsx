import type { DockPanel } from "../dock/registry";
import { MinimapPanel } from "../minimap/MinimapPanel";

/** The whole map with the viewport's rectangle (DESIGN §8.8; TE-057). */
export const dockPanel: DockPanel = {
    id: "minimap",
    title: "Minimap",
    order: 50,
    Body: MinimapPanel,
    // DESIGN §2: collapsed by default at window heights under 800 px.
    collapseBelowHeight: 800,
};
