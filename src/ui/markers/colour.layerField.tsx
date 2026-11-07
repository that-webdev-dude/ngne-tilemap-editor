import { useId } from "react";
import { markerColourFieldCommand } from "../../app/markers/markerLayers";
import type { MarkerLayer } from "../../core/model";
import { ColourPicker } from "../colour/ColourPicker";
import type { LayerField, LayerFieldProps } from "../layers/layerFields";

// The colour of a marker layer in the layer properties popover (DESIGN §8.2; TE-037): the colour
// its markers are drawn in on the overlay (DESIGN §4), edited with the colour panel and applied
// when the popover closes, with the popover's other fields, as one undo step.

function ColourField({ value, onChange }: LayerFieldProps<number>) {
    const id = useId();
    return (
        <div role="group" aria-labelledby={id} data-marker-colour="">
            <span className="ui-field__label" id={id}>
                Colour
            </span>
            <ColourPicker value={value} onChange={onChange} />
        </div>
    );
}

export const layerField: LayerField<number> = {
    id: "colour",
    order: 10,
    appliesTo: (layer) => layer.type === "marker",
    read: (layer) => (layer as MarkerLayer).color,
    command: (project, mapId, layerId, value) =>
        markerColourFieldCommand(project, mapId, layerId, value),
    Field: ColourField,
};
