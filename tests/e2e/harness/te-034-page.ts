// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import {
    duplicateLayers,
    groupLayers,
    moveLayer,
    selectLayer,
    setLayerValues,
    ungroup,
} from "../../../src/app/layers/layers";
import { notices } from "../../../src/app/notices/notices";
import { viewPreferences } from "../../../src/app/view/viewPreferences";
import type { LayerValues } from "../../../src/core/layers";
import type { Layer } from "../../../src/core/model";
import { readCanvas } from "../../../src/engine/testing/readCanvas";
import { referenceHighlight } from "./te-034-highlight";

// TE-034 page module: the specs import it into the running editor (`import("/tests/e2e/harness/
// te-034-page.ts")`), so it shares the app's stores. It runs the app's layer commands (the
// functions the registered commands call, on the app's history) on the TE-013 and TE-015 scenes,
// whose page modules compare the canvas with `core/compositor`.

export type Step =
    | { kind: "set"; ids: number[]; values: Partial<LayerValues> }
    | { kind: "group"; ids: number[] }
    | { kind: "ungroup"; ids: number[] }
    | { kind: "duplicate"; ids: number[] }
    | { kind: "move"; id: number; step: -1 | 1 }
    | { kind: "select"; id: number }
    | { kind: "highlight"; on: boolean };

export interface LayerState {
    /** The tree as nested names, bottom first: "Base,Group 1[Faint,Far]". */
    tree: string;
    active: number;
    /** The highlight the references expect; null when off. */
    highlight: { layerId: number; factor: number } | null;
}

function tree(layers: readonly Layer[]): string {
    return layers
        .map((layer) =>
            layer.type === "group"
                ? `${layer.name}[${tree(layer.layers)}]`
                : `${layer.name}${layer.visible ? "" : "(hidden)"}`,
        )
        .join(",");
}

export function state(): LayerState {
    const { session } = window.__ngneTest!.session.getState();
    const map = session.project.maps.find((each) => each.id === session.activeMapId)!;
    return {
        tree: tree(map.layers),
        active: session.perMap.get(map.id)!.activeLayerId,
        highlight: referenceHighlight(),
    };
}

/** Runs one step through the app's layer functions; returns the state after it. */
export function act(step: Step): LayerState {
    switch (step.kind) {
        case "set":
            setLayerValues(step.values, step.ids);
            break;
        case "group":
            groupLayers(step.ids);
            break;
        case "ungroup":
            ungroup(step.ids);
            break;
        case "duplicate":
            duplicateLayers(step.ids);
            break;
        case "move":
            moveLayer(step.step, step.id);
            break;
        case "select":
            selectLayer(step.id);
            break;
        case "highlight":
            viewPreferences.getState().set("highlightLayer", step.on);
            break;
    }
    return state();
}

/** Submits a frame and returns a hash of the canvas read in the same task. */
export function canvasHash(): string {
    const viewport = window.__ngneTest!.viewport!;
    if (!viewport.renderNow()) throw new Error("te-034: the renderer did not submit a frame");
    const { data } = readCanvas(viewport.canvas);
    let hash = 0x811c9dc5;
    for (let i = 0; i < data.length; i += 1) {
        hash ^= data[i]!;
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16);
}

const messages: string[] = [];
let detach: (() => void) | null = null;

/** Starts collecting the app's notices (info and error), from now on. */
export function collectNotices(): void {
    detach?.();
    messages.length = 0;
    detach = notices.attachSink((_kind, message) => messages.push(message));
}

export function collected(): string[] {
    return [...messages];
}
