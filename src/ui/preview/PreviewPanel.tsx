import { Pause, Play } from "lucide-react";
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { mountPreview } from "../../app/preview/mountPreview";
import { PREVIEW_RESOLUTIONS, PREVIEW_SCALES, previewState } from "../../app/preview/previewState";
import type { PreviewLayers, PreviewScale } from "../../app/preview/previewState";
import { useSession } from "../../app/state/session";
import { Icon, IconButton, Select } from "../primitives";
import "./preview.css";

// The Preview dock section (DESIGN §8.4; TE-056): the sprite editor's preview stage and row
// (`se-design` §5.5) with the controls of SPEC §12. The stage holds the NGNE game drawing the
// current map, centred and scaled by whole device pixels; under it the resolution, the scale,
// play/pause and the layer filter; NGNE and runtime diagnostics under the row in `--warn`. The
// game lives while the section is expanded: the dock mounts the body only then.

const RESOLUTION_OPTIONS = PREVIEW_RESOLUTIONS.map(({ id, width, height }) => ({
    value: id,
    label: `${width} × ${height}`,
}));

const SCALE_OPTIONS = PREVIEW_SCALES.map((scale) => ({
    value: scale,
    label: scale === "fit" ? "Fit" : `${scale}×`,
}));

const LAYER_OPTIONS: { value: PreviewLayers; label: string }[] = [
    { value: "visible", label: "All visible" },
    { value: "below", label: "This layer and below" },
];

export function PreviewPanel() {
    const stage = useRef<HTMLDivElement>(null);
    const host = useRef<HTMLDivElement>(null);
    const resolution = useStore(previewState, (state) => state.resolution);
    const scale = useStore(previewState, (state) => state.scale);
    const playing = useStore(previewState, (state) => state.playing);
    const layers = useStore(previewState, (state) => state.layers);
    const diagnostics = useStore(previewState, (state) => state.diagnostics);
    const hasMap = useSession(
        (state) =>
            state.open &&
            state.session.project.maps.some((map) => map.id === state.session.activeMapId),
    );

    useEffect(() => {
        if (!stage.current || !host.current) return;
        const mounted = mountPreview(stage.current, host.current);
        return () => mounted.dispose();
    }, []);

    return (
        <div className="preview-panel">
            <div ref={stage} className="preview-panel__stage">
                <div
                    ref={host}
                    className={hasMap ? "preview-panel__game" : "preview-panel__game is-hidden"}
                    aria-hidden="true"
                    data-preview-canvas=""
                />
            </div>
            <div className="preview-panel__controls">
                <Select
                    label="Preview resolution"
                    hideLabel
                    className="preview-panel__resolution"
                    value={resolution}
                    options={RESOLUTION_OPTIONS}
                    onChange={(value) => previewState.setState({ resolution: value })}
                />
                <Select
                    label="Preview scale"
                    hideLabel
                    className="preview-panel__scale"
                    value={scale}
                    options={SCALE_OPTIONS}
                    onChange={(value: PreviewScale) => previewState.setState({ scale: value })}
                />
                <IconButton
                    label={playing ? "Pause preview" : "Play preview"}
                    disabled={!hasMap}
                    onClick={() => previewState.setState({ playing: !playing })}
                >
                    <Icon icon={playing ? Pause : Play} />
                </IconButton>
                <Select
                    label="Preview layers"
                    hideLabel
                    className="preview-panel__layers"
                    value={layers}
                    options={LAYER_OPTIONS}
                    onChange={(value) => previewState.setState({ layers: value })}
                />
            </div>
            {diagnostics.length > 0 ? (
                <ul className="preview-panel__diagnostics" aria-label="Preview diagnostics">
                    {diagnostics.map((message) => (
                        <li key={message}>{message}</li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}
