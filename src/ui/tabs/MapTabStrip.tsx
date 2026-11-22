import { TabStrip } from "@ngne/editor-ui/shell";
import type { TabStripItem } from "@ngne/editor-ui/shell";
import { useMemo, useSyncExternalStore } from "react";
import { projectDirty, subscribeDirty } from "../../app/file/workflows";
import { useSession } from "../../app/state/session";
import { activateMap, closeMapTab, moveMapTab, useMapTabs } from "../../app/tabs/tabs";

// The map tabs in the centre of the menu bar (DESIGN §2, TE-031), on the package's tab strip:
// the project's name and its unsaved marker, then one tab per open map of the project, the
// active one selected. Closing a tab hides the map; it stays in the project. The strip owns
// the keys, the drag that reorders, the overflow menu of every open map and the focus after
// Delete.

/**
 * The project's name and unsaved state; renders again only when one of them changes. A save
 * records the saved state without a change of the session store (TE-047), so the unsaved state
 * follows the file workflows as well.
 */
function useProjectLabel(): { label: string; dirty: boolean } {
    const label = useSession((state) => state.session.project.name);
    const dirty = useSyncExternalStore(subscribeDirty, projectDirty);
    return useMemo(() => ({ label, dirty }), [label, dirty]);
}

/** The tabs and the active map; renders again only when one of them changes. */
function useTabs(): { items: readonly TabStripItem[]; activeId: string | null } {
    const open = useMapTabs((state) => state.open);
    const key = useSession((state) => {
        const { project, activeMapId } = state.session;
        const names = new Map(project.maps.map((map) => [map.id, map.name]));
        return JSON.stringify([
            activeMapId,
            open.filter((id) => names.has(id)).map((id) => [id, names.get(id)!]),
        ]);
    });
    return useMemo(() => {
        const [activeId, rows] = JSON.parse(key) as [string, [string, string][]];
        return {
            activeId: rows.some(([id]) => id === activeId) ? activeId : null,
            items: rows.map(([id, label]) => ({ id, label })),
        };
    }, [key]);
}

export function MapTabStrip() {
    const leading = useProjectLabel();
    const { items, activeId } = useTabs();
    return (
        <TabStrip
            items={items}
            activeId={activeId}
            label="Maps"
            overflowLabel="All maps"
            leading={leading}
            activate={(id) => void activateMap(id)}
            close={(id) => void closeMapTab(id)}
            move={moveMapTab}
        />
    );
}
