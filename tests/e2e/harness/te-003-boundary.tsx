import { createRoot } from "react-dom/client";
import { sessionStore } from "../../../src/app/state/session";
import { createProject, createProjectSession } from "../../../src/core/model";
import { DockSection } from "../../../src/ui/dock/DockSection";
import type { DockPanel } from "../../../src/ui/dock/registry";
import { AppShell, REGION_IDS } from "../../../src/ui/shell/AppShell";
import type { RegionId } from "../../../src/ui/shell/AppShell";
import { UiRoot } from "../../../src/ui/UiRoot";

// TE-003 error boundary page, adapted from the sprite editor's se-006-boundary.tsx: the real
// shell with one region (`?region=<id>`) or one dock panel (`?region=dock-panel`) whose content
// throws while rendering. The spec repairs it by setting `window.te003Repaired` and then uses
// the boundary's Reload action.
declare global {
    interface Window {
        te003Repaired?: boolean;
    }
}

function Fragile() {
    if (!window.te003Repaired) throw new Error("TE-003 harness: this content fails to render.");
    return <span data-fragile="">Content restored</span>;
}

const fragilePanel: DockPanel = { id: "fragile", title: "Fragile", order: 1, Body: Fragile };
const steadyPanel: DockPanel = {
    id: "steady",
    title: "Steady",
    order: 2,
    Body: () => <span data-steady="">Steady content</span>,
};

const target = new URLSearchParams(window.location.search).get("region") ?? "";
const regions =
    target === "dock-panel"
        ? {
              dock: (
                  <>
                      <DockSection
                          panel={fragilePanel}
                          collapsed={false}
                          onCollapsedChange={() => {}}
                      />
                      <DockSection
                          panel={steadyPanel}
                          collapsed={false}
                          onCollapsedChange={() => {}}
                      />
                  </>
              ),
          }
        : REGION_IDS.includes(target as RegionId)
          ? { [target]: <Fragile /> }
          : {};

// The shell shows its regions' content only while a project is open (TE-047).
sessionStore.getState().replace(createProjectSession(createProject()));

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(
    <UiRoot>
        <AppShell regions={regions} />
    </UiRoot>,
);
