import { imageFieldCommand, imageOptions, readImageFile } from "../../app/images/imageLayers";
import { sessionStore, useSession } from "../../app/state/session";
import { choiceImageId } from "../../core/images";
import type { ImageChoice } from "../../core/images";
import type { ImageLayer } from "../../core/model";
import type { LayerField, LayerFieldProps } from "../layers/layerFields";
import { ImageChooser } from "./ImageChooser";

// The image of an image layer in the layer properties popover (DESIGN §8.2): one of the
// project's images or an imported PNG, applied when the popover closes; an image the layer no
// longer shows and no other layer uses is removed in the same step (SPEC §7.2).

function ImageField({ value, onChange }: LayerFieldProps<ImageChoice>) {
    // The images change in place: their IDs tell when the list changed.
    useSession((state) => state.session.project.images.map((image) => image.id).join("\n"));
    const images = imageOptions(sessionStore.getState().session.project);
    return (
        <ImageChooser
            images={images}
            value={value}
            onChange={onChange}
            readFile={(file) => readImageFile(file)}
        />
    );
}

export const layerField: LayerField<ImageChoice> = {
    id: "image",
    order: 10,
    appliesTo: (layer) => layer.type === "image",
    read: (layer) => ({ imageId: (layer as ImageLayer).imageId }),
    equals: (a, b) => choiceImageId(a) === choiceImageId(b),
    command: (project, mapId, layerId, value) => imageFieldCommand(project, mapId, layerId, value),
    Field: ImageField,
};
