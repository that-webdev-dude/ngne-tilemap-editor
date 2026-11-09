import { useSyncExternalStore } from "react";
import {
    brushTerrain,
    chooseBrushSet,
    chooseBrushTerrain,
    subscribeBrushTerrain,
} from "../../app/tools/terrain/brushTerrain";
import { Select } from "../primitives/Select";
import "./terrainBrush.css";

// The terrain set and terrain pickers of the terrain brush (DESIGN §7): a select of the active
// tileset's sets and the terrain swatches (16 px chips with names, Erase first). The set and
// terrain are the Terrains panel's selection (`brushTerrain.ts`). Shown by the brush's context
// bar and by the fill tools' in Terrain mode (SPEC §5.4: the fill uses the set only).

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

/** The terrain set select and the terrain swatches. */
export function TerrainPickers() {
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
        </>
    );
}
