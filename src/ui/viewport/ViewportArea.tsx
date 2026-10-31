import { useEffect, useRef, useState } from "react";
import { notices } from "../../app/notices/notices";
import { preferences } from "../../app/preferences/preferences";
import { sessionStore } from "../../app/state/session";
import { setViewportProbe } from "../../app/testing/testHooks";
import { packInWorker } from "../../app/viewport/packTileset";
import { readScene } from "../../app/viewport/scene";
import type { ThemeChecker } from "../../app/viewport/scene";
import { bindViewport } from "../../app/viewport/viewportBinding";
import { Viewport, rendererCreations } from "../../engine/viewport";
import type { ViewportStatus } from "../../engine/viewport";
import { parseHexColour } from "../preferences/hexColour";
import { Button } from "../primitives";
import { useTheme } from "../theme/theme";
import "./viewportArea.css";

/** A colour token of the current theme as 0xRRGGBB. */
function themeColour(name: string): number {
    const style = getComputedStyle(document.documentElement);
    return parseHexColour(style.getPropertyValue(name)) ?? 0;
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
 * The viewport host (ENGINE §2): the element the NGNE canvas fills. It creates the viewport
 * with an abort signal, resizes it from a `ResizeObserver` without creating it again, and
 * disposes it when the region unmounts. The overlay canvas of TE-014 joins it as a sibling.
 */
export function ViewportArea() {
    const element = useRef<HTMLDivElement>(null);
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

        let viewport: Viewport | null = null;
        let unbind: (() => void) | null = null;
        let size = {
            width: Math.max(1, Math.round(host.clientWidth * window.devicePixelRatio)),
            height: Math.max(1, Math.round(host.clientHeight * window.devicePixelRatio)),
        };
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
                unbind = bindViewport(created, sessionStore);
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
            canvas.remove();
        };
    }, []);

    return (
        <div className="viewport-area" ref={element} data-viewport="" data-status={status}>
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
