import { Tabs } from "radix-ui";
import { useState } from "react";
import { TerrainsPanel } from "../../terrains/TerrainsPanel";
import { TilesetsPanel } from "../../tilesets/TilesetsPanel";

/** The tabs of the bottom panel (DESIGN §2): Tilesets (§8.5) and Terrains (§8.6). */
export const BOTTOM_PANEL_TABS = [
    { id: "tilesets", label: "Tilesets" },
    { id: "terrains", label: "Terrains" },
] as const;
export type BottomPanelTab = (typeof BOTTOM_PANEL_TABS)[number]["id"];

/**
 * Bottom panel content, in the sprite editor's timeline slot: a tab strip over the selected
 * tab's panel. The Tilesets tab holds the Tilesets panel (TE-025), the Terrains tab the Terrains
 * panel (TE-043).
 */
export function BottomPanel() {
    const [tab, setTab] = useState<BottomPanelTab>("tilesets");
    return (
        <Tabs.Root
            className="bottom-panel"
            value={tab}
            onValueChange={(value) => setTab(value as BottomPanelTab)}
        >
            <Tabs.List className="bottom-panel__tabs" aria-label="Bottom panel">
                {BOTTOM_PANEL_TABS.map(({ id, label }) => (
                    <Tabs.Trigger key={id} className="bottom-panel__tab" value={id}>
                        {label}
                    </Tabs.Trigger>
                ))}
            </Tabs.List>
            {BOTTOM_PANEL_TABS.map(({ id }) => (
                <Tabs.Content
                    key={id}
                    className="bottom-panel__body"
                    value={id}
                    data-panel-tab={id}
                >
                    {id === "tilesets" ? <TilesetsPanel /> : <TerrainsPanel />}
                </Tabs.Content>
            ))}
        </Tabs.Root>
    );
}
