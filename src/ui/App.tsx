import { UiRoot } from "@ngne/editor-ui";
import { SurfaceHost } from "@ngne/editor-ui/commands";
import { notices, toast, WebGpuRequired } from "@ngne/editor-ui/messages";
import { useWebGpuSupport } from "@ngne/editor-ui/platform";
import { useWindowTooSmall } from "@ngne/editor-ui/shell";
import { lazy, Suspense, useEffect } from "react";
import { editorUi } from "../app/editorUi";
import { useSession } from "../app/state/session";
import { installTestHooks } from "../app/testing/testHooks";
import { FileWorkflows } from "./file/FileWorkflows";
import { useTilesetDrop } from "./import/useTilesetDrop";
import { EditorShell } from "./shell/EditorShell";

// Development route: the package's gallery (`galleryRoute.tsx`), left out of the production
// bundle.
const Gallery = import.meta.env.DEV
    ? lazy(() => import("./galleryRoute").then((module) => ({ default: module.Gallery })))
    : null;

// Development builds only: end-to-end tests reach the stores through `window.__ngneTest`.
if (import.meta.env.DEV) installTestHooks(editorUi);

function isGalleryPath(pathname: string): boolean {
    return /\/gallery\/?$/.test(pathname);
}

/**
 * The editor behind its two gates: WebGPU available (a time-limited check: an adapter request
 * that never settles ends on the WebGPU-required notice), window at least 1280×720. The shell
 * stays mounted while its window-too-small notice covers it, so a resize loses no state.
 * Shortcuts act only while the shell is on screen.
 */
function Editor() {
    const gpu = useWebGpuSupport();
    const tooSmall = useWindowTooSmall();
    // A `.ngsprite` dropped on the window (TE-024), while a project is open (TE-047).
    const open = useSession((state) => state.open);
    useTilesetDrop(gpu.status === "supported" && !tooSmall && open);
    let content = null;
    if (gpu.status === "unsupported") {
        content = (
            <WebGpuRequired
                productName={editorUi.config.productName}
                reason={gpu.reason}
                detail={gpu.detail}
            />
        );
    } else if (gpu.status === "supported") {
        // The surfaces that commands open (command palette, Preferences, shortcut sheet,
        // About) are outside the shell. The file workflows stay mounted while the notice
        // covers the shell: the unload guard and the drop stay.
        content = (
            <>
                <EditorShell />
                <FileWorkflows />
                <SurfaceHost />
            </>
        );
    }
    return (
        <UiRoot editorUi={editorUi} keymap={gpu.status === "supported" && !tooSmall}>
            {content}
        </UiRoot>
    );
}

export function App() {
    // The results and failures the app announces (notices) as toasts, as the sprite editor's
    // `FileWorkflows` shows them.
    useEffect(
        () =>
            notices.attachSink((kind, message) => {
                if (kind === "error") toast.error(message);
                else toast.info(message);
            }),
        [],
    );
    if (Gallery && isGalleryPath(window.location.pathname)) {
        return (
            <UiRoot editorUi={editorUi} keymap={false}>
                <Suspense fallback={null}>
                    <Gallery />
                </Suspense>
            </UiRoot>
        );
    }
    return <Editor />;
}
