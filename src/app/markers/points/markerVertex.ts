import { MIN_POLYGON_POINTS, MIN_POLYLINE_POINTS } from "../../../core/model";
import { findMarker, setMarkerPointsCommand } from "../../../core/markers";
import type { Command } from "../../../core/history";
import type { Marker, ProjectMap, ProjectSession, ShapePoint } from "../../../core/model";
import { toolState } from "../../tools/activeTool";
import { activeMap } from "../../tools/toolSets";
import { selectedMarkerIds } from "../markerSelection";
import { EDIT_POINTS_TOOL } from "./editPointsId";

// The chosen vertex of the Edit points tool (SPEC §8, DESIGN §10.4; TE-039): one point of a
// selected polygon or polyline, which the arrows nudge and Delete removes. It is the tool's own
// state, set by the tool with no history entry, as the marker selection is session state. It
// is kept by its marker and the index of its point, as Tiled keeps its selected points, and
// counts only while the Edit points tool is active, its marker is selected on the active map and
// is a polygon or polyline with a point at that index (`chosenVertex`). So a change of map or
// selection, or an undo that leaves fewer points, lets it go; an undo that keeps the index
// leaves the point now at that index chosen, and switching back to the tool shows it again.

/** A polygon or polyline marker. */
export type PathMarker = Extract<Marker, { points: ShapePoint[] }>;

/** The vertex chosen: its map, its marker and the index of its point. */
export interface VertexRef {
    readonly mapId: string;
    readonly markerId: number;
    readonly index: number;
}

let chosen: VertexRef | null = null;
const listeners = new Set<() => void>();

/** Chooses `next` (null for none) and tells the listeners when it changed. */
export function setChosenVertex(next: VertexRef | null): void {
    const same =
        next === chosen ||
        (next !== null &&
            chosen !== null &&
            next.mapId === chosen.mapId &&
            next.markerId === chosen.markerId &&
            next.index === chosen.index);
    if (same) return;
    chosen = next;
    for (const listener of [...listeners]) listener();
}

/** Calls `listener` when the chosen vertex changes; returns the function that stops it. */
export function subscribeChosenVertex(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Whether `marker` is a polygon or polyline. */
export function isPath(marker: Marker): marker is PathMarker {
    return marker.shape === "polygon" || marker.shape === "polyline";
}

/** The fewest points a polygon (3) or polyline (2) keeps. */
export function leastPoints(marker: PathMarker): number {
    return marker.shape === "polygon" ? MIN_POLYGON_POINTS : MIN_POLYLINE_POINTS;
}

/** The chosen vertex while it is still true now, with its map and marker; null otherwise. */
export function chosenVertex(
    session: ProjectSession,
): { map: ProjectMap; marker: PathMarker; index: number } | null {
    if (!chosen || toolState.activeId() !== EDIT_POINTS_TOOL) return null;
    const map = activeMap(session);
    if (!map || map.id !== chosen.mapId) return null;
    if (!selectedMarkerIds(session, map).includes(chosen.markerId)) return null;
    const marker = findMarker(map, chosen.markerId)?.marker;
    if (!marker || !isPath(marker) || chosen.index >= marker.points.length) return null;
    return { map, marker, index: chosen.index };
}

/** `marker`'s points with point `index` moved by `(dx, dy)`, relative to its position. */
export function nudgedPoints(
    marker: PathMarker,
    index: number,
    dx: number,
    dy: number,
): ShapePoint[] {
    return marker.points.map(([px, py], k): ShapePoint =>
        k === index ? [px + dx + 0, py + dy + 0] : [px, py],
    );
}

/** The command that moves the chosen vertex by `(dx, dy)` map pixels; null without one. */
export function nudgeVertexCommand(
    session: ProjectSession,
    dx: number,
    dy: number,
): Command | null {
    const vertex = chosenVertex(session);
    if (!vertex) return null;
    const { map, marker, index } = vertex;
    return setMarkerPointsCommand(
        session.project,
        map.id,
        marker.id,
        nudgedPoints(marker, index, dx, dy),
    );
}

/**
 * What Delete does to the chosen vertex: the command that removes it, or the reason it stays (a
 * polygon keeps 3 points, a polyline 2); null without a chosen vertex. The marker keeps its
 * position, so its other points do not move.
 */
export function deleteVertex(
    session: ProjectSession,
): { command: Command } | { refused: string } | null {
    const vertex = chosenVertex(session);
    if (!vertex) return null;
    const { map, marker, index } = vertex;
    const least = leastPoints(marker);
    if (marker.points.length <= least) {
        return { refused: `A ${marker.shape} keeps at least ${least} points` };
    }
    const points = marker.points.filter((_, k) => k !== index);
    return { command: setMarkerPointsCommand(session.project, map.id, marker.id, points) };
}
