import type { DockPanel } from "../dock/registry";
import { PreviewPanel } from "../preview/PreviewPanel";

/** The game preview (DESIGN §8.4; TE-056). */
export const dockPanel: DockPanel = {
    id: "preview",
    title: "Preview · NGNE",
    order: 40,
    Body: PreviewPanel,
    // DESIGN §2: collapsed by default at window heights under 800 px.
    collapseBelowHeight: 800,
};
