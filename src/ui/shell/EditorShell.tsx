import { AppShell } from "@ngne/editor-ui/shell";
import type { AppShellProps, RailFilter } from "@ngne/editor-ui/shell";
import { useCallback, useSyncExternalStore } from "react";
import { useSession } from "../../app/state/session";
import { toolState } from "../../app/tools/activeTool";
import { offersSlot } from "../../app/tools/toolSets";
import type { ToolSpec } from "../../app/tools/types";
import { EmptyState } from "../sprite/EmptyState";
import type { StatusFieldInput } from "../status/statusInput";
import { statusSource } from "../status/statusSource";
import { MapTabStrip } from "../tabs/MapTabStrip";
import { StampPreview } from "../tools/StampPreview";
import { ToolReadouts } from "../tools/ToolReadouts";
import { ViewportArea } from "../viewport/ViewportArea";
import { BottomPanel } from "./regions/BottomPanel";
import "./editorShell.css";

export interface EditorShellProps {
    /** Replaces the content of single slots (test pages); the default is the editor's. */
    slots?: Partial<AppShellProps<StatusFieldInput, ToolSpec>>;
}

/**
 * The editor's frame (DESIGN §2) on the package's shell, with this editor's region contents in
 * its slots: the map tabs in the menu bar, the stamp preview under the tool rail, the NGNE
 * viewport of the active map, the Tilesets and Terrains tabs of the bottom panel, the tool
 * readouts of the context bar. The rail shows the tool set of the active layer's kind (DESIGN
 * §6). While no project is open (TE-047) the viewport shows the empty state, and the tool
 * rail, the context bar, the dock and the bottom panel are empty frames.
 */
export function EditorShell({ slots = {} }: Readonly<EditorShellProps>) {
    const open = useSession((state) => state.open);
    const kind = useSyncExternalStore(toolState.subscribe, toolState.kind);
    const railFilter = useCallback<RailFilter<ToolSpec>>((slot) => offersSlot(slot, kind), [kind]);
    return (
        <AppShell<StatusFieldInput, ToolSpec>
            menuCentre={open ? <MapTabStrip /> : null}
            railFooter={open ? <StampPreview /> : null}
            viewport={<ViewportArea />}
            bottom={<BottomPanel />}
            noDocument={open ? undefined : <EmptyState />}
            status={statusSource}
            tools={open ? toolState : undefined}
            railFilter={railFilter}
            contextReadouts={<ToolReadouts />}
            {...slots}
        />
    );
}
