import { useEffect, useRef, useState } from "react";
import { VIEWPORT_FOCUS_ATTRIBUTE } from "../../app/keymap/environment";
import { REGION_FOCUS_ATTRIBUTE } from "../../app/keymap/regions";
import { notices } from "../../app/notices/notices";
import { mountOverlay } from "../../app/overlay/mountOverlay";
import type { MountedOverlay } from "../../app/overlay/mountOverlay";
import { DEFAULT_OVERLAY_THEME } from "../../app/overlay/types";
import type { OverlayTheme } from "../../app/overlay/types";
import { preferences } from "../../app/preferences/preferences";
import { sessionStore } from "../../app/state/session";
import { mapTabsStore } from "../../app/tabs/tabs";
import { setViewportProbe } from "../../app/testing/testHooks";
import { attachToolPointer } from "../../app/tools/attachToolPointer";
import { attachViewNavigation } from "../../app/view/pointerNavigation";
import { connectViewPolicy } from "../../app/view/viewPolicy";
import { viewportSize } from "../../app/view/viewportSize";
import { packInWorker } from "../../app/viewport/packTileset";
import { readScene } from "../../app/viewport/scene";
import type { ThemeChecker } from "../../app/viewport/scene";
import { bindViewport } from "../../app/viewport/viewportBinding";
import { Viewport, rendererCreations } from "../../engine/viewport";
import type { ViewportStatus } from "../../engine/viewport";
import { parseHexColour } from "../preferences/hexColour";
import { Button } from "../primitives";
import { themeStore, useTheme } from "../theme/theme";
import type { Theme } from "../theme/theme";
import "./viewportArea.css";

/** Grid ink of DESIGN §4: white lines in the dark theme, black lines in the light one. */
const INK: Record<Theme, number> = { dark: 0xffffff, light: 0x000000 };

/** The element's marks: the keymap and the F6 cycle find the viewport by them. */
const MARKS = {
    // DESIGN §10.1: only this element counts as "the viewport itself is focused".
    [VIEWPORT_FOCUS_ATTRIBUTE]: "",
    // F6 enters the viewport region here.
    [REGION_FOCUS_ATTRIBUTE]: "",
};

/** A colour token of the current theme as 0xRRGGBB. */
function themeColour(name: string): number {
    const style = getComputedStyle(document.documentElement);
    return parseHexColour(style.getPropertyValue(name)) ?? 0;
}

/** The overlay's colours of `theme` (DESIGN §4), read from its tokens on the page. */
function overlayTheme(theme: Theme): OverlayTheme {
    const style = getComputedStyle(document.documentElement);
    return {
        ink: INK[theme],
        accent: themeColour("--accent"),
        danger: themeColour("--danger"),
        text: themeColour("--text"),
        panel: themeColour("--bg-panel"),
        font: style.getPropertyValue("--font-ui").trim() || DEFAULT_OVERLAY_THEME.font,
    };
}

/** The canvas size in device pixels, as the browser lays the element out. */
function deviceSizeOf(entry: ResizeObserverEntry): { width: number; height: number } {
    const box = entry.devicePixelContentBoxSize?.[0];
    if (box) return { width: box.inlineSize, height: box.blockSize };
    const ratio = window.devicePixelRatio;
    return {
        width: Math.max(1, Math.round(entry.contentRect.width * ratio)),
        height: Math.max(1, Math.round(entry.contentRect.height * ratio)),
    };
}

/**
 * The viewport host (ENGINE §2): the focusable element the NGNE canvas and, above it, the
 * overlay canvas fill. It creates the viewport with an abort signal, resizes both canvases and
 * reports the size to view navigation from one `ResizeObserver` without creating the viewport
 * again, and disposes it when the region unmounts.
 *
 * Keyboard focus, the F6 focus region and the pointer listeners of view navigation are on this
 * element and not on a canvas; the tools listen on the overlay canvas. Wheel and drags act by
 * pointer location, whatever has focus (`app/view/pointerNavigation`); their events reach this
 * element from the overlay, the pointer target, by bubbling.
 */
export function ViewportArea() {
    const element = useRef<HTMLDivElement>(null);
    const overlay = useRef<MountedOverlay | null>(null);
    const theme = useTheme();
    const colours = useRef<{ checker: ThemeChecker; workspace: number }>({
        checker: { a: 0, b: 0 },
        workspace: 0,
    });
    const redraw = useRef<(() => void) | null>(null);
    const [status, setStatus] = useState<ViewportStatus>("ready");

    // The tokens of the theme, read after `UiRoot` has put it on the page.
    useEffect(() => {
        colours.current = {
            checker: { a: themeColour("--check-a"), b: themeColour("--check-b") },
            workspace: themeColour("--bg-workspace"),
        };
        redraw.current?.();
        overlay.current?.setTheme(overlayTheme(theme));
    }, [theme]);

    useEffect(() => {
        const host = element.current;
        if (!host) return;
        const abort = new AbortController();
        const canvas = document.createElement("canvas");
        // Fills the host: one backing pixel per device pixel once the sizes match.
        canvas.style.cssText = "position:absolute;inset:0;display:block;width:100%;height:100%";
        canvas.dataset.viewportCanvas = "";
        host.append(canvas);
        // The overlay is the pointer target, above the NGNE canvas, in the same box.
        const overlayCanvas = document.createElement("canvas");
        overlayCanvas.style.cssText = canvas.style.cssText;
        overlayCanvas.dataset.viewportOverlay = "";
        // Chrome only; the viewport element is what assistive technology is told about.
        overlayCanvas.setAttribute("aria-hidden", "true");
        host.append(overlayCanvas);
        const mounted = mountOverlay(overlayCanvas, host);
        overlay.current = mounted;
        mounted.setTheme(overlayTheme(themeStore.getState().theme));
        const detachNavigation = attachViewNavigation(host);
        // The tools take the overlay's presses (SPEC §4.1), mapped as the map is on screen.
        const detachTools = attachToolPointer(overlayCanvas, host, () => mounted.mapping());
        const stopPolicy = connectViewPolicy();

        let viewport: Viewport | null = null;
        let unbind: (() => void) | null = null;
        let size = {
            width: Math.max(1, Math.round(host.clientWidth * window.devicePixelRatio)),
            height: Math.max(1, Math.round(host.clientHeight * window.devicePixelRatio)),
        };
        viewportSize.report(size);
        mounted.resize(size);
        const reported = new Set<string>();
        const report = (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            if (reported.has(message)) return;
            reported.add(message);
            notices.error(message);
        };

        const observer = new ResizeObserver((entries) => {
            const entry = entries[entries.length - 1];
            if (!entry) return;
            size = deviceSizeOf(entry);
            // A host that is hidden (the window-too-small notice) measures 0 × 0: the canvases
            // keep their last size until it is back, and navigation has no viewport.
            if (!(size.width >= 1 && size.height >= 1)) {
                viewportSize.report({ width: 0, height: 0 });
                return;
            }
            viewportSize.report(size);
            mounted.resize(size);
            viewport?.resize(size);
        });
        observer.observe(host, { box: "device-pixel-content-box" });

        // A change of the display's scale changes the device size without the element moving.
        const scaleQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
        const onScale = () => viewport?.requestRedraw();
        scaleQuery.addEventListener("change", onScale);

        const unsubscribePreferences = preferences.subscribe((key) => {
            if (key === "checkerboard") viewport?.requestRedraw();
        });

        Viewport.create({
            canvas,
            size,
            signal: abort.signal,
            scene: () =>
                readScene({
                    session: sessionStore.getState(),
                    preferences: preferences.all(),
                    themeChecker: colours.current.checker,
                    dpr: window.devicePixelRatio,
                }),
            workspace: () => colours.current.workspace,
            pack: packInWorker,
            onError: report,
            onStatus: setStatus,
        }).then(
            (created) => {
                if (abort.signal.aborted) {
                    created.dispose();
                    return;
                }
                viewport = created;
                redraw.current = () => created.requestRedraw();
                unbind = bindViewport(created, sessionStore, mapTabsStore);
                created.resize(size);
                setViewportProbe({
                    canvas,
                    get status() {
                        return created.status;
                    },
                    get stats() {
                        return created.stats;
                    },
                    renderNow: () => created.renderNow(),
                    textureIds: () => created.textureIds(),
                    chunkStats: () => created.chunkStats,
                    chunkLiveCells: () => created.chunkLiveCells(),
                    rejectChunkUpdates: (count, drop) => created.rejectChunkUpdates(count, drop),
                    rendererCreations,
                });
            },
            (error: unknown) => {
                if (!abort.signal.aborted) {
                    report(error);
                    setStatus("failed");
                }
            },
        );

        return () => {
            abort.abort();
            observer.disconnect();
            scaleQuery.removeEventListener("change", onScale);
            unsubscribePreferences();
            unbind?.();
            setViewportProbe(null);
            redraw.current = null;
            viewport?.dispose();
            stopPolicy();
            detachTools();
            detachNavigation();
            overlay.current = null;
            mounted.dispose();
            viewportSize.report({ width: 0, height: 0 });
            overlayCanvas.remove();
            canvas.remove();
        };
    }, []);

    return (
        <div
            className="viewport-area"
            ref={element}
            tabIndex={0}
            // A pointer surface with keys of its own, not a control a screen reader operates
            // (DESIGN §8); the name says what has focus.
            role="application"
            aria-label="Canvas"
            data-viewport=""
            data-status={status}
            {...MARKS}
        >
            {status === "failed" ? (
                <div className="viewport-failure" role="alert" data-viewport-failure="">
                    <p>The graphics device was lost and could not be recovered.</p>
                    <Button variant="primary" onClick={() => window.location.reload()}>
                        Reload
                    </Button>
                </div>
            ) : null}
        </div>
    );
}
