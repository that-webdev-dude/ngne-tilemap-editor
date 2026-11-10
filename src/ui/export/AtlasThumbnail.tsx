import { useEffect, useRef } from "react";
import type { ExportPreviewAtlas } from "../../core/export";

/** The box the thumbnail fits in, in CSS pixels. */
const BOX = { width: 240, height: 160 };
/** Largest whole-number magnification of a small atlas. */
const MAX_ZOOM = 8;

/**
 * A packed tileset of the export with the outline of each rectangle (DESIGN §9, Export): the
 * PNG the export writes, decoded by the browser. A small image is magnified by a whole number,
 * nearest neighbour; a large one is fitted into the box.
 */
export function AtlasThumbnail({ atlas }: { atlas: ExportPreviewAtlas }) {
    const canvas = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        let cancelled = false;
        let bitmap: ImageBitmap | null = null;
        void createImageBitmap(new Blob([atlas.png], { type: "image/png" })).then(
            (decoded) => {
                // Unmounted, or another atlas shown, before the PNG was decoded.
                if (cancelled) {
                    decoded.close();
                    return;
                }
                bitmap = decoded;
                const context = canvas.current?.getContext("2d");
                if (!context) return;
                context.clearRect(0, 0, atlas.width, atlas.height);
                context.drawImage(decoded, 0, 0);
            },
            () => {
                // A PNG the browser cannot decode leaves the checkerboard; the export writes it
                // all the same.
            },
        );
        return () => {
            cancelled = true;
            bitmap?.close();
        };
    }, [atlas]);

    const fit = Math.min(BOX.width / atlas.width, BOX.height / atlas.height);
    const zoom = fit >= 1 ? Math.min(MAX_ZOOM, Math.floor(fit)) : fit;
    const width = atlas.width * zoom;
    const height = atlas.height * zoom;
    return (
        <figure className="export-atlas" data-export-atlas={atlas.name}>
            <div className="export-atlas__frame" style={{ width, height }}>
                <canvas
                    ref={canvas}
                    className="export-atlas__image"
                    width={atlas.width}
                    height={atlas.height}
                    style={{ width, height }}
                    role="img"
                    aria-label={`${atlas.name}.png, ${atlas.width} × ${atlas.height} px`}
                />
                <svg
                    className="export-atlas__rects"
                    viewBox={`0 0 ${atlas.width} ${atlas.height}`}
                    width={width}
                    height={height}
                    aria-hidden="true"
                >
                    {atlas.rects.map(({ x, y, w, h }) => (
                        <rect key={`${x},${y},${w},${h}`} x={x} y={y} width={w} height={h} />
                    ))}
                </svg>
            </div>
            <figcaption className="export-atlas__caption">
                {atlas.name}.png · {atlas.width} × {atlas.height} px
            </figcaption>
        </figure>
    );
}
