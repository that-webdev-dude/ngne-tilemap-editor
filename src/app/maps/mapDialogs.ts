import { mapFieldProblems, mapFields, mapPropertiesCommand, newMapProblems } from "../../core/maps";
import type { MapFields, NewMapValues } from "../../core/maps";
import { commandDialogs } from "../dialogs/dialogRequests";
import { sessionStore } from "../state/session";
import { activeMap, mapsIdle, newMap, newMapDefaults } from "./maps";

// The map dialogs (DESIGN §9; TE-032). New Map asks for the name, the size in cells and the
// tile size, starting from the last new map's (SPEC §7.1), with the size presets of DESIGN §9;
// Create adds the map and shows it. Map Properties edits name, export name, class, tile size,
// background colour and parallax origin of a map: as Tileset Properties and the sprite editor's
// Sprite Properties, nothing changes until OK, and OK applies every changed field as one undo
// step (none when nothing changed). The dialogs only show and ask; the commands change the
// project.

/** The size presets of the New Map dialog, in cells (DESIGN §9). */
export const NEW_MAP_SIZE_PRESETS: readonly (readonly [width: number, height: number])[] = [
    [32, 32],
    [64, 64],
    [128, 128],
    [256, 256],
    [1000, 40],
];

export interface NewMapRequest {
    kind: "new-map";
    initial: NewMapValues;
    /** Why `values` cannot make a map, by field; empty when they can. */
    problems(values: NewMapValues): Partial<Record<keyof NewMapValues, string>>;
    /** The values of the new map, or null to cancel. Closes the dialog. */
    answer(values: NewMapValues | null): void;
}

/** File → New Map… (Ctrl+Alt+M): asks for the values, then adds the map. Resolves its ID. */
export async function newMapFromDialog(): Promise<string | null> {
    const values = await commandDialogs.open<NewMapValues>((answer): NewMapRequest => ({
        kind: "new-map",
        initial: newMapDefaults(),
        problems: newMapProblems,
        answer,
    }));
    if (!values || !mapsIdle()) return null;
    return newMap(values);
}

export interface MapPropertiesRequest {
    kind: "map-properties";
    initial: MapFields;
    /** Why `values` cannot be applied, by field; empty when they can. */
    problems(values: MapFields): Partial<Record<keyof MapFields, string>>;
    /** The values to apply, or null to cancel. Closes the dialog. */
    answer(values: MapFields | null): void;
}

/**
 * Map → Map Properties… on map `id` (the active map by default): opens the dialog and applies
 * its answer as one history entry. Resolves true when a field changed.
 */
export async function editMapProperties(id = activeMap()?.id): Promise<boolean> {
    if (id === undefined) return false;
    const map = sessionStore.getState().session.project.maps.find((each) => each.id === id);
    if (!map) return false;
    const values = await commandDialogs.open<MapFields>((answer): MapPropertiesRequest => ({
        kind: "map-properties",
        initial: mapFields(map),
        problems: (fields) => mapFieldProblems(sessionStore.getState().session.project, id, fields),
        answer,
    }));
    if (!values || !mapsIdle()) return false;
    const { session, history } = sessionStore.getState();
    if (!session.project.maps.some((each) => each.id === id)) return false;
    const command = mapPropertiesCommand(session.project, id, values);
    if (!command) return false;
    history.execute(command);
    return true;
}
