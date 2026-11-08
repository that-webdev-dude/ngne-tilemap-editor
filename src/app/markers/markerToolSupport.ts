import { MarkerEditError } from "../../core/markers";
import type { Command } from "../../core/history";
import { createMapSession, effectiveValues, findLayer } from "../../core/model";
import { layerShift } from "../../engine/viewport/geometry";
import { REFUSALS } from "../tools/paintTarget";
import type { ToolContext, ToolModifiers } from "../tools/types";
import type { Point } from "../view/coordinates";
import { currentViewMapping } from "../view/viewNavigation";
import { viewPreferences } from "../view/viewPreferences";
import type { ViewCentre } from "./markerGeometry";

// What the marker tools share (SPEC §8; TE-038): the view they work in, whether snapping is on
// for a gesture, the layer a create tool adds to, and running a marker command.

/** A press on a marker within this many CSS pixels of its outline hits it. */
export const HIT_REACH_CSS = 4;

/**
 * A press becomes a drag once the pointer has moved this far, CSS pixels, summed over both
 * axes (Tiled: half of Qt's start-drag distance of 10).
 */
export const DRAG_DISTANCE_CSS = 5;

/** The view a stroke works in: its centre, and map pixels per CSS and per device pixel. */
export interface ToolView {
    readonly centre: ViewCentre;
    /** Map pixels a CSS pixel spans. */
    readonly cssPixel: number;
    /** Device pixels a map pixel spans, and device pixels a CSS pixel. */
    readonly scale: number;
    readonly dpr: number;
}

/** The view of the stroke's map now. */
export function toolView(context: ToolContext): ToolView {
    const mapping = currentViewMapping();
    if (mapping) {
        const { dpr, view } = mapping.frame;
        return { centre: view, cssPixel: dpr / mapping.scale, scale: mapping.scale, dpr };
    }
    const view =
        context.session.perMap.get(context.map.id)?.view ?? createMapSession(context.map).view;
    return { centre: view, cssPixel: 1 / view.zoom, scale: view.zoom, dpr: 1 };
}

/**
 * Whether a marker gesture snaps to the grid: Snap to Grid (SPEC §3, a view preference)
 * inverted while `invert` is held — Ctrl while moving or creating, Alt while resizing (Tiled).
 */
export function snapping(invert: boolean): boolean {
    return viewPreferences.getState().snap !== invert;
}

/** The modifier that inverts snapping while creating or moving markers. */
export const invertsSnap = (modifiers: Readonly<ToolModifiers>) => modifiers.ctrl;

/** The marker layer a create tool adds to, with where it is drawn. */
export interface CreateTarget {
    readonly layerId: number;
    readonly shift: Point;
}

/**
 * The layer a create tool adds to: the active layer, when it is a visible, unlocked marker layer
 * under no hidden or locked group (Tiled disables its object tools otherwise). Otherwise the
 * status bar says why (SPEC §4.1's messages) and null is returned.
 */
export function createTarget(context: ToolContext, view: ToolView): CreateTarget | null {
    const entry = context.layerId === null ? undefined : findLayer(context.map, context.layerId);
    if (entry?.layer.type !== "marker") {
        context.feedback("Not a marker layer");
        return null;
    }
    const values = effectiveValues(entry.layer, entry.ancestors);
    if (!values.visible) {
        context.feedback(REFUSALS.hidden);
        return null;
    }
    if (!values.unlocked) {
        context.feedback(REFUSALS.locked);
        return null;
    }
    return { layerId: entry.layer.id, shift: layerShift(context.map, view.centre, values) };
}

/** Where marker layer `layerId` of the stroke's map is drawn in `view` now; null when it is gone. */
export function layerShiftNow(context: ToolContext, layerId: number, view: ToolView): Point | null {
    const entry = findLayer(context.map, layerId);
    if (!entry) return null;
    return layerShift(context.map, view.centre, effectiveValues(entry.layer, entry.ancestors));
}

/**
 * Runs `make`'s command on the stroke's history. A marker the command refuses (FORMAT limits:
 * `MarkerEditError`) changes nothing and the status bar says why; returns the command when it
 * ran.
 */
export function runMarkerCommand<C extends Command>(context: ToolContext, make: () => C): C | null {
    try {
        const command = make();
        context.history.execute(command);
        return command;
    } catch (error) {
        if (error instanceof MarkerEditError) {
            context.feedback(error.message);
            return null;
        }
        throw error;
    }
}
