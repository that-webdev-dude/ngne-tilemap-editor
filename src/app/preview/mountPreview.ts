import { PreviewGame, previewPageStats } from "../../engine/preview";
import type { PreviewPageStats, PreviewProbe } from "../../engine/preview";
import type { History } from "../../core/history";
import type {} from "../../import-meta";
import { sessionStore } from "../state/session";
import { subscribeStrokeCells } from "../viewport/strokeCells";
import { packInWorker } from "../viewport/packTileset";
import { buildInWorker } from "./buildTilemap";
import { PreviewSource } from "./previewSource";
import { addPreviewDiagnostic, previewState, resolutionOf } from "./previewState";
import { layerFilter, previewBackground, previewCamera, previewDisplay } from "./previewView";

declare module "../testing/testHooks" {
    interface EditorTestHooks {
        /** The Preview section's game while the section is expanded (TE-056). */
        preview?: PreviewProbe;
        /** Counters of every preview game of the page (TE-056). */
        previewPage?: PreviewPageStats;
        /** The Preview section's choices and diagnostics (TE-056). */
        previewState?: typeof previewState;
    }
}

export interface MountedPreview {
    dispose(): void;
}

/** Whether the window is shown: the preview stops while it is hidden (SPEC §12). */
function windowVisible(): boolean {
    return document.visibilityState === "visible";
}

/**
 * Creates the game preview inside `host` and connects it to the stores (SPEC §12). `stage` is
 * the element the canvas is fitted to; `host` lies inside it and is left to the game. The game
 * runs while this is mounted, a map is open and the window is visible; the dock mounts the
 * section's body only while it is expanded, so a collapse disposes the game. In development
 * builds the probe, the page's counters and the state are put on `window.__ngneTest`.
 */
export function mountPreview(stage: HTMLElement, host: HTMLElement): MountedPreview {
    const hooks = import.meta.env.DEV ? window.__ngneTest : undefined;
    previewState.setState({ diagnostics: [] });
    const preview = new PreviewGame(host, { onDiagnostic: addPreviewDiagnostic });
    const source = new PreviewSource({
        pack: packInWorker,
        build: buildInWorker,
        // After the frame of the change: the viewport draws it before a build takes any time.
        defer: (start) => requestAnimationFrame(() => setTimeout(start, 0)),
        onContent: (content) => preview.setContent(content),
        onCells: () => preview.contentChanged(),
        onPending: (pending) => preview.setPending(pending),
        onError: addPreviewDiagnostic,
    });

    let stageSize = { width: 0, height: 0 };
    let hasMap = false;

    /** Everything the preview reads from the stores, set again on every change. */
    const sync = () => {
        const { open, session } = sessionStore.getState();
        const { project, activeMapId } = session;
        const map = open ? project.maps.find((each) => each.id === activeMapId) : undefined;
        const choices = previewState.getState();
        const resolution = resolutionOf(choices.resolution);
        source.show(open ? project : null, map?.id ?? null);
        preview.setResolution(resolution);
        preview.setDisplaySize(
            previewDisplay(resolution, stageSize, window.devicePixelRatio, choices.scale),
        );
        preview.setPlaying(choices.playing);
        hasMap = map !== undefined;
        if (map) {
            const camera = previewCamera(session, map, resolution);
            preview.setCamera(camera.x, camera.y);
            preview.setBackground(previewBackground(map));
        }
        preview.setRunning(hasMap && windowVisible());
    };

    // The layer filter is a new function only when what it selects changes.
    let filterKey = "";
    const syncFilter = () => {
        const { open, session } = sessionStore.getState();
        const map = open
            ? session.project.maps.find((each) => each.id === session.activeMapId)
            : undefined;
        const below = previewState.getState().layers === "below";
        const active = map ? session.perMap.get(map.id)?.activeLayerId : undefined;
        const key = map && below ? `${map.id}/${active}` : "";
        if (key === filterKey) return;
        filterKey = key;
        preview.setLayers(map && below ? layerFilter(session, map, true) : null);
    };

    // Steps of the history: the content follows each `touched` (SPEC §3).
    let history: History | null = null;
    let stopHistory: (() => void) | null = null;
    const follow = () => {
        const next = sessionStore.getState().history;
        if (next === history) return;
        stopHistory?.();
        history = next;
        stopHistory = next.subscribe(({ touched }) => {
            source.touched(touched);
            // A layer added, removed or moved changes which layers are "below".
            filterKey = "";
            syncFilter();
        });
    };

    const stopSession = sessionStore.subscribe(() => {
        follow();
        sync();
        syncFilter();
    });
    const stopState = previewState.subscribe(() => {
        sync();
        syncFilter();
    });
    // A stroke's cells show before it ends (SPEC §3), as in the viewport.
    const stopStroke = subscribeStrokeCells((touched) => source.touched(touched));
    const onVisibility = () => preview.setRunning(hasMap && windowVisible());
    document.addEventListener("visibilitychange", onVisibility);

    // The canvas fits the stage in whole device pixels (`previewDisplay`).
    const observer = new ResizeObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        const box = entry.devicePixelContentBoxSize?.[0];
        stageSize = box
            ? { width: box.inlineSize, height: box.blockSize }
            : {
                  width: Math.round(entry.contentRect.width * window.devicePixelRatio),
                  height: Math.round(entry.contentRect.height * window.devicePixelRatio),
              };
        sync();
    });
    try {
        observer.observe(stage, { box: "device-pixel-content-box" });
    } catch {
        observer.observe(stage);
    }

    follow();
    sync();
    syncFilter();

    if (hooks) {
        hooks.preview = preview.probe;
        hooks.previewPage = previewPageStats;
        hooks.previewState = previewState;
    }

    return {
        dispose() {
            if (hooks?.preview === preview.probe) delete hooks.preview;
            observer.disconnect();
            document.removeEventListener("visibilitychange", onVisibility);
            stopSession();
            stopState();
            stopStroke();
            stopHistory?.();
            source.dispose();
            void preview.dispose();
        },
    };
}
