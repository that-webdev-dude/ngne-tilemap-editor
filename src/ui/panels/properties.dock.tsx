import type { DockPanel } from "../dock/registry";
import { PropertiesHeader, PropertiesPanel } from "../properties/PropertiesPanel";

/** The properties of the selection (DESIGN §8.3; TE-040). */
export const dockPanel: DockPanel = {
    id: "properties",
    title: "Properties",
    order: 30,
    Body: PropertiesPanel,
    HeaderExtra: PropertiesHeader,
};
