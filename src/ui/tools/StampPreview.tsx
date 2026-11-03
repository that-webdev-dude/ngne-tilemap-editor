import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import { sessionStore } from "../../app/state/session";
import { currentStampStore } from "../../app/tools/stamp/currentStamp";
import { stampTool } from "../../app/tools/stamp/stamp.tools";
import { stampThumbnail } from "../../app/tools/stamp/stampImage";
import { activeMap } from "../../app/tools/toolSets";
import { Tooltip } from "../primitives/Tooltip";
import { useToolState } from "./useToolState";
import "./toolRail.css";

/** The side of the stamp preview in CSS pixels (DESIGN §2: up to 28 × 28). */
export const STAMP_PREVIEW_SIZE = 28;

/**
 * The stamp preview at the bottom of the tool rail (DESIGN §2): the current stamp scaled to fit
 * 28 × 28 px, nearest neighbour, on the rail's background; empty while there is no stamp. A
 * click selects the stamp brush, which a tile layer's tool set holds.
 */
export function StampPreview() {
    const tools = useToolState();
    const stamp = useSyncExternalStore(
        currentStampStore.subscribe,
        () => currentStampStore.getState().stamp,
    );
    const session = useStore(sessionStore, (state) => state.session);
    // Every change of the project (a tileset's pixels) draws it again.
    const revision = useStore(sessionStore, (state) => state.revision);
    const canvas = useRef<HTMLCanvasElement>(null);
    const map = activeMap(session);

    useLayoutEffect(() => {
        const target = canvas.current;
        if (!target) return;
        const ratio = window.devicePixelRatio || 1;
        // Inside the button's border: one backing pixel per device pixel.
        const side = Math.max(1, Math.round((target.clientWidth || STAMP_PREVIEW_SIZE) * ratio));
        target.width = side;
        target.height = side;
        const context = target.getContext("2d");
        if (!context || !stamp || !map) return;
        const image = stampThumbnail(session.project, map, stamp, side);
        context.putImageData(
            new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height),
            Math.floor((side - image.width) / 2),
            Math.floor((side - image.height) / 2),
        );
    }, [stamp, map, session, revision]);

    const size = stamp ? `${stamp.width} × ${stamp.height}` : "none";
    return (
        <Tooltip label={`Stamp ${size}`} side="right">
            <button
                type="button"
                className="tool-rail__stamp"
                data-stamp-preview=""
                aria-label={`Stamp preview, ${size}: select ${stampTool.label}`}
                disabled={!tools.offered(stampTool.id)}
                onClick={() => void tools.select(stampTool.id)}
            >
                <canvas ref={canvas} aria-hidden="true" />
            </button>
        </Tooltip>
    );
}
