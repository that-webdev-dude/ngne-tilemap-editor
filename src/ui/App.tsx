import { lazy, Suspense, useEffect } from "react";
import { notices } from "../app/notices/notices";
import { useSession } from "../app/state/session";
import { installTestHooks } from "../app/testing/testHooks";
import { useEditorKeymap } from "./commands/useEditorKeymap";
import { FileWorkflows } from "./file/FileWorkflows";
import { useTilesetDrop } from "./import/useTilesetDrop";
import { useWindowHeight, useWindowWidth } from "./platform/useWindowSize";
import { AppShell } from "./shell/AppShell";
import { isWindowTooSmall } from "./shell/layout";
import { WebGpuRequired } from "./shell/notices/WebGpuRequired";
import { WindowTooSmall } from "./shell/notices/WindowTooSmall";
import { AppSurfaces } from "./surfaces/AppSurfaces";
import { toast } from "./toast/toast";
import { UiRoot } from "./UiRoot";
import { useWebGpuCheck } from "./startup/webGpuCheck";

// Development route: left out of the production bundle.
const Gallery = import.meta.env.DEV
    ? lazy(() => import("./gallery/Gallery").then((module) => ({ default: module.Gallery })))
    : null;

// Development builds only: end-to-end tests reach the stores through `window.__ngneTest`.
if (import.meta.env.DEV) installTestHooks();

function isGalleryPath(pathname: string): boolean {
    return /\/gallery\/?$/.test(pathname);
}

/** The editor behind its two gates: WebGPU available, window at least 1280×720. */
function Editor() {
    // Time-limited: an adapter request that never settles ends on the WebGPU-required notice.
    const gpu = useWebGpuCheck();
    const width = useWindowWidth();
    const height = useWindowHeight();
    const tooSmall = isWindowTooSmall(width, height);
    // Shortcuts act only while the shell is on screen.
    useEditorKeymap(gpu.status === "supported" && !tooSmall);
    // A `.ngsprite` dropped on the window, likewise (TE-024), while a project is open (TE-047).
    const open = useSession((state) => state.open);
    useTilesetDrop(gpu.status === "supported" && !tooSmall && open);
    if (gpu.status === "checking") return null;
    if (gpu.status === "unsupported") {
        return <WebGpuRequired reason={gpu.reason} detail={gpu.detail} />;
    }
    // The shell stays mounted while the notice covers it, so a resize loses no state. The
    // surfaces that commands open (command palette, Preferences, shortcut sheet) are outside it.
    return (
        <>
            <AppShell hidden={tooSmall} />
            {/* Mounted while the notice covers the shell too: the unload guard and the drop stay. */}
            <FileWorkflows />
            {tooSmall ? <WindowTooSmall width={width} height={height} /> : null}
            <AppSurfaces />
        </>
    );
}

export function App() {
    // The results and failures the app announces (app/notices) as toasts, as the sprite
    // editor's `FileWorkflows` shows them.
    useEffect(
        () =>
            notices.attachSink((kind, message) => {
                if (kind === "error") toast.error(message);
                else toast.info(message);
            }),
        [],
    );
    return (
        <UiRoot>
            {Gallery && isGalleryPath(window.location.pathname) ? (
                <Suspense fallback={null}>
                    <Gallery />
                </Suspense>
            ) : (
                <Editor />
            )}
        </UiRoot>
    );
}
