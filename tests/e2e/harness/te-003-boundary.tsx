import "@ngne/editor-ui/styles.css";
import { UiRoot } from "@ngne/editor-ui";
import type { ContextBarContent, StatusField } from "@ngne/editor-ui/shell";
import type { ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { editorUi } from "../../../src/app/editorUi";
import { sessionStore } from "../../../src/app/state/session";
import { createProject, createProjectSession } from "../../../src/core/model";
import type { DockPanel } from "../../../src/ui/registryTypes";
import { EditorShell } from "../../../src/ui/shell/EditorShell";
import type { EditorShellProps } from "../../../src/ui/shell/EditorShell";
import type { StatusFieldInput } from "../../../src/ui/status/statusInput";

// TE-003 error boundary page, adapted from the sprite editor's se-006-boundary.tsx: the real
// shell with one region (`?region=<id>`) or one dock panel (`?region=dock-panel`) whose content
// throws while rendering. The spec repairs it by setting `window.te003Repaired` and then uses
// the boundary's Reload action. The shell is the package's: a region's content comes from a
// slot of `EditorShell`, or, for the dock, the context bar and the status bar, which draw the
// instance's registries, from the app's instance with a failing entry added to them.
declare global {
    interface Window {
        te003Repaired?: boolean;
    }
}

const repaired = () => window.te003Repaired === true;

function Fragile() {
    if (!repaired()) throw new Error("TE-003 harness: this content fails to render.");
    return <span data-fragile="">Content restored</span>;
}

const fragilePanel: DockPanel = { id: "fragile", title: "Fragile", order: 1, Body: Fragile };
const steadyPanel: DockPanel = {
    id: "steady",
    title: "Steady",
    order: 2,
    Body: () => <span data-steady="">Steady content</span>,
};

/** A dock section whose header fails too: the dock region's own boundary catches it. */
const failingDock: DockPanel = {
    id: "fragile",
    get title() {
        if (!repaired()) throw new Error("TE-003 harness: this dock fails to render.");
        return "Fragile";
    },
    order: 1,
    Body: Fragile,
};

/** Takes the context bar's options' place while the active tool is shown. */
const fragileContent: ContextBarContent<ComponentType> = {
    id: "fragile",
    order: 0,
    shown: () => true,
    subscribe: () => () => undefined,
    Body: Fragile,
};

/** A status field whose text fails until repaired; the bar's fields are text, not components. */
const fragileField: StatusField<StatusFieldInput> = {
    id: "fragile",
    order: 0,
    text: () => {
        if (!repaired()) throw new Error("TE-003 harness: this field fails to render.");
        return "Content restored";
    },
};

const target = new URLSearchParams(window.location.search).get("region") ?? "";

/** The slots of the regions whose content the harness replaces. */
const SLOTS: Readonly<Record<string, EditorShellProps["slots"]>> = {
    "menu-bar": { menuCentre: <Fragile /> },
    "tool-rail": { railFooter: <Fragile /> },
    viewport: { viewport: <Fragile /> },
    "bottom-panel": { bottom: <Fragile /> },
};

/** The app's instance, with the failing entry of the region added to its registries. */
function instanceFor(region: string): typeof editorUi {
    switch (region) {
        case "dock-panel":
            return { ...editorUi, dockPanels: [fragilePanel, steadyPanel, ...editorUi.dockPanels] };
        case "dock":
            return { ...editorUi, dockPanels: [failingDock, ...editorUi.dockPanels] };
        case "context-bar":
            return {
                ...editorUi,
                contextBarContent: [fragileContent, ...editorUi.contextBarContent],
            };
        case "status-bar":
            return { ...editorUi, statusFields: [fragileField, ...editorUi.statusFields] };
        default:
            return editorUi;
    }
}

// The restored status field is text: the harness marks it as the spec finds restored content.
if (target === "status-bar") {
    new MutationObserver(() => {
        for (const field of document.querySelectorAll('[data-status="fragile"]')) {
            if (!field.hasAttribute("data-fragile")) field.setAttribute("data-fragile", "");
        }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
}

// The shell shows its regions' content only while a project is open (TE-047).
sessionStore.getState().replace(createProjectSession(createProject()));

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(
    <UiRoot editorUi={instanceFor(target)}>
        <EditorShell slots={SLOTS[target] ?? {}} />
    </UiRoot>,
);
