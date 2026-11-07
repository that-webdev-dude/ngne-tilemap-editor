import { MoveHorizontal, MoveVertical } from "lucide-react";
import { repeatFieldCommand } from "../../app/images/imageLayers";
import type { ImageRepeat } from "../../core/images";
import type { ImageLayer } from "../../core/model";
import type { LayerField, LayerFieldProps } from "../layers/layerFields";
import { Icon } from "../primitives/Icon";
import { Toggle } from "../primitives/Toggle";
import "./images.css";

// Repeat X and Repeat Y of an image layer in the layer properties popover (DESIGN §8.2; FORMAT
// §3.4: the image tiles without end along that axis), applied when the popover closes.

function RepeatField({ value, onChange }: LayerFieldProps<ImageRepeat>) {
    return (
        <div className="image-repeat" role="group" aria-label="Repeat">
            <Toggle
                label="Repeat X"
                showLabel
                pressed={value.repeatX}
                onPressedChange={(repeatX) => onChange({ ...value, repeatX })}
                data-image-repeat="x"
            >
                <Icon icon={MoveHorizontal} />
            </Toggle>
            <Toggle
                label="Repeat Y"
                showLabel
                pressed={value.repeatY}
                onPressedChange={(repeatY) => onChange({ ...value, repeatY })}
                data-image-repeat="y"
            >
                <Icon icon={MoveVertical} />
            </Toggle>
        </div>
    );
}

export const layerField: LayerField<ImageRepeat> = {
    id: "repeat",
    order: 20,
    appliesTo: (layer) => layer.type === "image",
    read: (layer) => ({
        repeatX: (layer as ImageLayer).repeatX,
        repeatY: (layer as ImageLayer).repeatY,
    }),
    equals: (a, b) => a.repeatX === b.repeatX && a.repeatY === b.repeatY,
    command: (project, mapId, layerId, value) => repeatFieldCommand(project, mapId, layerId, value),
    Field: RepeatField,
};
