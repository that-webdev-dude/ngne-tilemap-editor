import { createStore } from "zustand/vanilla";
import { terrainAnalysis } from "../../../core/terrain";
import { sessionStore } from "../../state/session";
import { selectTerrain, selectedSet, terrainsPanelStore } from "../../terrains/terrainsPanel";
import { tilesetPanelStore } from "../../tilesets/panel/tilesetPanel";
import { provideBrushSource } from "./brushSource";
import type { BrushTerrain } from "./brushSource";

// The terrain set and terrain the terrain brush paints (SPEC §5.3, DESIGN §7). As Tiled's brush
// follows the terrain sets view (`WangDock`), the brush takes the set and terrain selected in
// the Terrains panel for the active tileset (`terrainsPanel.ts`); the context bar and right-click
// sampling change that selection. "Erase terrain" (terrain 0) is the brush's own choice on top
// of it, dropped when a terrain is selected again, in the panel or the context bar.

interface BrushTerrainState {
    /** The brush paints terrain 0, whatever terrain the panel has selected. */
    readonly erase: boolean;
}

const store = createStore<BrushTerrainState>(() => ({ erase: false }));

export type { BrushTerrain };

/** The set and terrain the brush paints; null when the active tileset has no terrain set. */
export function brushTerrain(): BrushTerrain | null {
    const selected = selectedSet();
    if (!selected) return null;
    const { tileset, set, selection } = selected;
    return {
        tileset,
        setIndex: selection.set,
        set,
        analysis: terrainAnalysis(set, tileset.slot),
        color: store.getState().erase ? 0 : selection.terrain,
    };
}

/** Makes set `setIndex` of the active tileset the brush's, with its first terrain. */
export function chooseBrushSet(setIndex: number): void {
    store.setState({ erase: false });
    selectTerrain(setIndex, 1);
}

/** Makes `color` the brush's terrain in its set: 0 erases. */
export function chooseBrushTerrain(color: number): void {
    const current = brushTerrain();
    if (!current) return;
    if (color === 0) {
        store.setState({ erase: true });
        return;
    }
    store.setState({ erase: false });
    selectTerrain(current.setIndex, color);
}

/** Calls `listener` whenever `brushTerrain` may have changed; returns the unsubscribe. */
export function subscribeBrushTerrain(listener: () => void): () => void {
    const stops = [
        store.subscribe(listener),
        terrainsPanelStore.subscribe(listener),
        tilesetPanelStore.subscribe(listener),
        sessionStore.subscribe(listener),
    ];
    return () => stops.forEach((stop) => stop());
}

// A terrain selected in the panel is painted again, not "Erase".
terrainsPanelStore.subscribe((state, previous) => {
    if (state.selections !== previous.selections && store.getState().erase) {
        store.setState({ erase: false });
    }
});

provideBrushSource({ current: brushTerrain, choose: chooseBrushTerrain });
