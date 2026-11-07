import { useState } from "react";
import type { NewImageLayerRequest } from "../../app/images/imageLayers";
import type { ImageChoice } from "../../core/images";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";
import { ImageChooser } from "./ImageChooser";

/**
 * New Image Layer (DESIGN §9): the image of the new layer, one of the project's (the first is
 * chosen) or an imported PNG; Create adds the layer, with the image when it is new.
 */
export function NewImageLayerDialog({ request }: { request: NewImageLayerRequest }) {
    const first = request.images[0];
    const [choice, setChoice] = useState<ImageChoice | null>(first ? { imageId: first.id } : null);
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) request.answer(null);
            }}
            title="New Image Layer"
            actions={
                <>
                    <Button onClick={() => request.answer(null)}>Cancel</Button>
                    <Button
                        variant="primary"
                        disabled={choice === null}
                        onClick={() => {
                            if (choice) request.answer(choice);
                        }}
                        data-new-image-layer-create=""
                    >
                        Create
                    </Button>
                </>
            }
        >
            <div className="new-image-layer">
                <ImageChooser
                    images={request.images}
                    value={choice}
                    onChange={setChoice}
                    readFile={request.readFile}
                />
            </div>
        </Dialog>
    );
}
