import type { DockPanel } from "../dock/registry";

/** The layers of the active map (DESIGN §8.2); filled by TE-035. */
export const dockPanel: DockPanel = {
    id: "layers",
    title: "Layers",
    order: 20,
    Body: () => null,
};
