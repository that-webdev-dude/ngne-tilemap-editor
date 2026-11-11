import { createStore } from "zustand/vanilla";

// The Preview section's choices (SPEC §12, DESIGN §8.4): game resolution, integer scale,
// play/pause and layer filter, and the diagnostics it lists. Plain settings of the window: no
// history entry, not saved with the project.

export interface PreviewResolution {
    readonly id: string;
    readonly width: number;
    readonly height: number;
}

/** The game resolutions of SPEC §12, in the order the select lists them. */
export const PREVIEW_RESOLUTIONS: readonly PreviewResolution[] = [
    { id: "320x180", width: 320, height: 180 },
    { id: "480x270", width: 480, height: 270 },
    { id: "640x360", width: 640, height: 360 },
    { id: "1280x720", width: 1280, height: 720 },
];

/** "fit": the largest scale that fits the stage; otherwise device pixels per game pixel. */
export type PreviewScale = "fit" | "1" | "2" | "3" | "4";

export const PREVIEW_SCALES: readonly PreviewScale[] = ["fit", "1", "2", "3", "4"];

/** "visible": every visible layer; "below": the active layer and the visible layers under it. */
export type PreviewLayers = "visible" | "below";

/** Diagnostics the section lists at most; older ones give way. */
export const SHOWN_DIAGNOSTICS = 5;

export interface PreviewState {
    resolution: string;
    scale: PreviewScale;
    playing: boolean;
    layers: PreviewLayers;
    diagnostics: readonly string[];
}

export const previewState = createStore<PreviewState>(() => ({
    // ENGINE §6: the typical pixel-art game.
    resolution: "480x270",
    scale: "fit",
    playing: true,
    layers: "visible",
    diagnostics: [],
}));

/** The resolution of `id`; the default one for an unknown ID. */
export function resolutionOf(id: string): PreviewResolution {
    return PREVIEW_RESOLUTIONS.find((each) => each.id === id) ?? PREVIEW_RESOLUTIONS[1]!;
}

/** Adds a diagnostic to the list (each message once, the newest `SHOWN_DIAGNOSTICS`). */
export function addPreviewDiagnostic(message: string): void {
    previewState.setState((state) =>
        state.diagnostics.includes(message)
            ? state
            : { diagnostics: [...state.diagnostics, message].slice(-SHOWN_DIAGNOSTICS) },
    );
}
