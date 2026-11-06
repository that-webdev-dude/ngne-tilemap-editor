import type { CommandSpec } from "../commands/types";
import { sessionStore } from "../state/session";
import { activeMap, canMoveMap, deleteMap, duplicateMap, mapsIdle, moveMap } from "./maps";

// The map commands of the menus and the command palette (SPEC §7.1; DESIGN §5): Duplicate Map
// and Delete Map act on the active map, as Tiled's map commands act on the current document.
// Delete is disabled for the last map of the project. Move Map Up and Move Map Down change the
// project's map list; they have no menu item (DESIGN §5) and run from the command palette.
// New Map opens its dialog (TE-032); Rename is the Maps panel's and Map Properties' (TE-032).

const hasActive = () => activeMap() !== null && mapsIdle();

export const commands: CommandSpec[] = [
    {
        id: "map.duplicate",
        title: "Duplicate Map",
        enabled: hasActive,
        run: () => void duplicateMap(),
    },
    {
        id: "map.delete",
        title: "Delete Map",
        enabled: () => hasActive() && sessionStore.getState().session.project.maps.length > 1,
        run: () => void deleteMap(),
    },
    {
        id: "map.moveUp",
        title: "Move Map Up",
        enabled: () => mapsIdle() && canMoveMap(activeMap()?.id, -1),
        run: () => void moveMap(-1),
    },
    {
        id: "map.moveDown",
        title: "Move Map Down",
        enabled: () => mapsIdle() && canMoveMap(activeMap()?.id, 1),
        run: () => void moveMap(1),
    },
];
