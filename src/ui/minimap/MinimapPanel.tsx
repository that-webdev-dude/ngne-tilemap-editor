import { useEffect, useRef } from "react";
import { mountMinimap } from "../../app/minimap/mountMinimap";
import "./minimap.css";

// The Minimap dock section (DESIGN §8.8; TE-057): the whole active map at the section's width,
// the viewport's rectangle as a 1 px `--accent` outline, and drag to pan. The dock mounts the
// body only while the section is expanded, so a collapse stops it.

export function MinimapPanel() {
    const box = useRef<HTMLDivElement>(null);
    const stage = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const frame = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!box.current || !stage.current || !canvas.current || !frame.current) return;
        const mounted = mountMinimap({
            box: box.current,
            stage: stage.current,
            canvas: canvas.current,
            frame: frame.current,
        });
        return () => mounted.dispose();
    }, []);

    return (
        <div ref={box} className="minimap-panel">
            <div ref={stage} className="minimap-panel__stage" hidden>
                <canvas
                    ref={canvas}
                    className="minimap-panel__image"
                    role="img"
                    aria-label="Minimap"
                />
                <div ref={frame} className="minimap-panel__frame" hidden />
            </div>
        </div>
    );
}
