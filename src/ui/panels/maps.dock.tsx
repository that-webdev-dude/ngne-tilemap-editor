import type { DockPanel } from "../dock/registry";
import { MapsPanel, NewMapButton } from "../maps/MapsPanel";

/** The maps of the project (DESIGN §8.1; TE-032). */
export const dockPanel: DockPanel = {
    id: "maps",
    title: "Maps",
    order: 10,
    Body: MapsPanel,
    HeaderExtra: NewMapButton,
};
