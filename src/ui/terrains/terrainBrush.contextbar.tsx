import { useSyncExternalStore } from "react";
import { toolState } from "../../app/tools/activeTool";
import { heldModifiers, subscribeHeldModifiers } from "../../app/tools/heldModifiers";
import {
    brushTerrain,
    chooseBrushSet,
    chooseBrushTerrain,
    subscribeBrushTerrain,
} from "../../app/tools/terrain/brushTerrain";
import { TERRAIN_TOOL_ID } from "../../app/tools/terrain/terrainBrush.tools";
import { Select } from "../primitives/Select";
import { Toggle } from "../primitives/Toggle";
import type { ContextBarContent } from "../tools/contextBarRegistry";
import "./terrainBrush.css";

// The terrain brush's context bar (DESIGN §7; TE-044): the terrain set (a select of the active
// tileset's sets), the terrain swatches (16 px chips with names, Erase first) and Full tile
// (Ctrl inverts it while held). The set and terrain are the Terrains panel's selection
// (`brushTerrain.ts`); Full tile is the tool's option. Registered as context bar content so it
// takes the options' place while the brush is active (contextBarRegistry.ts).

interface Snapshot {
    sets: { value: string; label: string }[];
    set: string;
    terrains: { color: number; name: string; rgba: string }[];
    color: number;
}

function snapshot(): string {
    const brush = brushTerrain();
    if (!brush) return "null";
    const value: Snapshot = {
        sets: brush.tileset.terrainSets.map((set, index) => ({
            value: String(index),
            label: set.name,
        })),
        set: String(brush.setIndex),
        terrains: brush.set.colors.map((terrain, index) => ({
            color: index + 1,
            name: terrain.name,
            rgba: terrain.color,
        })),
        color: brush.color,
    };
    return JSON.stringify(value);
}

/** `#rrggbbaa` as a CSS colour. */
const cssColour = (rgba: string) => (rgba.length === 9 ? rgba : `${rgba}ff`);

function Swatch({
    color,
    name,
    rgba,
    pressed,
}: {
    color: number;
    name: string;
    rgba: string | null;
    pressed: boolean;
}) {
    return (
        <button
            type="button"
            className="terrain-swatch"
            data-terrain-swatch={color}
            aria-pressed={pressed}
            onClick={() => chooseBrushTerrain(color)}
        >
            <span className="terrain-swatch__chip" aria-hidden="true">
                <span style={rgba ? { background: cssColour(rgba) } : undefined} />
            </span>
            <span className="terrain-swatch__name">{name}</span>
        </button>
    );
}

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
    const text = useSyncExternalStore(subscribeBrushTerrain, snapshot);
    const brush = JSON.parse(text) as Snapshot | null;
    return (
        <>
            <span data-terrain-brush-set="">
                {brush ? (
                    <Select
                        label="Terrain set"
                        value={brush.set}
                        onChange={(value) => chooseBrushSet(Number(value))}
                        options={brush.sets}
                    />
                ) : (
                    <Select
                        label="Terrain set"
                        value="none"
                        onChange={() => undefined}
                        options={[{ value: "none", label: "No terrain sets" }]}
                        disabled
                    />
                )}
            </span>
            {brush ? (
                <span className="terrain-swatches" role="group" aria-label="Terrain">
                    <Swatch color={0} name="Erase" rgba={null} pressed={brush.color === 0} />
                    {brush.terrains.map((terrain) => (
                        <Swatch
                            key={terrain.color}
                            color={terrain.color}
                            name={terrain.name}
                            rgba={terrain.rgba}
                            pressed={brush.color === terrain.color}
                        />
                    ))}
                </span>
            ) : null}
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
