import type { CSSProperties, ReactNode } from "react";
import { useBottomPanel } from "../../app/shell/bottomPanel";
import { useSession } from "../../app/state/session";
import { useWindowHeight } from "../platform/useWindowSize";
import { Splitter } from "../primitives/Splitter";
import {
    DOCK_WIDTH,
    resolveDockWidth,
    resolveTimelineHeight,
    TIMELINE_HEIGHT,
    timelineMaxHeight,
} from "./layout";
import { useLayout } from "./layoutStore";
import { RailFrame } from "./RailFrame";
import { RegionBoundary } from "./RegionBoundary";
import { BottomPanel } from "./regions/BottomPanel";
import { ContextBar } from "./regions/ContextBar";
import { Dock } from "./regions/Dock";
import { MenuBar } from "./regions/MenuBar";
import { StatusBar } from "./regions/StatusBar";
import { ToolRail } from "./regions/ToolRail";
import { STAMP_PREVIEW_SIZE } from "../tools/StampPreview";
import { Viewport } from "./regions/Viewport";
import "./shell.css";

/** The seven regions of DESIGN §2; each element carries its id as `data-region`. */
export const REGION_IDS = [
    "menu-bar",
    "tool-rail",
    "context-bar",
    "viewport",
    "dock",
    "bottom-panel",
    "status-bar",
] as const;
export type RegionId = (typeof REGION_IDS)[number];

export interface AppShellProps {
    /** Replaces the content of single regions (test pages); the default is `regions/*.tsx`. */
    regions?: Partial<Record<RegionId, ReactNode>>;
    /** Keeps the shell mounted but not displayed (window too small). */
    hidden?: boolean;
}

/**
 * App shell: the region frames, their error boundaries and the two splitters. Region content
 * lives in `regions/`, one module per region, so a feature edits only its own region. The
 * bottom panel takes the sprite editor's timeline slot with its sizes (layout.ts), beside the
 * tool rail (DESIGN §2). While no project is open (TE-047) the viewport shows the empty state
 * and the tool rail, context bar, dock, bottom panel and status bar are empty frames, as the
 * sprite editor's are with no document.
 */
export function AppShell({ regions = {}, hidden = false }: AppShellProps) {
    const windowHeight = useWindowHeight();
    const dockWidth = resolveDockWidth(useLayout((state) => state.dockWidth));
    const panelHeight = resolveTimelineHeight(
        useLayout((state) => state.timelineHeight),
        windowHeight,
    );
    const setDockWidth = useLayout((state) => state.setDockWidth);
    const setPanelHeight = useLayout((state) => state.setTimelineHeight);
    // Tab toggles the bottom panel (DESIGN §10.3, TE-007); hidden, its row of the grid is empty.
    const panelVisible = useBottomPanel((state) => state.visible);
    const open = useSession((state) => state.open);
    /** A region's own content, or nothing while no project is open. */
    const content = (node: ReactNode) => (open ? node : null);
    const sizes = {
        "--shell-dock-width": `${dockWidth}px`,
        "--shell-panel-height": panelVisible ? `${panelHeight}px` : "0px",
    } as CSSProperties;

    return (
        <div className="shell" style={sizes} hidden={hidden}>
            <header className="shell-menubar" data-region="menu-bar">
                <RegionBoundary name="Menu bar">
                    {regions["menu-bar"] ?? <MenuBar />}
                </RegionBoundary>
            </header>
            <RailFrame footer={STAMP_PREVIEW_SIZE}>
                {regions["tool-rail"] ?? content(<ToolRail />)}
            </RailFrame>
            <section className="shell-context" data-region="context-bar" aria-label="Tool options">
                <RegionBoundary name="Context bar">
                    {regions["context-bar"] ?? content(<ContextBar />)}
                </RegionBoundary>
            </section>
            <main className="shell-viewport" data-region="viewport">
                <RegionBoundary name="Viewport">{regions.viewport ?? <Viewport />}</RegionBoundary>
            </main>
            <aside className="shell-dock" data-region="dock" aria-label="Panels">
                <Splitter
                    className="shell-dock__splitter"
                    orientation="vertical"
                    label="Resize panels"
                    value={dockWidth}
                    min={DOCK_WIDTH.min}
                    max={DOCK_WIDTH.max}
                    growth={-1}
                    onChange={setDockWidth}
                    onReset={() => setDockWidth(null)}
                />
                <div className="shell-dock__scroll">
                    <RegionBoundary name="Panels">
                        {regions.dock ?? content(<Dock />)}
                    </RegionBoundary>
                </div>
            </aside>
            <section
                className="shell-panel"
                data-region="bottom-panel"
                aria-label="Bottom panel"
                hidden={!panelVisible}
            >
                <Splitter
                    className="shell-panel__splitter"
                    orientation="horizontal"
                    label="Resize bottom panel"
                    value={panelHeight}
                    min={TIMELINE_HEIGHT.min}
                    max={timelineMaxHeight(windowHeight)}
                    growth={-1}
                    onChange={setPanelHeight}
                    onReset={() => setPanelHeight(null)}
                />
                <div className="shell-panel__content">
                    <RegionBoundary name="Bottom panel">
                        {regions["bottom-panel"] ?? content(<BottomPanel />)}
                    </RegionBoundary>
                </div>
            </section>
            <footer className="shell-status" data-region="status-bar">
                <RegionBoundary name="Status bar">
                    {regions["status-bar"] ?? content(<StatusBar />)}
                </RegionBoundary>
            </footer>
        </div>
    );
}
