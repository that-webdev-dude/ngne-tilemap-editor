import type { DockPanel } from "../dock/registry";

/** The maps of the project (DESIGN §8.1); filled by TE-032. */
export const dockPanel: DockPanel = {
    id: "maps",
    title: "Maps",
    order: 10,
    Body: () => null,
};
