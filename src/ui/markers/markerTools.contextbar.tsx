import { useSyncExternalStore } from "react";
import { markerBoxFields, setMarkerBoxField } from "../../app/markers/markerFields";
import type { MarkerBoxField } from "../../app/markers/markerFields";
import { subscribeMarkerDraft } from "../../app/markers/markerSelection";
import { sessionStore } from "../../app/state/session";
import { toolState } from "../../app/tools/activeTool";
import { useViewPreference, viewPreferences } from "../../app/view/viewPreferences";
import { NumberField } from "../primitives/NumberField";
import { Toggle } from "../primitives/Toggle";
import type { ContextBarContent } from "../tools/contextBarRegistry";

// The context bars of the marker tools (DESIGN §7; TE-038): the select tool shows X, Y, W and H
// of the selection's box (px) and Snap; the create tools show Snap. Snap is the Snap to Grid view
// preference (SPEC §3), the same as View → Snap to Grid. Registered as context bar content so it
// takes the options' place while a marker tool is active (contextBarRegistry.ts).

const SELECT = "markerSelect";
const CREATE = new Set([
    "markerRectangle",
    "markerEllipse",
    "markerPoint",
    "markerPolygon",
    "markerPolyline",
]);

const FIELDS: readonly { key: MarkerBoxField; label: string }[] = [
    { key: "x", label: "X" },
    { key: "y", label: "Y" },
    { key: "width", label: "W" },
    { key: "height", label: "H" },
];

/** Coordinates a field takes (FORMAT §2.5: ±1 048 576; a size up to twice that). */
const LIMIT = 1_048_576;

function subscribeFields(listener: () => void): () => void {
    const stops = [sessionStore.subscribe(listener), subscribeMarkerDraft(listener)];
    return () => stops.forEach((stop) => stop());
}

/** The fields' snapshot as text, so React sees a stable value between changes. */
function fieldsSnapshot(): string {
    return JSON.stringify(markerBoxFields());
}

function SnapToggle() {
    const snap = useViewPreference("snap");
    return (
        <Toggle
            data-marker-snap=""
            label="Snap"
            pressed={snap}
            onPressedChange={(pressed) => viewPreferences.getState().set("snap", pressed)}
            showLabel
        />
    );
}

function BoxFields() {
    const snapshot = useSyncExternalStore(subscribeFields, fieldsSnapshot);
    const fields = JSON.parse(snapshot) as ReturnType<typeof markerBoxFields>;
    return (
        <>
            {FIELDS.map(({ key, label }) => {
                const size = key === "width" || key === "height";
                return (
                    <span key={key} data-marker-field={key}>
                        <NumberField
                            label={label}
                            unit="px"
                            value={fields ? fields.box[key] : 0}
                            min={size ? 0 : -LIMIT}
                            max={size ? 2 * LIMIT : LIMIT}
                            precision={3}
                            disabled={!fields || (size && !fields.sizable)}
                            onChange={(value) => setMarkerBoxField(key, value)}
                        />
                    </span>
                );
            })}
        </>
    );
}

function MarkerToolBar() {
    const select = toolState.activeId() === SELECT;
    return (
        <>
            {select ? <BoxFields /> : null}
            <SnapToggle />
        </>
    );
}

export const contextBarContent: ContextBarContent = {
    id: "marker-tools",
    order: 50,
    shown: () => {
        const id = toolState.activeId();
        return toolState.kind() === "marker" && (id === SELECT || CREATE.has(id));
    },
    subscribe: (listener) => toolState.subscribe(listener),
    Body: MarkerToolBar,
};
