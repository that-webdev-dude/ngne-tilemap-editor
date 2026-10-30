import type { DockPanel } from "../dock/registry";

/** The whole map with the viewport's rectangle (DESIGN §8.8); filled by TE-057. */
export const dockPanel: DockPanel = {
    id: "minimap",
    title: "Minimap",
    order: 50,
    Body: () => null,
    // DESIGN §2: collapsed by default at window heights under 800 px.
    collapseBelowHeight: 800,
};
