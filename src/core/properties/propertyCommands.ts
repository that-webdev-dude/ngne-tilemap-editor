import type { Command, Touched } from "../history";
import { MAX_PROPERTIES, findLayer, walkLayers } from "../model";
import type {
    Layer,
    Marker,
    Project,
    ProjectMap,
    Property,
    PropertyType,
    Tile,
    Tileset,
} from "../model";
import {
    convertProperty,
    defaultProperty,
    propertyNameProblem,
    propertyValueProblem,
    sameValue,
} from "./convert";

// The custom property commands of SPEC §9 (TE-040): add, rename, change type, set a value,
// remove. Each acts on every item of a target, one history entry however many: the project, a
// tileset, tiles of a tileset, a map, a layer, or markers of a map. With several items, a
// property is common when every item has one of that name and type (`commonProperties`);
// renaming, changing the type, setting or removing one changes it on all, as Tiled's
// Properties view does for several selected objects.
//
// Each command checks what it would make against FORMAT §1.4 and §2.8 before it changes
// anything, at `do` against the project as it is then, and throws `PropertyEditError` with the
// project unchanged: at most 256 properties per list, names non-blank, distinct and of at most
// 255 UTF-16 code units, values of their type (strings of at most 65 535 code units, files of at
// most 1024, ints within ±2⁵³ − 1, finite floats, `#rrggbbaa` colours). The lists stay sorted by
// name in UTF-16 code-unit order, the order the writer uses. Undo puts back each item's list as
// it was.
//
// Properties are not drawn: `touched` names the map of a map, layer or marker target (an undo
// of another map's entry shows that map first, SPEC §3) and nothing else.

export type PropertyEditErrorCode =
    /** The target names a map, layer, marker, tileset or tile that does not exist. */
    | "missing"
    /** A list would hold more than 256 properties. */
    | "limit"
    /** A name or value is refused: blank, too long, taken, or not of its type. */
    | "values";

export class PropertyEditError extends Error {
    override readonly name = "PropertyEditError";
    readonly code: PropertyEditErrorCode;

    constructor(code: PropertyEditErrorCode, message: string) {
        super(message);
        this.code = code;
    }
}

/** What holds the properties a command edits. */
export type PropertyTarget =
    | { kind: "project" }
    | { kind: "tileset"; tilesetId: string }
    | { kind: "tiles"; tilesetId: string; tileIds: readonly number[] }
    | { kind: "map"; mapId: string }
    | { kind: "layer"; mapId: string; layerId: number }
    | { kind: "markers"; mapId: string; markerIds: readonly number[] };

/** Labels of the history entries. */
export const PROPERTY_LABELS = {
    add: "Add Property",
    rename: "Rename Property",
    type: "Change Property Type",
    value: "Change Property",
    remove: "Remove Property",
} as const;

/** Bytes a command claims besides the lists it holds. */
const OVERHEAD_BYTES = 256;
/** Bytes counted per property of a list a command keeps, besides its text. */
const PROPERTY_BYTES = 64;

/** An item with a property list: what a target is made of. */
export type PropertyOwner = Project | Tileset | Tile | ProjectMap | Layer | Marker;
type Owner = PropertyOwner;

function mapOf(project: Project, id: string): ProjectMap {
    const map = project.maps.find((each) => each.id === id);
    if (!map) throw new PropertyEditError("missing", `The project has no map "${id}".`);
    return map;
}

/**
 * The items of `target` in `project`, each once, in the order given; throws
 * `PropertyEditError` ("missing") for one that does not exist or an empty list of items.
 */
export function propertyOwners(project: Project, target: PropertyTarget): Owner[] {
    switch (target.kind) {
        case "project":
            return [project];
        case "tileset":
        case "tiles": {
            const tileset = project.tilesets.find((each) => each.id === target.tilesetId);
            if (!tileset) {
                throw new PropertyEditError(
                    "missing",
                    `The project has no tileset "${target.tilesetId}".`,
                );
            }
            if (target.kind === "tileset") return [tileset];
            if (target.tileIds.length === 0) {
                throw new PropertyEditError("missing", "No tile is chosen.");
            }
            return [...new Set(target.tileIds)].map((id) => {
                const tile = tileset.tiles.find((each) => each.id === id);
                if (!tile) {
                    throw new PropertyEditError("missing", `“${tileset.name}” has no tile ${id}.`);
                }
                return tile;
            });
        }
        case "map":
            return [mapOf(project, target.mapId)];
        case "layer": {
            const layer = findLayer(mapOf(project, target.mapId), target.layerId)?.layer;
            if (!layer) {
                throw new PropertyEditError("missing", `The map has no layer ${target.layerId}.`);
            }
            return [layer];
        }
        case "markers": {
            const map = mapOf(project, target.mapId);
            if (target.markerIds.length === 0) {
                throw new PropertyEditError("missing", "No marker is chosen.");
            }
            const byId = new Map<number, Owner>();
            for (const { layer } of walkLayers(map.layers)) {
                if (layer.type !== "marker") continue;
                for (const marker of layer.markers) byId.set(marker.id, marker);
            }
            return [...new Set(target.markerIds)].map((id) => {
                const marker = byId.get(id);
                if (!marker) throw new PropertyEditError("missing", `The map has no marker ${id}.`);
                return marker;
            });
        }
    }
}

/** Sorts `list` by name in UTF-16 code-unit order (FORMAT §1.4), in place. */
function sortByName<Item extends { name: string }>(list: Item[]): Item[] {
    return list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** One property shown for the items of a target: common to all, mixed when values differ. */
export interface CommonProperty {
    name: string;
    type: PropertyType;
    /** The first item's value. */
    value: Property["value"];
    /** The items' values differ ("—", DESIGN §8.3). */
    mixed: boolean;
}

/**
 * The properties every list of `lists` has, by name and type, sorted by name; `mixed` when the
 * lists' values differ (SPEC §9: a property shown is common to all).
 */
export function commonProperties(lists: readonly (readonly Property[])[]): CommonProperty[] {
    const [first, ...rest] = lists;
    if (!first) return [];
    const common: CommonProperty[] = [];
    for (const property of first) {
        let mixed = false;
        let everywhere = true;
        for (const list of rest) {
            const other = list.find((each) => each.name === property.name);
            if (!other || other.type !== property.type) {
                everywhere = false;
                break;
            }
            if (!sameValue(other, property)) mixed = true;
        }
        if (everywhere) {
            common.push({ name: property.name, type: property.type, value: property.value, mixed });
        }
    }
    return sortByName(common);
}

function textBytes(list: readonly Property[]): number {
    let bytes = 0;
    for (const property of list) {
        bytes += PROPERTY_BYTES + 2 * property.name.length;
        if (typeof property.value === "string") bytes += 2 * property.value.length;
    }
    return bytes;
}

function touchedBy(target: PropertyTarget): Touched {
    const mapId = "mapId" in target ? target.mapId : null;
    return { mapId, layerIds: [], cellRects: [], tilesetIds: [], structure: false };
}

function quoted(text: string): string {
    return `“${text}”`;
}

/**
 * A command that gives each item of `target` the list `edit` makes of a copy of its own,
 * checked before anything changes; undo puts back each item's list. `edit` throws
 * `PropertyEditError` to refuse. `bytes` counts the lists as `project` holds them now.
 */
function listCommand(
    label: string,
    project: Project,
    target: PropertyTarget,
    edit: (list: Property[]) => Property[],
): Command {
    const owners = propertyOwners(project, target);
    let before: Property[][] = [];
    return {
        label,
        bytes:
            OVERHEAD_BYTES + 2 * owners.reduce((sum, each) => sum + textBytes(each.properties), 0),
        touched: touchedBy(target),
        do(session) {
            const found = propertyOwners(session.project, target);
            const after = found.map((owner) => {
                const list = sortByName(edit(structuredClone(owner.properties)));
                if (list.length > MAX_PROPERTIES) {
                    throw new PropertyEditError(
                        "limit",
                        `A property list holds at most ${MAX_PROPERTIES} properties.`,
                    );
                }
                return list;
            });
            before = found.map((owner) => owner.properties);
            found.forEach((owner, k) => (owner.properties = after[k]!));
        },
        undo(session) {
            propertyOwners(session.project, target).forEach(
                (owner, k) => (owner.properties = before[k]!),
            );
        },
    };
}

function checkName(name: string): void {
    const problem = propertyNameProblem(name);
    if (problem) throw new PropertyEditError("values", problem);
}

function checkValue(property: Property): void {
    const problem = propertyValueProblem(property);
    if (problem) throw new PropertyEditError("values", problem);
}

/** The index of property `name` of type `type` in `list`; throws when it has none. */
function indexOf(list: readonly Property[], name: string, type?: PropertyType): number {
    const index = list.findIndex((each) => each.name === name);
    if (index < 0 || (type !== undefined && list[index]!.type !== type)) {
        throw new PropertyEditError("missing", `No property ${quoted(name)} is common to all.`);
    }
    return index;
}

/**
 * The command that adds property `property` (a name, a type and a value; the type's default
 * when the value is left out) to every item of `target` (Add, DESIGN §8.3). Throws
 * `PropertyEditError`, now or at `do`, for a refused name or value, a name an item already has,
 * or a full list.
 */
export function addPropertyCommand(
    project: Project,
    target: PropertyTarget,
    name: string,
    type: PropertyType,
    value?: Property["value"],
): Command {
    checkName(name);
    const property = (
        value === undefined ? defaultProperty(name, type) : { name, type, value }
    ) as Property;
    checkValue(property);
    return listCommand(PROPERTY_LABELS.add, project, target, (list) => {
        if (list.some((each) => each.name === name)) {
            throw new PropertyEditError("values", `The property ${quoted(name)} exists.`);
        }
        return [...list, structuredClone(property)];
    });
}

/**
 * The command that renames property `name` to `newName` on every item of `target`, keeping
 * its type and each item's value. Throws `PropertyEditError` for a refused name, a name an item
 * already has, or an item without the property.
 */
export function renamePropertyCommand(
    project: Project,
    target: PropertyTarget,
    name: string,
    newName: string,
): Command {
    checkName(newName);
    return listCommand(PROPERTY_LABELS.rename, project, target, (list) => {
        const index = indexOf(list, name);
        if (newName !== name && list.some((each) => each.name === newName)) {
            throw new PropertyEditError("values", `The property ${quoted(newName)} exists.`);
        }
        list[index] = { ...list[index]!, name: newName };
        return list;
    });
}

/**
 * The command that changes property `name` of every item of `target` to type `type`, each
 * item's value converted where it can be, else the type's default (SPEC §9, `convertProperty`).
 */
export function changePropertyTypeCommand(
    project: Project,
    target: PropertyTarget,
    name: string,
    type: PropertyType,
): Command {
    return listCommand(PROPERTY_LABELS.type, project, target, (list) => {
        const index = indexOf(list, name);
        list[index] = convertProperty(list[index]!, type);
        return list;
    });
}

/**
 * The command that sets property `name` of type `type` to `value` on every item of `target`
 * (an edit of its value control). Throws `PropertyEditError` for a value not of the type or an
 * item without the property.
 */
export function setPropertyValueCommand(
    project: Project,
    target: PropertyTarget,
    name: string,
    type: PropertyType,
    value: Property["value"],
): Command {
    const property = { name, type, value } as Property;
    checkValue(property);
    return listCommand(PROPERTY_LABELS.value, project, target, (list) => {
        list[indexOf(list, name, type)] = structuredClone(property);
        return list;
    });
}

/** The command that removes property `name` from every item of `target`. */
export function removePropertyCommand(
    project: Project,
    target: PropertyTarget,
    name: string,
): Command {
    return listCommand(PROPERTY_LABELS.remove, project, target, (list) => {
        list.splice(indexOf(list, name), 1);
        return list;
    });
}
