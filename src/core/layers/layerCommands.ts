import { CELL_INDEX_MASK, CHUNK_BITS, CHUNK_SIZE, CellStore } from "../cells";
import type { Command, Touched } from "../history";
import {
    BYTES_PER_CHUNK,
    MAX_CELLS_PER_MAP,
    MAX_GROUP_DEPTH,
    MAX_LAYERS,
    MAX_LAYER_ID,
    MAX_LAYER_OFFSET,
    MAX_MARKERS,
    MAX_MARKER_ID,
    MAX_MARKER_POINTS,
    MAX_PARALLAX,
    MAX_TEXT_LENGTH,
    createGroupLayer,
    createMapSession,
    createMarkerLayer,
    createTileLayer,
    effectiveValues,
    findLayer,
    walkLayers,
} from "../model";
import type {
    GroupLayer,
    Layer,
    MapSession,
    Marker,
    Project,
    ProjectMap,
    ProjectSession,
} from "../model";

// The layer commands of SPEC §7.2, with Tiled's behaviour (`MapDocument`, `MoveLayer`,
// `LayerModel`, tag v1.12.2): New Tile / Marker Layer and New Group above the active layer,
// Group Layers, Ungroup, Duplicate (new IDs for the layers and their markers), Delete, Rename,
// Move Up / Down into and out of groups, a move to any place (a drag), and the setters of a
// layer's values, one layer or several (Show/Hide and Lock/Unlock Other Layers).
//
// A command that changes the tree checks it against the map as it is at its first `do` and
// throws `LayerEditError` with the map unchanged: past 256 layers or 16 group levels, an
// effective offset or parallax out of range (FORMAT §2.5, §2.8), or a map left without a
// layer. Its first `do` records the lists of the tree before and after; undo and redo put
// them back, so a redo repeats exactly the change the first `do` made (IDs included).
//
// Layer IDs come from the map's `nextLayerId`, marker IDs from `nextMarkerId`; neither ever
// gives an ID twice: undo and redo leave each counter at the highest value it has had, as in
// Tiled, so a layer or marker added after an undo never takes an ID that a layer or marker had
// before (it may be in a saved file or an export).
//
// The active layer is session state that the commands set and restore (SPEC §3): a new or
// duplicated layer becomes active; Delete and Ungroup pass it on to the row that takes the
// removed layer's place in the Layers panel (Qt's current row after a removal: the next row
// below, else the one above, else the parent).

export type LayerEditErrorCode =
    /** The command names a map or layer that does not exist. */
    | "missing"
    /** The map would hold more than 256 layers, groups more than 16 deep, or too many IDs, markers or cells. */
    | "limit"
    /** A layer's own or effective offset or parallax would leave its range (FORMAT §2.5). */
    | "range"
    /** A value out of its range: name or class length, opacity, offset, parallax. */
    | "values"
    /** The map would be left without a layer. */
    | "last"
    /** A move past the ends of the tree, into the layer itself, or to the place it holds. */
    | "move";

export class LayerEditError extends Error {
    override readonly name = "LayerEditError";
    readonly code: LayerEditErrorCode;

    constructor(code: LayerEditErrorCode, message: string) {
        super(message);
        this.code = code;
    }
}

/** Labels of the history entries. */
export const LAYER_LABELS = {
    newTile: "New Tile Layer",
    newMarker: "New Marker Layer",
    newGroup: "New Group",
    group: "Group Layers",
    ungroup: "Ungroup",
    duplicate: "Duplicate Layer",
    delete: "Delete Layer",
    rename: "Rename Layer",
    moveUp: "Move Layer Up",
    moveDown: "Move Layer Down",
    move: "Move Layer",
    show: "Show Layer",
    hide: "Hide Layer",
    lock: "Lock Layer",
    unlock: "Unlock Layer",
    opacity: "Layer Opacity",
    offset: "Layer Offset",
    parallax: "Layer Parallax",
    class: "Layer Class",
    values: "Layer Properties",
    showOthers: "Show Other Layers",
    hideOthers: "Hide Other Layers",
    lockOthers: "Lock Other Layers",
    unlockOthers: "Unlock Other Layers",
} as const;

/** The kinds New Layer makes here; image layers are TE-036's. */
export type NewLayerKind = "tile" | "marker" | "group";

/** The values a layer setter changes (SPEC §7.2); every field is optional. */
export interface LayerValues {
    name: string;
    class: string;
    visible: boolean;
    locked: boolean;
    /** 0..255. */
    opacity: number;
    offsetX: number;
    offsetY: number;
    parallaxX: number;
    parallaxY: number;
}

export const LAYER_VALUE_KEYS = [
    "name",
    "class",
    "visible",
    "locked",
    "opacity",
    "offsetX",
    "offsetY",
    "parallaxX",
    "parallaxY",
] as const satisfies readonly (keyof LayerValues)[];

/** Bytes a command claims besides the cells it holds. */
const OVERHEAD_BYTES = 256;

/** A `touched` record, written out rather than taken from `core/history` (see mapCommands.ts). */
function touched(mapId: string, parts: Partial<Touched> = {}): Touched {
    return { mapId, layerIds: [], cellRects: [], tilesetIds: [], structure: false, ...parts };
}

function quoted(text: string): string {
    return `“${text}”`;
}

function mapOf(project: Project, id: string): ProjectMap {
    const map = project.maps.find((each) => each.id === id);
    if (!map) throw new LayerEditError("missing", `The project has no map "${id}".`);
    return map;
}

/** Where a layer sits: the list that holds it, the group that owns the list, its index. */
export interface LayerPlace {
    layer: Layer;
    ancestors: GroupLayer[];
    /** The group holding the layer; null at the top of the map. */
    parent: GroupLayer | null;
    list: Layer[];
    index: number;
}

/** The place of layer `id` in `map`; throws `LayerEditError` ("missing") without one. */
export function placeOf(map: ProjectMap, id: number): LayerPlace {
    const entry = findLayer(map, id);
    if (!entry) throw new LayerEditError("missing", `The map has no layer ${id}.`);
    const parent = entry.ancestors.at(-1) ?? null;
    const list = parent ? parent.layers : map.layers;
    return { ...entry, parent, list, index: list.indexOf(entry.layer) };
}

/** The session of map `map`, made when the map has none yet. */
function mapSessionOf(session: ProjectSession, map: ProjectMap): MapSession {
    let mapSession = session.perMap.get(map.id);
    if (!mapSession) {
        mapSession = createMapSession(map);
        session.perMap.set(map.id, mapSession);
    }
    return mapSession;
}

// ---------------------------------------------------------------------------------------------
// Tree order

/**
 * The layers of the tree in Tiled's `LayerIterator` order, bottom to top: a group comes right
 * after its children. Select Layer Above and Below step through it.
 */
export function layerOrder(layers: readonly Layer[]): Layer[] {
    const out: Layer[] = [];
    for (const layer of layers) {
        if (layer.type === "group") out.push(...layerOrder(layer.layers));
        out.push(layer);
    }
    return out;
}

/**
 * The layer above (`1`) or below (`-1`) layer `id` in `layerOrder`, as Tiled's Select Next and
 * Previous Layer; null at either end or for an unknown layer.
 */
export function adjacentLayer(map: ProjectMap, id: number, step: -1 | 1): Layer | null {
    const order = layerOrder(map.layers);
    const index = order.findIndex((layer) => layer.id === id);
    if (index < 0) return null;
    return order[index + step] ?? null;
}

/**
 * The layers Show/Hide and Lock/Unlock Other Layers change for `ids` (Tiled's
 * `collectAllSiblings`): the siblings of each layer and of each of its groups, without the
 * layers themselves and their groups. The children of a sibling group are not among them (the
 * group's value covers them).
 */
export function otherLayers(map: ProjectMap, ids: readonly number[]): Layer[] {
    const collected = new Set<Layer>();
    const excluded = new Set<Layer>();
    for (const id of ids) {
        const entry = findLayer(map, id);
        if (!entry) continue;
        const chain = [...entry.ancestors, entry.layer];
        for (const node of chain) excluded.add(node);
        let list = map.layers;
        for (const node of chain) {
            for (const sibling of list) collected.add(sibling);
            if (node.type === "group") list = node.layers;
        }
    }
    for (const layer of excluded) collected.delete(layer);
    // In tree order, so the history entry and tests see a stable list.
    return [...walkLayers(map.layers)]
        .map((entry) => entry.layer)
        .filter((layer) => collected.has(layer));
}

// ---------------------------------------------------------------------------------------------
// Names

const KIND_NAMES: Record<NewLayerKind, string> = {
    tile: "Tile Layer",
    marker: "Marker Layer",
    group: "Group Layer",
};

/**
 * The name New Layer gives a layer of `kind`, as Tiled's `newLayerName`: "<Kind> N" with N one
 * above the count of layers of that kind, raised past names already taken.
 */
export function newLayerName(map: ProjectMap, kind: NewLayerKind): string {
    const names = new Set<string>();
    let number = 0;
    for (const { layer } of walkLayers(map.layers)) {
        if (layer.type !== kind) continue;
        number += 1;
        names.add(layer.name);
    }
    let name: string;
    do name = `${KIND_NAMES[kind]} ${++number}`;
    while (names.has(name));
    return name;
}

/** The name Group Layers gives the group, as Tiled: "Group N", N one above the groups' count. */
export function groupName(map: ProjectMap): string {
    let groups = 0;
    for (const { layer } of walkLayers(map.layers)) if (layer.type === "group") groups += 1;
    return `Group ${groups + 1}`;
}

// ---------------------------------------------------------------------------------------------
// Checks

/** Why `name` cannot be a layer's name; null when it can. Names may be empty and repeat. */
export function layerNameProblem(name: string): string | null {
    if (name.length > MAX_TEXT_LENGTH) {
        return `A layer name has at most ${MAX_TEXT_LENGTH} characters.`;
    }
    return null;
}

function isInt(value: number, min: number, max: number): boolean {
    return Number.isInteger(value) && value >= min && value <= max;
}

function isNum(value: number, min: number, max: number): boolean {
    return Number.isFinite(value) && value >= min && value <= max;
}

/** Why `values` cannot be set on a layer (FORMAT §2.5), by field; empty when they can. */
export function layerValueProblems(
    values: Partial<LayerValues>,
): Partial<Record<keyof LayerValues, string>> {
    const problems: Partial<Record<keyof LayerValues, string>> = {};
    if (values.name !== undefined) {
        const problem = layerNameProblem(values.name);
        if (problem) problems.name = problem;
    }
    if (values.class !== undefined && values.class.length > MAX_TEXT_LENGTH) {
        problems.class = `A class has at most ${MAX_TEXT_LENGTH} characters.`;
    }
    for (const key of ["visible", "locked"] as const) {
        if (values[key] !== undefined && typeof values[key] !== "boolean") {
            problems[key] = `${key} is true or false.`;
        }
    }
    if (values.opacity !== undefined && !isInt(values.opacity, 0, 255)) {
        problems.opacity = "The opacity is a whole number from 0 to 255.";
    }
    for (const key of ["offsetX", "offsetY"] as const) {
        const value = values[key];
        if (value !== undefined && !isInt(value, -MAX_LAYER_OFFSET, MAX_LAYER_OFFSET)) {
            problems[key] =
                `An offset is a whole number of pixels from −${MAX_LAYER_OFFSET.toLocaleString("en")} ` +
                `to ${MAX_LAYER_OFFSET.toLocaleString("en")}.`;
        }
    }
    for (const key of ["parallaxX", "parallaxY"] as const) {
        const value = values[key];
        if (value !== undefined && !isNum(value, -MAX_PARALLAX, MAX_PARALLAX)) {
            problems[key] =
                `A parallax factor is a number from −${MAX_PARALLAX} to ${MAX_PARALLAX}.`;
        }
    }
    return problems;
}

/**
 * Throws `LayerEditError` when `map`'s tree breaks a limit a layer command can reach: no layer
 * ("last"); more than 256 layers or groups more than 16 deep, `nextLayerId` or `nextMarkerId`
 * past their range, too many markers, points or cells ("limit"); an effective offset or
 * parallax out of range ("range").
 */
export function checkLayerTree(map: ProjectMap): void {
    const entries = [...walkLayers(map.layers)];
    if (entries.length === 0) {
        throw new LayerEditError("last", "A map keeps at least one layer.");
    }
    if (entries.length > MAX_LAYERS) {
        throw new LayerEditError("limit", `A map holds at most ${MAX_LAYERS} layers.`);
    }
    if (map.nextLayerId > MAX_LAYER_ID) {
        throw new LayerEditError("limit", "The map has used up its layer IDs.");
    }
    if (map.nextMarkerId > MAX_MARKER_ID) {
        throw new LayerEditError("limit", "The map has used up its marker IDs.");
    }
    let cells = 0;
    let markers = 0;
    let points = 0;
    for (const { layer, ancestors } of entries) {
        if (layer.type === "group" && ancestors.length + 1 > MAX_GROUP_DEPTH) {
            throw new LayerEditError(
                "limit",
                `Groups nest at most ${MAX_GROUP_DEPTH} levels deep.`,
            );
        }
        const values = effectiveValues(layer, ancestors);
        if (
            !isNum(values.offsetX, -MAX_LAYER_OFFSET, MAX_LAYER_OFFSET) ||
            !isNum(values.offsetY, -MAX_LAYER_OFFSET, MAX_LAYER_OFFSET) ||
            !isNum(values.parallaxX, -MAX_PARALLAX, MAX_PARALLAX) ||
            !isNum(values.parallaxY, -MAX_PARALLAX, MAX_PARALLAX)
        ) {
            throw new LayerEditError(
                "range",
                `${quoted(layer.name)} would be drawn with an offset or parallax out of range: ` +
                    `offsets add up to at most ±${MAX_LAYER_OFFSET.toLocaleString("en")} px and ` +
                    `parallax factors multiply to at most ±${MAX_PARALLAX}.`,
            );
        }
        if (layer.type === "tile") cells += layer.cells.count;
        if (layer.type === "marker") {
            markers += layer.markers.length;
            for (const marker of layer.markers) {
                if (marker.shape === "polygon" || marker.shape === "polyline") {
                    points += marker.points.length;
                }
            }
        }
    }
    if (cells > MAX_CELLS_PER_MAP) {
        throw new LayerEditError(
            "limit",
            `A map's tile layers hold at most ${MAX_CELLS_PER_MAP.toLocaleString("en")} cells.`,
        );
    }
    if (markers > MAX_MARKERS || points > MAX_MARKER_POINTS) {
        throw new LayerEditError(
            "limit",
            `A map holds at most ${MAX_MARKERS.toLocaleString("en")} markers with ` +
                `${MAX_MARKER_POINTS.toLocaleString("en")} points.`,
        );
    }
}

// ---------------------------------------------------------------------------------------------
// Tree commands

/** The lists of a tree, its counters and the session state the tree commands change. */
interface TreeState {
    lists: Map<Layer[], Layer[]>;
    nextLayerId: number;
    nextMarkerId: number;
    activeLayerId: number;
    markerSelection: number[];
}

/** The lists of the tree: the map's and each group's. */
function treeLists(map: ProjectMap): Layer[][] {
    const lists = [map.layers];
    for (const { layer } of walkLayers(map.layers)) {
        if (layer.type === "group") lists.push(layer.layers);
    }
    return lists;
}

function capture(map: ProjectMap, mapSession: MapSession, also: Iterable<Layer[]> = []): TreeState {
    const lists = new Map<Layer[], Layer[]>();
    for (const list of [...treeLists(map), ...also]) lists.set(list, [...list]);
    return {
        lists,
        nextLayerId: map.nextLayerId,
        nextMarkerId: map.nextMarkerId,
        activeLayerId: mapSession.activeLayerId,
        markerSelection: [...mapSession.markerSelection],
    };
}

/**
 * Puts the tree and session state of `state` back. With `exact` the counters go back too (a
 * refused edit, which gave out no ID); otherwise they never go down (undo, redo).
 */
function restore(map: ProjectMap, mapSession: MapSession, state: TreeState, exact = false): void {
    for (const [list, content] of state.lists) list.splice(0, list.length, ...content);
    map.nextLayerId = exact ? state.nextLayerId : Math.max(map.nextLayerId, state.nextLayerId);
    map.nextMarkerId = exact ? state.nextMarkerId : Math.max(map.nextMarkerId, state.nextMarkerId);
    mapSession.activeLayerId = state.activeLayerId;
    mapSession.markerSelection = [...state.markerSelection];
}

/** The marker IDs of the map's marker layers. */
function markerIds(map: ProjectMap): Set<number> {
    const ids = new Set<number>();
    for (const { layer } of walkLayers(map.layers)) {
        if (layer.type === "marker") for (const marker of layer.markers) ids.add(marker.id);
    }
    return ids;
}

interface TreeCommandOptions {
    /** Bytes the command retains besides its overhead (copied cells). */
    bytes?: number;
    /** Cell memory the command adds to the project (SPEC §2.2). */
    projectBytes?: number;
}

/**
 * A command that changes the layer tree of map `mapId` with `edit`, run against the map at the
 * first `do`. The tree is checked afterwards (`checkLayerTree`); a failed check or edit puts it
 * back and rethrows. Markers that left the map leave the marker selection.
 */
function treeCommand(
    label: string,
    mapId: string,
    edit: (map: ProjectMap, mapSession: MapSession) => void,
    options: TreeCommandOptions = {},
): Command {
    let before: TreeState | null = null;
    let after: TreeState | null = null;
    return {
        label,
        bytes: OVERHEAD_BYTES + (options.bytes ?? 0),
        touched: touched(mapId, { structure: true }),
        ...(options.projectBytes ? { projectBytes: options.projectBytes } : {}),
        do(session) {
            const map = mapOf(session.project, mapId);
            const mapSession = mapSessionOf(session, map);
            if (after) {
                restore(map, mapSession, after);
                return;
            }
            const start = capture(map, mapSession);
            try {
                edit(map, mapSession);
                checkLayerTree(map);
            } catch (error) {
                restore(map, mapSession, start, true);
                throw error;
            }
            const markers = markerIds(map);
            mapSession.markerSelection = mapSession.markerSelection.filter((id) => markers.has(id));
            before = start;
            after = capture(map, mapSession, start.lists.keys());
        },
        undo(session) {
            if (!before) return;
            const map = mapOf(session.project, mapId);
            restore(map, mapSessionOf(session, map), before);
        },
    };
}

/** Takes the next layer ID of `map`. */
function takeLayerId(map: ProjectMap): number {
    const id = map.nextLayerId;
    if (id >= MAX_LAYER_ID) {
        throw new LayerEditError("limit", "The map has used up its layer IDs.");
    }
    map.nextLayerId = id + 1;
    return id;
}

/**
 * The command that adds a layer of `kind` to map `mapId` right above its active layer, in the
 * active layer's group, and makes it active (Tiled's `addLayer`; with no active layer, at the
 * bottom of the map). Its name is `newLayerName`.
 */
export function newLayerCommand(mapId: string, kind: NewLayerKind): Command {
    const label =
        kind === "tile"
            ? LAYER_LABELS.newTile
            : kind === "marker"
              ? LAYER_LABELS.newMarker
              : LAYER_LABELS.newGroup;
    return treeCommand(label, mapId, (map, mapSession) => {
        const entry = findLayer(map, mapSession.activeLayerId);
        const place = entry ? placeOf(map, entry.layer.id) : null;
        const name = newLayerName(map, kind);
        const id = takeLayerId(map);
        const layer =
            kind === "tile"
                ? createTileLayer(id, name)
                : kind === "marker"
                  ? createMarkerLayer(id, name)
                  : createGroupLayer(id, name);
        const list = place ? place.list : map.layers;
        list.splice(place ? place.index + 1 : 0, 0, layer);
        mapSession.activeLayerId = id;
    });
}

/** The given layers that are not inside another of them, in tree order. */
function outermost(map: ProjectMap, ids: readonly number[]): Layer[] {
    const wanted = new Set(ids);
    const out: Layer[] = [];
    for (const { layer, ancestors } of walkLayers(map.layers)) {
        if (wanted.has(layer.id) && !ancestors.some((group) => wanted.has(group.id))) {
            out.push(layer);
        }
    }
    return out;
}

function assertKnown(map: ProjectMap, ids: readonly number[]): void {
    if (ids.length === 0) throw new LayerEditError("missing", "No layer is chosen.");
    for (const id of ids) placeOf(map, id);
}

/**
 * The command that wraps layers `ids` of map `mapId` in a new group (Tiled's `groupLayers`): the
 * group goes right above the first of them in its list, named `groupName`, and takes them in
 * tree order. The active layer stays.
 */
export function groupLayersCommand(mapId: string, ids: readonly number[]): Command {
    return treeCommand(LAYER_LABELS.group, mapId, (map) => {
        assertKnown(map, ids);
        const first = placeOf(map, ids[0]!);
        const layers = outermost(map, ids);
        // A group cannot go into itself or into one of its children.
        if (first.ancestors.some((group) => layers.includes(group))) {
            throw new LayerEditError("move", "A group cannot be put inside itself.");
        }
        const group = createGroupLayer(takeLayerId(map), groupName(map));
        first.list.splice(first.index + 1, 0, group);
        for (const layer of layers) {
            const place = placeOf(map, layer.id);
            place.list.splice(place.index, 1);
            group.layers.push(layer);
        }
    });
}

/**
 * The command that ungroups layers `ids` of map `mapId` (Tiled's `ungroupLayers`): a group's
 * children move into its parent where it was, a layer inside a group moves out right above
 * that group; a group left empty is removed. A removed active group passes the active layer to
 * the top child that took its place. Layers outside any group are left alone; when none of
 * them can be ungrouped the command throws `LayerEditError` ("move").
 */
export function ungroupCommand(mapId: string, ids: readonly number[]): Command {
    return treeCommand(LAYER_LABELS.ungroup, mapId, (map, mapSession) => {
        assertKnown(map, ids);
        let changed = false;
        const todo = ids.map((id) => placeOf(map, id).layer);
        while (todo.length > 0) {
            const layer = todo.shift()!;
            if (!findLayer(map, layer.id)) continue;
            let group: GroupLayer;
            let moving: Layer[];
            if (layer.type === "group") {
                group = layer;
                moving = [...layer.layers];
            } else {
                const place = placeOf(map, layer.id);
                if (!place.parent) continue;
                group = place.parent;
                moving = [layer];
            }
            const at = placeOf(map, group.id);
            for (const child of moving) group.layers.splice(group.layers.indexOf(child), 1);
            at.list.splice(at.index + 1, 0, ...moving);
            changed = true;
            if (group.layers.length === 0) {
                // The group's place now, with its children above it: the neighbour is taken
                // before the group goes.
                const place = placeOf(map, group.id);
                if (mapSession.activeLayerId === group.id) {
                    mapSession.activeLayerId =
                        moving.length > 0 ? moving.at(-1)!.id : (neighbourAfterRemoval(place) ?? 0);
                }
                place.list.splice(place.index, 1);
                const index = todo.indexOf(group);
                if (index >= 0) todo.splice(index, 1);
            }
        }
        if (!changed) {
            throw new LayerEditError("move", "Only a group or a layer inside a group ungroups.");
        }
    });
}

/**
 * The layer that becomes active when the layer at `place` is removed: the next one below it in
 * its list, else the one above, else its group (Qt's current row after a removal).
 */
function neighbourAfterRemoval(place: LayerPlace): number | null {
    const below = place.list[place.index - 1];
    const above = place.list[place.index + 1];
    return (below ?? above ?? place.parent)?.id ?? null;
}

/** A copy of `store`: the same cells in chunks of its own. */
function copyCells(store: CellStore): CellStore {
    const copy = new CellStore();
    const all = { x: -(1 << 20), y: -(1 << 20), width: 1 << 21, height: 1 << 21 };
    for (const chunk of store.chunksIn(all)) {
        const left = chunk.cx * CHUNK_SIZE;
        const top = chunk.cy * CHUNK_SIZE;
        chunk.cells.forEach((value, index) => {
            if (value === 0) return;
            copy.set(left + (index & CELL_INDEX_MASK), top + (index >> CHUNK_BITS), value);
        });
    }
    return copy;
}

/** Cell memory of the tile layers in `layers` and their children. */
function cellBytes(layers: readonly Layer[]): number {
    let bytes = 0;
    for (const { layer } of walkLayers(layers)) {
        if (layer.type === "tile") bytes += layer.cells.chunkCount * BYTES_PER_CHUNK;
    }
    return bytes;
}

/** A deep copy of `layer` with IDs from the map's counters for it, its children and markers. */
function cloneLayer(map: ProjectMap, layer: Layer): Layer {
    const id = takeLayerId(map);
    const properties = structuredClone(layer.properties);
    switch (layer.type) {
        case "tile":
            return { ...layer, id, properties, cells: copyCells(layer.cells) };
        case "marker": {
            const markers = layer.markers.map((marker): Marker => {
                const markerId = map.nextMarkerId;
                if (markerId >= MAX_MARKER_ID) {
                    throw new LayerEditError("limit", "The map has used up its marker IDs.");
                }
                map.nextMarkerId = markerId + 1;
                return { ...structuredClone(marker), id: markerId };
            });
            return { ...layer, id, properties, markers };
        }
        case "image":
            return { ...layer, id, properties };
        case "group":
            return {
                ...layer,
                id,
                properties,
                layers: layer.layers.map((child) => cloneLayer(map, child)),
            };
    }
}

/**
 * The command that duplicates layers `ids` of `project`'s map `mapId` (Tiled's
 * `duplicateLayers`): each copy, with its children, cells and markers, goes right above its
 * original with new layer and marker IDs and the same name (Tiled leaves the name as it is
 * unless its "duplicate adds Copy" preference is on, which is off by default). A layer inside
 * another chosen group is copied with that group. The copy of the active layer, else the first
 * copy, becomes active.
 */
export function duplicateLayersCommand(
    project: Project,
    mapId: string,
    ids: readonly number[],
): Command {
    const map = mapOf(project, mapId);
    const sources = outermost(map, ids);
    const bytes = cellBytes(sources);
    return treeCommand(
        LAYER_LABELS.duplicate,
        mapId,
        (target, mapSession) => {
            assertKnown(target, ids);
            let active: number | null = null;
            for (const layer of outermost(target, ids)) {
                const copy = cloneLayer(target, layer);
                const place = placeOf(target, layer.id);
                place.list.splice(place.index + 1, 0, copy);
                if (active === null || layer.id === mapSession.activeLayerId) active = copy.id;
            }
            if (active !== null) mapSession.activeLayerId = active;
        },
        { bytes, projectBytes: bytes },
    );
}

/**
 * The command that deletes layers `ids` of `project`'s map `mapId` with their children (Tiled's
 * `removeLayers`). Its `do` throws `LayerEditError` ("last") when the map would be left without
 * a layer. An active layer that goes passes the active layer to `neighbourAfterRemoval`.
 */
export function deleteLayersCommand(
    project: Project,
    mapId: string,
    ids: readonly number[],
): Command {
    const map = mapOf(project, mapId);
    const bytes = cellBytes(outermost(map, ids));
    return treeCommand(
        LAYER_LABELS.delete,
        mapId,
        (target, mapSession) => {
            assertKnown(target, ids);
            for (const layer of outermost(target, ids)) {
                const place = placeOf(target, layer.id);
                const activeInside =
                    mapSession.activeLayerId === layer.id ||
                    (layer.type === "group" &&
                        [...walkLayers(layer.layers)].some(
                            (entry) => entry.layer.id === mapSession.activeLayerId,
                        ));
                if (activeInside) {
                    mapSession.activeLayerId = neighbourAfterRemoval(place) ?? 0;
                }
                place.list.splice(place.index, 1);
            }
        },
        { bytes },
    );
}

/** Where Move Up (`1`) or Down (`-1`) puts layer `id`: Tiled's `MoveLayer`; null at the ends. */
export function moveTarget(
    map: ProjectMap,
    id: number,
    step: -1 | 1,
): { parent: GroupLayer | null; index: number } | null {
    const place = placeOf(map, id);
    const { list, index, parent, ancestors } = place;
    const next = index + step;
    if (next < 0 || next >= list.length) {
        // Out of the group: below it, or above it, in the group's own list.
        if (!parent) return null;
        const outer = ancestors.at(-2) ?? null;
        const outerList = outer ? outer.layers : map.layers;
        const at = outerList.indexOf(parent);
        return { parent: outer, index: step < 0 ? at : at + 1 };
    }
    const sibling = list[next]!;
    if (sibling.type === "group") {
        // Into the group: at its top when moving down, at its bottom when moving up.
        return { parent: sibling, index: step < 0 ? sibling.layers.length : 0 };
    }
    // Swap with the sibling: the index after taking the layer out.
    return { parent, index: next };
}

/** Moves layer `id` of `map` to place `index` of `parent`'s list (index after removal). */
function moveTo(map: ProjectMap, id: number, parent: GroupLayer | null, index: number): void {
    const place = placeOf(map, id);
    if (parent) {
        const chain: Layer[] = [...placeOf(map, parent.id).ancestors, parent];
        if (chain.includes(place.layer)) {
            throw new LayerEditError("move", "A group cannot be put inside itself.");
        }
    }
    place.list.splice(place.index, 1);
    const list = parent ? parent.layers : map.layers;
    if (!Number.isInteger(index) || index < 0 || index > list.length) {
        throw new LayerEditError("move", `The group has no place ${index + 1}.`);
    }
    list.splice(index, 0, place.layer);
}

/**
 * The command that moves layer `id` of map `mapId` one step up (`1`) or down (`-1`) as Tiled's
 * Raise and Lower Layer: past a sibling, into a sibling group (at its bottom going up, its top
 * going down), or out of its group at either end. Throws `LayerEditError` ("move") at the top or
 * bottom of the map. The active layer stays.
 */
export function moveLayerCommand(mapId: string, id: number, step: -1 | 1): Command {
    return treeCommand(step > 0 ? LAYER_LABELS.moveUp : LAYER_LABELS.moveDown, mapId, (map) => {
        const target = moveTarget(map, id, step);
        if (!target) {
            throw new LayerEditError(
                "move",
                `${quoted(placeOf(map, id).layer.name)} is already the ${step > 0 ? "top" : "bottom"} layer.`,
            );
        }
        moveTo(map, id, target.parent, target.index);
    });
}

/**
 * The command that moves layer `id` of map `mapId` into group `parentId` (null: the top of the
 * map) at `index` of its list, counted with the layer taken out: a drag in the Layers panel.
 * Throws `LayerEditError` ("move") for a place outside the list, the place it holds, or a group
 * inside the layer itself.
 */
export function moveLayerToCommand(
    mapId: string,
    id: number,
    parentId: number | null,
    index: number,
): Command {
    return treeCommand(LAYER_LABELS.move, mapId, (map) => {
        const place = placeOf(map, id);
        let parent: GroupLayer | null = null;
        if (parentId !== null) {
            const target = placeOf(map, parentId).layer;
            if (target.type !== "group") {
                throw new LayerEditError("move", `${quoted(target.name)} is not a group.`);
            }
            parent = target;
        }
        if (parent === place.parent && index === place.index) {
            throw new LayerEditError("move", `${quoted(place.layer.name)} is there already.`);
        }
        moveTo(map, id, parent, index);
    });
}

// ---------------------------------------------------------------------------------------------
// Setters

/** The label of a setter that changes `keys` to `values`. */
function setterLabel(keys: readonly (keyof LayerValues)[], values: Partial<LayerValues>): string {
    const only = (...wanted: (keyof LayerValues)[]) =>
        keys.length > 0 && keys.every((key) => wanted.includes(key));
    if (only("name")) return LAYER_LABELS.rename;
    if (only("visible")) return values.visible ? LAYER_LABELS.show : LAYER_LABELS.hide;
    if (only("locked")) return values.locked ? LAYER_LABELS.lock : LAYER_LABELS.unlock;
    if (only("opacity")) return LAYER_LABELS.opacity;
    if (only("offsetX", "offsetY")) return LAYER_LABELS.offset;
    if (only("parallaxX", "parallaxY")) return LAYER_LABELS.parallax;
    if (only("class")) return LAYER_LABELS.class;
    return LAYER_LABELS.values;
}

/** Whether a change of `keys` changes how the viewport draws the layer and its children. */
function drawsDifferently(keys: readonly (keyof LayerValues)[]): boolean {
    return keys.some((key) => key !== "name" && key !== "class" && key !== "locked");
}

/**
 * The command that sets `values` on layers `ids` of `project`'s map `mapId`, one entry however
 * many layers and fields: the setters of SPEC §7.2 (visible, locked, opacity, offset, parallax,
 * class) and Rename. `label` names the entry; the default follows the fields ("Hide Layer",
 * "Layer Opacity", …). Throws `LayerEditError` ("values") for a value out of range, now or at
 * `do`; its `do` throws ("range") when an effective offset or parallax would leave its range.
 */
export function setLayerValuesCommand(
    project: Project,
    mapId: string,
    ids: readonly number[],
    values: Partial<LayerValues>,
    label?: string,
): Command {
    const keys = LAYER_VALUE_KEYS.filter((key) => values[key] !== undefined);
    const changes = Object.fromEntries(
        keys.map((key) => [key, values[key]]),
    ) as Partial<LayerValues>;
    const problem = Object.values(layerValueProblems(values))[0];
    if (problem) throw new LayerEditError("values", problem);
    const map = mapOf(project, mapId);
    // The layers whose drawing may change: the chosen ones and their children.
    const drawn = new Set<number>();
    for (const id of ids) {
        const entry = findLayer(map, id);
        if (!entry) continue;
        drawn.add(id);
        if (entry.layer.type === "group") {
            for (const { layer } of walkLayers(entry.layer.layers)) drawn.add(layer.id);
        }
    }
    let before: Partial<LayerValues>[] | null = null;
    const apply = (session: ProjectSession, all: readonly Partial<LayerValues>[]) => {
        const target = mapOf(session.project, mapId);
        ids.forEach((id, k) => Object.assign(placeOf(target, id).layer, all[k]));
    };
    return {
        label: label ?? setterLabel(keys, values),
        bytes: OVERHEAD_BYTES,
        touched: touched(mapId, { layerIds: drawsDifferently(keys) ? [...drawn] : [...ids] }),
        do(session) {
            const target = mapOf(session.project, mapId);
            const layers = ids.map((id) => placeOf(target, id).layer);
            const saved = layers.map(
                (layer) =>
                    Object.fromEntries(
                        keys.map((key) => [key, layer[key]]),
                    ) as Partial<LayerValues>,
            );
            layers.forEach((layer) => Object.assign(layer, changes));
            try {
                checkLayerTree(target);
            } catch (error) {
                layers.forEach((layer, k) => Object.assign(layer, saved[k]));
                throw error;
            }
            before = saved;
        },
        undo(session) {
            if (before) apply(session, before);
        },
    };
}

/**
 * Show/Hide Other Layers (`"visible"`) or Lock/Unlock Other Layers (`"locked"`) for layers
 * `ids` of `project`'s map `mapId`, as Tiled's `toggleOtherLayers` and `toggleLockOtherLayers`:
 * the other layers (`otherLayers`) are all shown when none is visible, else all hidden; all
 * unlocked when every one is locked, else all locked. Only the layers that change are in the
 * entry. Null when there is no other layer.
 */
export function toggleOtherLayersCommand(
    project: Project,
    mapId: string,
    ids: readonly number[],
    flag: "visible" | "locked",
): Command | null {
    const map = mapOf(project, mapId);
    const others = otherLayers(map, ids);
    if (others.length === 0) return null;
    let value: boolean;
    let label: string;
    if (flag === "visible") {
        value = others.every((layer) => !layer.visible);
        label = value ? LAYER_LABELS.showOthers : LAYER_LABELS.hideOthers;
    } else {
        value = others.some((layer) => !layer.locked);
        label = value ? LAYER_LABELS.lockOthers : LAYER_LABELS.unlockOthers;
    }
    const changing = others.filter((layer) => layer[flag] !== value).map((layer) => layer.id);
    return setLayerValuesCommand(project, mapId, changing, { [flag]: value }, label);
}
