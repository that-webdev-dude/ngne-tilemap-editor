// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import {
    assertInvariants,
    createGroupLayer,
    createMarkerLayer,
    createProject,
    createProjectSession,
    createTileLayer,
    sequentialIds,
} from "../../../src/core/model";
import type { Layer } from "../../../src/core/model";

// TE-035 page module: the specs import it into the running editor, so it shares the app's
// stores. It loads "Quest" with one map, "Overworld" (16 × 16), whose layers are
//
//     Markers (5, marker)              top
//     Props (2, group)
//       Trees (4, tile)
//       Rocks (3, tile)
//     Ground (1, tile, active)         bottom
//
// and reads the tree, the active layer and the history back.

const hooks = () => window.__ngneTest!;
const state = () => hooks().session.getState();

export function load(): void {
    const project = createProject({
        name: "Quest",
        newId: sequentialIds("p"),
        map: { name: "Overworld", width: 16, height: 16 },
    });
    const map = project.maps[0]!;
    map.layers[0]!.name = "Ground";
    const props = createGroupLayer(2, "Props");
    props.layers.push(createTileLayer(3, "Rocks"), createTileLayer(4, "Trees"));
    map.layers.push(props, createMarkerLayer(5, "Markers"));
    map.nextLayerId = 6;
    assertInvariants(project);
    state().replace(createProjectSession(project));
}

/** A layer as the specs compare it with a row. */
export interface LayerView {
    id: number;
    name: string;
    type: Layer["type"];
    depth: number;
    visible: boolean;
    locked: boolean;
    opacity: number;
    class: string;
    offsetX: number;
    offsetY: number;
    parallaxX: number;
    parallaxY: number;
}

export interface Snapshot {
    /** Every layer, top of the stack first, children after their group. */
    layers: LayerView[];
    /** The tree as nested names, bottom first: "Ground,Props[Rocks,Trees],Markers". */
    tree: string;
    active: number;
    undo: number;
    undoLabel: string | null;
    redo: number;
}

function views(layers: readonly Layer[], depth: number): LayerView[] {
    return [...layers].reverse().flatMap((layer) => [
        {
            id: layer.id,
            name: layer.name,
            type: layer.type,
            depth,
            visible: layer.visible,
            locked: layer.locked,
            opacity: layer.opacity,
            class: layer.class,
            offsetX: layer.offsetX,
            offsetY: layer.offsetY,
            parallaxX: layer.parallaxX,
            parallaxY: layer.parallaxY,
        },
        ...(layer.type === "group" ? views(layer.layers, depth + 1) : []),
    ]);
}

function tree(layers: readonly Layer[]): string {
    return layers
        .map((layer) =>
            layer.type === "group" ? `${layer.name}[${tree(layer.layers)}]` : layer.name,
        )
        .join(",");
}

export function snapshot(): Snapshot {
    const { session, history } = state();
    const map = session.project.maps.find((each) => each.id === session.activeMapId)!;
    return {
        layers: views(map.layers, 0),
        tree: tree(map.layers),
        active: session.perMap.get(map.id)!.activeLayerId,
        undo: history.undoCount,
        undoLabel: history.undoLabel,
        redo: history.redoCount,
    };
}

export function undo(): boolean {
    return state().history.undo();
}

export function redo(): boolean {
    return state().history.redo();
}
