import type { Command, Touched } from "../history";
import { MAX_TERRAINS, MAX_TERRAIN_SETS, MAX_TEXT_LENGTH } from "../model";
import type {
    Project,
    TerrainColor,
    TerrainSet,
    TerrainSetType,
    TerrainTile,
    Tileset,
} from "../model";
import { TerrainEditError } from "./errors";
import { WANG_INDEXES, typeUsesIndex } from "./wangId";
import type { WangIndex } from "./wangId";

// The terrain set commands of SPEC §5.1 (Terrains panel, DESIGN §8.6; TE-043): add, rename,
// remove and move terrain sets and terrains, a set's type, a terrain's colour and icon tile, and
// the terrain of one index, or every index, of a tile. As Tiled's (`changewangsetdata.cpp`,
// `changewangcolordata.cpp`, `changetilewangid.cpp`, tag v1.12.2):
//
// - A new set is "Unnamed Set" with one terrain (`TilesetEditor::addWangSet`); a new terrain
//   takes the next of Tiled's default colours (`defaultWangColors`, cycled past the 15th where
//   Tiled picks a random one, so a redo repeats the do). Tiled leaves its name empty; FORMAT
//   §2.4 wants one, so it is "Terrain n".
// - Removing a terrain clears it from every tile and moves the terrains after it down one
//   (`ChangeTileWangId::changesOnRemoveColor`). The last terrain of a set is not removed: a set
//   has 1 to 254 (FORMAT §2.4).
// - A type change clears, in the same entry, every index the new type does not use (SPEC §5.1).
// - A tile whose terrains are all 0 leaves the set (`WangSet::setWangId`).
//
// Every command replaces `Tileset.terrainSets` and each set it changes with new arrays and
// objects, never changing one in place, so `terrainAnalysis` sees the change and undo puts the
// old array back as it was. Terrain is not drawn by the viewport's tiers, so `touched` names
// nothing (as the collision commands); the panel repaints with the history's steps.

/** Labels of the history entries (Tiled's, "Colour" spelt as the suite spells it). */
export const TERRAIN_LABELS = {
    addSet: "Add Terrain Set",
    removeSet: "Remove Terrain Set",
    renameSet: "Change Terrain Set Name",
    moveSetUp: "Move Terrain Set Up",
    moveSetDown: "Move Terrain Set Down",
    setType: "Change Terrain Set Type",
    addTerrain: "Add Terrain",
    removeTerrain: "Remove Terrain",
    renameTerrain: "Change Terrain Name",
    colour: "Change Terrain Colour",
    icon: "Change Terrain Icon",
    moveTerrainUp: "Move Terrain Up",
    moveTerrainDown: "Move Terrain Down",
    tile: "Change Tile Terrain",
} as const;

/** The name of a new terrain set (Tiled's "Unnamed Set"). */
export const NEW_TERRAIN_SET_NAME = "Unnamed Set";

/**
 * Tiled's `defaultWangColors` (`src/libtiled/wangset.cpp`), opaque, as `#rrggbbaa`.
 * From libtiled (BSD 2-clause licence): see public/THIRD-PARTY-NOTICES.txt.
 */
export const DEFAULT_TERRAIN_COLOURS: readonly string[] = [
    "#ff0000ff",
    "#00ff00ff",
    "#0000ffff",
    "#ff7700ff",
    "#00e9ffff",
    "#ff00d8ff",
    "#ffff00ff",
    "#a000ffff",
    "#00ffa1ff",
    "#ffa8a8ff",
    "#b4a8ffff",
    "#96ffa7ff",
    "#8e7848ff",
    "#5a5a5aff",
    "#0e7a46ff",
];

/** The colour of new terrain `n` (1-based): Tiled's default list, cycled. */
export function defaultTerrainColour(n: number): string {
    return DEFAULT_TERRAIN_COLOURS[(n - 1) % DEFAULT_TERRAIN_COLOURS.length]!;
}

/** The name of new terrain `n` (1-based). */
export const defaultTerrainName = (n: number): string => `Terrain ${n}`;

const COLOUR_PATTERN = /^#[0-9a-fA-F]{8}$/;

/** Bytes a command claims besides the sets it holds. */
const OVERHEAD_BYTES = 256;
const SET_BYTES = 128;
const COLOUR_BYTES = 96;
const TILE_BYTES = 64;

function nothingTouched(): Touched {
    return { mapId: null, layerIds: [], cellRects: [], tilesetIds: [], structure: false };
}

function setBytes(set: TerrainSet): number {
    return SET_BYTES + set.colors.length * COLOUR_BYTES + set.tiles.length * TILE_BYTES;
}

/** Memory of the sets one of the two lists holds and the other does not. */
function changedBytes(before: readonly TerrainSet[], after: readonly TerrainSet[]): number {
    const kept = new Set(before);
    const now = new Set(after);
    let bytes = 0;
    for (const set of before) if (!now.has(set)) bytes += setBytes(set);
    for (const set of after) if (!kept.has(set)) bytes += setBytes(set);
    return bytes;
}

function tilesetOf(project: Project, id: string): Tileset {
    const tileset = project.tilesets.find((each) => each.id === id);
    if (!tileset) throw new TerrainEditError("not-found", `No tileset has the ID ${id}.`);
    return tileset;
}

function setAt(tileset: Tileset, setIndex: number): TerrainSet {
    const set = tileset.terrainSets[setIndex];
    if (!set) {
        throw new TerrainEditError(
            "not-found",
            `“${tileset.name}” has no terrain set ${setIndex}.`,
        );
    }
    return set;
}

function checkTerrain(set: TerrainSet, terrain: number, zeroAllowed: boolean): void {
    const ok =
        Number.isInteger(terrain) &&
        terrain >= (zeroAllowed ? 0 : 1) &&
        terrain <= set.colors.length;
    if (!ok) throw new TerrainEditError("terrain", `“${set.name}” has no terrain ${terrain}.`);
}

function checkTile(tileset: Tileset, tileId: number): void {
    if (!tileset.tiles.some((tile) => tile.id === tileId)) {
        throw new TerrainEditError(
            "not-found",
            `“${tileset.name}” has no tile with the ID ${tileId}.`,
        );
    }
}

/** Why `name` cannot be the name of a terrain set or terrain; null when it can. */
export function terrainNameProblem(name: string): string | null {
    if (name.trim() === "") return "Enter a name.";
    if (name.length > MAX_TEXT_LENGTH) return `A name has at most ${MAX_TEXT_LENGTH} characters.`;
    return null;
}

function checkName(name: string): void {
    const problem = terrainNameProblem(name);
    if (problem !== null) throw new TerrainEditError("name", problem);
}

/** `sets` with set `index` replaced by `edit` of it. */
function withSet(
    sets: readonly TerrainSet[],
    index: number,
    edit: (set: TerrainSet) => TerrainSet,
): TerrainSet[] {
    return sets.map((set, k) => (k === index ? edit(set) : set));
}

/** The tiles of a set after `wangIdOf` maps each WangId; tiles left with no terrain leave. */
function mapTiles(
    tiles: readonly TerrainTile[],
    wangIdOf: (wangId: readonly number[]) => number[],
): TerrainTile[] {
    const out: TerrainTile[] = [];
    for (const tile of tiles) {
        const wangId = wangIdOf(tile.wangId);
        if (wangId.some((color) => color !== 0)) out.push({ tile: tile.tile, wangId });
    }
    return out;
}

/**
 * A command that replaces the terrain sets of tileset `tilesetId` with `edit` of them. `edit`
 * throws `TerrainEditError` to refuse, before anything changes.
 */
function terrainSetsCommand(
    label: string,
    tilesetId: string,
    edit: (sets: readonly TerrainSet[], tileset: Tileset) => TerrainSet[],
): Command {
    let before: TerrainSet[] | null = null;
    let bytes = OVERHEAD_BYTES;
    return {
        label,
        get bytes() {
            return bytes;
        },
        touched: nothingTouched(),
        do(session) {
            const tileset = tilesetOf(session.project, tilesetId);
            const after = edit(tileset.terrainSets, tileset);
            before = tileset.terrainSets;
            bytes = OVERHEAD_BYTES + changedBytes(before, after);
            tileset.terrainSets = after;
        },
        undo(session) {
            if (before === null) throw new Error("A terrain command is undone before it was done.");
            tilesetOf(session.project, tilesetId).terrainSets = before;
        },
    };
}

/** Adds a terrain set of `type`, "Unnamed Set" with one terrain, at the end of the list. */
export function addTerrainSetCommand(tilesetId: string, type: TerrainSetType): Command {
    return terrainSetsCommand(TERRAIN_LABELS.addSet, tilesetId, (sets, tileset) => {
        if (sets.length >= MAX_TERRAIN_SETS) {
            throw new TerrainEditError(
                "limit",
                `“${tileset.name}” has ${MAX_TERRAIN_SETS} terrain sets, the most a tileset has.`,
            );
        }
        const terrain: TerrainColor = {
            name: defaultTerrainName(1),
            color: defaultTerrainColour(1),
            tile: null,
        };
        return [...sets, { name: NEW_TERRAIN_SET_NAME, type, colors: [terrain], tiles: [] }];
    });
}

/** Removes terrain set `setIndex`, with every terrain and tile assignment it holds. */
export function removeTerrainSetCommand(tilesetId: string, setIndex: number): Command {
    return terrainSetsCommand(TERRAIN_LABELS.removeSet, tilesetId, (sets, tileset) => {
        setAt(tileset, setIndex);
        return sets.filter((_, k) => k !== setIndex);
    });
}

/** Renames terrain set `setIndex`; null when it has that name. */
export function renameTerrainSetCommand(
    project: Project,
    tilesetId: string,
    setIndex: number,
    name: string,
): Command | null {
    if (setAt(tilesetOf(project, tilesetId), setIndex).name === name) return null;
    return terrainSetsCommand(TERRAIN_LABELS.renameSet, tilesetId, (sets, tileset) => {
        setAt(tileset, setIndex);
        checkName(name);
        return withSet(sets, setIndex, (set) => ({ ...set, name }));
    });
}

/** Moves terrain set `setIndex` one place up (−1) or down (+1) the list. */
export function moveTerrainSetCommand(tilesetId: string, setIndex: number, delta: -1 | 1): Command {
    const label = delta < 0 ? TERRAIN_LABELS.moveSetUp : TERRAIN_LABELS.moveSetDown;
    return terrainSetsCommand(label, tilesetId, (sets, tileset) => {
        setAt(tileset, setIndex);
        const to = setIndex + delta;
        if (to < 0 || to >= sets.length) {
            throw new TerrainEditError("move", "The terrain set is at the end of the list.");
        }
        const out = [...sets];
        out[setIndex] = sets[to]!;
        out[to] = sets[setIndex]!;
        return out;
    });
}

/**
 * Changes the type of terrain set `setIndex`, clearing in the same entry every index the new
 * type does not use (SPEC §5.1); null when the set has that type.
 */
export function setTerrainSetTypeCommand(
    project: Project,
    tilesetId: string,
    setIndex: number,
    type: TerrainSetType,
): Command | null {
    if (setAt(tilesetOf(project, tilesetId), setIndex).type === type) return null;
    return terrainSetsCommand(TERRAIN_LABELS.setType, tilesetId, (sets, tileset) => {
        setAt(tileset, setIndex);
        return withSet(sets, setIndex, (set) => ({
            ...set,
            type,
            tiles: mapTiles(set.tiles, (wangId) =>
                wangId.map((color, index) => (typeUsesIndex(type, index) ? color : 0)),
            ),
        }));
    });
}

/** Adds a terrain at the end of set `setIndex`: "Terrain n" in the next default colour. */
export function addTerrainCommand(tilesetId: string, setIndex: number): Command {
    return terrainSetsCommand(TERRAIN_LABELS.addTerrain, tilesetId, (sets, tileset) => {
        const set = setAt(tileset, setIndex);
        if (set.colors.length >= MAX_TERRAINS) {
            throw new TerrainEditError(
                "limit",
                `“${set.name}” has ${MAX_TERRAINS} terrains, the most a terrain set has.`,
            );
        }
        const n = set.colors.length + 1;
        const terrain: TerrainColor = {
            name: defaultTerrainName(n),
            color: defaultTerrainColour(n),
            tile: null,
        };
        return withSet(sets, setIndex, (each) => ({ ...each, colors: [...each.colors, terrain] }));
    });
}

/**
 * Removes terrain `terrain` (1-based) of set `setIndex`: indexes with it become 0, the terrains
 * after it move down one, tiles left with no terrain leave the set. Refused for the set's only
 * terrain.
 */
export function removeTerrainCommand(
    tilesetId: string,
    setIndex: number,
    terrain: number,
): Command {
    return terrainSetsCommand(TERRAIN_LABELS.removeTerrain, tilesetId, (sets, tileset) => {
        const set = setAt(tileset, setIndex);
        checkTerrain(set, terrain, false);
        if (set.colors.length === 1) {
            throw new TerrainEditError(
                "last-terrain",
                `“${set.colors[0]!.name}” is the only terrain of “${set.name}”; a terrain set has at least one.`,
            );
        }
        return withSet(sets, setIndex, (each) => ({
            ...each,
            colors: each.colors.filter((_, k) => k !== terrain - 1),
            tiles: mapTiles(each.tiles, (wangId) =>
                wangId.map((color) =>
                    color === terrain ? 0 : color > terrain ? color - 1 : color,
                ),
            ),
        }));
    });
}

/** Moves terrain `terrain` of set `setIndex` one place up (−1) or down (+1), with its indexes. */
export function moveTerrainCommand(
    tilesetId: string,
    setIndex: number,
    terrain: number,
    delta: -1 | 1,
): Command {
    const label = delta < 0 ? TERRAIN_LABELS.moveTerrainUp : TERRAIN_LABELS.moveTerrainDown;
    return terrainSetsCommand(label, tilesetId, (sets, tileset) => {
        const set = setAt(tileset, setIndex);
        checkTerrain(set, terrain, false);
        const other = terrain + delta;
        if (other < 1 || other > set.colors.length) {
            throw new TerrainEditError("move", "The terrain is at the end of the list.");
        }
        const swap = (color: number) =>
            color === terrain ? other : color === other ? terrain : color;
        return withSet(sets, setIndex, (each) => {
            const colors = [...each.colors];
            colors[terrain - 1] = each.colors[other - 1]!;
            colors[other - 1] = each.colors[terrain - 1]!;
            return {
                ...each,
                colors,
                tiles: each.tiles.map((tile) => ({
                    tile: tile.tile,
                    wangId: tile.wangId.map(swap),
                })),
            };
        });
    });
}

/** The fields of a terrain the panel edits. */
export interface TerrainFields {
    name: string;
    /** `#rrggbbaa`. */
    color: string;
    /** Icon: the `id` of a tile of the tileset, or none. */
    tile: number | null;
}

/**
 * Sets one field of terrain `terrain` of set `setIndex`; null when it has that value. Refused
 * for a blank name, a colour that is no `#rrggbbaa`, or an icon naming no tile of the tileset.
 */
export function setTerrainFieldCommand<Key extends keyof TerrainFields>(
    project: Project,
    tilesetId: string,
    setIndex: number,
    terrain: number,
    key: Key,
    value: TerrainFields[Key],
): Command | null {
    const current = setAt(tilesetOf(project, tilesetId), setIndex);
    checkTerrain(current, terrain, false);
    if (current.colors[terrain - 1]![key] === value) return null;
    const label =
        key === "name"
            ? TERRAIN_LABELS.renameTerrain
            : key === "color"
              ? TERRAIN_LABELS.colour
              : TERRAIN_LABELS.icon;
    return terrainSetsCommand(label, tilesetId, (sets, tileset) => {
        const set = setAt(tileset, setIndex);
        checkTerrain(set, terrain, false);
        if (key === "name") checkName(value as string);
        if (key === "color" && !COLOUR_PATTERN.test(value as string)) {
            throw new TerrainEditError("colour", `“${String(value)}” is no #rrggbbaa colour.`);
        }
        if (key === "tile" && value !== null) checkTile(tileset, value as number);
        return withSet(sets, setIndex, (each) => ({
            ...each,
            colors: each.colors.map((color, k) =>
                k === terrain - 1 ? { ...color, [key]: value } : color,
            ),
        }));
    });
}

/** Where a terrain assignment goes: one index of a tile, or every index the set's type uses. */
export type TerrainTarget = WangIndex | "tile";

/** The WangId tile `tileId` has in `set`: its entry's, else all 0. */
export function tileWangId(set: TerrainSet, tileId: number): number[] {
    const entry = set.tiles.find((tile) => tile.tile === tileId);
    return entry ? [...entry.wangId] : new Array<number>(WANG_INDEXES).fill(0);
}

/** `wangId` with `terrain` at `target`: one index, or every index of the set's type. */
function assigned(
    type: TerrainSetType,
    wangId: readonly number[],
    target: TerrainTarget,
    terrain: number,
) {
    return wangId.map((color, index) =>
        target === "tile"
            ? typeUsesIndex(type, index)
                ? terrain
                : 0
            : index === target
              ? terrain
              : color,
    );
}

/**
 * Sets terrain `terrain` (0 clears) at `target` of tile `tileId` in set `setIndex` (SPEC §5.1:
 * a click assigns an index, a right click clears it, Shift assigns the whole tile); null when
 * the tile has it there already. Refused for an index the set's type does not use.
 */
export function assignTerrainCommand(
    project: Project,
    tilesetId: string,
    setIndex: number,
    tileId: number,
    target: TerrainTarget,
    terrain: number,
): Command | null {
    const tileset = tilesetOf(project, tilesetId);
    const current = setAt(tileset, setIndex);
    checkTile(tileset, tileId);
    checkTerrain(current, terrain, true);
    if (target !== "tile" && !typeUsesIndex(current.type, target)) {
        throw new TerrainEditError(
            "index",
            `A ${current.type} set has no terrain at index ${target}.`,
        );
    }
    const before = tileWangId(current, tileId);
    const after = assigned(current.type, before, target, terrain);
    if (after.every((color, index) => color === before[index])) return null;
    return terrainSetsCommand(TERRAIN_LABELS.tile, tilesetId, (sets, each) => {
        const set = setAt(each, setIndex);
        checkTile(each, tileId);
        checkTerrain(set, terrain, true);
        if (target !== "tile" && !typeUsesIndex(set.type, target)) {
            throw new TerrainEditError(
                "index",
                `A ${set.type} set has no terrain at index ${target}.`,
            );
        }
        const wangId = assigned(set.type, tileWangId(set, tileId), target, terrain);
        const empty = wangId.every((color) => color === 0);
        const at = set.tiles.findIndex((tile) => tile.tile === tileId);
        let tiles: TerrainTile[];
        if (at === -1) tiles = empty ? set.tiles : [...set.tiles, { tile: tileId, wangId }];
        else if (empty) tiles = set.tiles.filter((_, k) => k !== at);
        else tiles = set.tiles.map((tile, k) => (k === at ? { tile: tileId, wangId } : tile));
        return withSet(sets, setIndex, (s) => ({ ...s, tiles }));
    });
}
