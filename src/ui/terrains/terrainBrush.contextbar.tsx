import { useSyncExternalStore } from "react";
import { toolState } from "../../app/tools/activeTool";
import { heldModifiers, subscribeHeldModifiers } from "../../app/tools/heldModifiers";
import { TERRAIN_TOOL_ID } from "../../app/tools/terrain/terrainBrush.tools";
import { Toggle } from "../primitives/Toggle";
import type { ContextBarContent } from "../tools/contextBarRegistry";
import { TerrainPickers } from "./TerrainPickers";

// The terrain brush's context bar (DESIGN §7; TE-044): the terrain set and terrain pickers
// (`TerrainPickers.tsx`) and Full tile (Ctrl inverts it while held). Full tile is the tool's
// option. Registered as context bar content so it takes the options' place while the brush is
// active (contextBarRegistry.ts).

/** Full tile as the brush paints now: the option, inverted while Ctrl is held (as Tiled shows it). */
function FullTile() {
    useSyncExternalStore(toolState.subscribe, toolState.version);
    const ctrl = useSyncExternalStore(subscribeHeldModifiers, () => heldModifiers().ctrl);
    const tool = toolState.registry.get(TERRAIN_TOOL_ID);
    if (!tool) return null;
    const option = toolState.options(tool).fullTile === true;
    return (
        <Toggle
            data-tool-option="fullTile"
            label="Full tile"
            pressed={option !== ctrl}
            onPressedChange={() => toolState.setOption(tool, "fullTile", !option)}
            showLabel
        />
    );
}

function TerrainBrushBar() {
    return (
        <>
            <TerrainPickers />
            <FullTile />
        </>
    );
}

export const contextBarContent: ContextBarContent = {
    id: "terrain-brush",
    order: 60,
    shown: () => toolState.kind() === "tile" && toolState.activeId() === TERRAIN_TOOL_ID,
    subscribe: (listener) => toolState.subscribe(listener),
    Body: TerrainBrushBar,
};
