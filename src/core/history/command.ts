import type { CellRect } from "../cells";
import type { ProjectSession } from "../model";

/**
 * What a change affected: the shape of `Command.touched` (SPEC §3), which drives the
 * viewport (live quads, chunk patches), the thumbnail and the preview.
 */
export interface Touched {
    /** The map the change belongs to, or null for a project or tileset edit. */
    mapId: string | null;
    /** Layers of `mapId` whose content or values changed. */
    layerIds: number[];
    /** Cell rectangles of `mapId` whose cells changed. */
    cellRects: CellRect[];
    /** Tilesets whose pixels, tiles or terrain changed. */
    tilesetIds: string[];
    /** Maps, layers, tilesets or images added, removed, reordered or resized. */
    structure: boolean;
}

/** A `touched` that names nothing: for a command that changes only values the viewport ignores. */
export function touchedNothing(mapId: string | null = null): Touched {
    return { mapId, layerIds: [], cellRects: [], tilesetIds: [], structure: false };
}

/**
 * One undoable change of a session (SPEC §3). `undo` reverses `do` exactly, and each of
 * them either completes or throws with the session as it found it. A command that cannot
 * allocate memory throws `AllocationError`.
 */
export interface Command {
    /** Menu text of the step, as in "Undo Stamp Brush". */
    label: string;
    do(session: ProjectSession): void;
    undo(session: ProjectSession): void;
    /** Memory the command retains, in bytes; counted against the history budget. */
    bytes: number;
    /** What `do` and `undo` change; the history reports it to its subscribers. */
    touched: Touched;
    /**
     * Tileset and cell memory `do` adds to the project (SPEC §2.2), in bytes, when known in
     * advance: a tileset import, a resize. The history refuses the command before `do` when
     * it would take the project past the limit; a command that leaves it out is still
     * checked after `do`.
     */
    projectBytes?: number;
}

/**
 * Union of several `touched` records, each ID and rectangle once. The map is the one every
 * part names; parts of different maps make a project-wide record.
 */
export function mergeTouched(parts: readonly Touched[]): Touched {
    const mapIds = new Set(parts.map((part) => part.mapId).filter((id) => id !== null));
    const rects = new Map<string, CellRect>();
    for (const part of parts) {
        for (const rect of part.cellRects) {
            rects.set(`${rect.x},${rect.y},${rect.width},${rect.height}`, rect);
        }
    }
    return {
        mapId: mapIds.size === 1 ? [...mapIds][0]! : null,
        layerIds: [...new Set(parts.flatMap((part) => part.layerIds))],
        cellRects: [...rects.values()],
        tilesetIds: [...new Set(parts.flatMap((part) => part.tilesetIds))],
        structure: parts.some((part) => part.structure),
    };
}

/**
 * Several commands as one undo step: done in the given order, undone in reverse. When one of
 * them throws, those that already ran are reversed before the error is rethrown, so the step
 * happens as a whole or not at all.
 */
export function compositeCommand(label: string, commands: readonly Command[]): Command {
    const parts = [...commands];
    const projectBytes = parts.reduce((sum, part) => sum + (part.projectBytes ?? 0), 0);
    return {
        label,
        bytes: parts.reduce((sum, part) => sum + part.bytes, 0),
        touched: mergeTouched(parts.map((part) => part.touched)),
        ...(projectBytes > 0 ? { projectBytes } : {}),
        do(session) {
            let done = 0;
            try {
                for (; done < parts.length; done++) parts[done]!.do(session);
            } catch (error) {
                while (done > 0) parts[--done]!.undo(session);
                throw error;
            }
        },
        undo(session) {
            let left = parts.length;
            try {
                for (; left > 0; left--) parts[left - 1]!.undo(session);
            } catch (error) {
                for (; left < parts.length; left++) parts[left]!.do(session);
                throw error;
            }
        },
    };
}
