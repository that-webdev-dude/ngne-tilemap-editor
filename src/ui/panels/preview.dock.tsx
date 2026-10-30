import type { DockPanel } from "../dock/registry";

/** The game preview (DESIGN §8.4); filled by TE-056. */
export const dockPanel: DockPanel = {
    id: "preview",
    title: "Preview · NGNE",
    order: 40,
    Body: () => null,
    // DESIGN §2: collapsed by default at window heights under 800 px.
    collapseBelowHeight: 800,
};
