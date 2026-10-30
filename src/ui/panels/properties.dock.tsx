import type { DockPanel } from "../dock/registry";

/** The properties of the selection (DESIGN §8.3); filled by TE-040. */
export const dockPanel: DockPanel = {
    id: "properties",
    title: "Properties",
    order: 30,
    Body: () => null,
};
