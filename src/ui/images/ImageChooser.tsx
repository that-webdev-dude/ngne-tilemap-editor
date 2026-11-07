import { useState } from "react";
import type { ImageFileResult, ImageOption } from "../../app/images/imageLayers";
import { pickImageFile } from "../../app/images/pickImageFile";
import type { PickedFile } from "../../app/tilesets/import/importSources";
import { choiceImageId } from "../../core/images";
import type { ImageChoice } from "../../core/images";
import { Button } from "../primitives/Button";
import { Select } from "../primitives/Select";
import "./images.css";

// The image of an image layer (SPEC §7.2): one of the project's images, or a PNG picked with
// Import PNG…, read by the app (header checked, decoded in the worker). A new image shows in the
// list as long as it is the one chosen; it joins the project with the command that uses it.

export interface ImageChooserProps {
    /** The project's images. */
    images: readonly ImageOption[];
    value: ImageChoice | null;
    onChange(choice: ImageChoice): void;
    readFile(file: PickedFile): Promise<ImageFileResult>;
}

function optionLabel({ name, width, height }: ImageOption): string {
    return `${name} (${width} × ${height})`;
}

export function ImageChooser({ images, value, onChange, readFile }: ImageChooserProps) {
    const [problem, setProblem] = useState<string | null>(null);
    const [reading, setReading] = useState(false);
    const added: ImageOption | null =
        value && "image" in value
            ? {
                  id: value.image.id,
                  name: value.image.name,
                  width: value.image.pixels.width,
                  height: value.image.pixels.height,
              }
            : null;
    const all = added ? [...images, added] : images;
    const options = all.map((option) => ({
        value: option.id,
        label: option === added ? `${optionLabel(option)}, new` : optionLabel(option),
    }));

    const importPng = async () => {
        const file = await pickImageFile();
        if (!file) return;
        setReading(true);
        try {
            const result = await readFile(file);
            if (result.ok) {
                setProblem(null);
                onChange(result.choice);
            } else {
                setProblem(result.problem);
            }
        } finally {
            setReading(false);
        }
    };

    return (
        <div className="image-chooser" data-image-chooser="">
            {all.length > 0 ? (
                <Select
                    className="image-chooser__select"
                    label="Image"
                    value={value ? choiceImageId(value) : ""}
                    onChange={(id) => {
                        if (added && id === added.id && value) onChange(value);
                        else onChange({ imageId: id });
                    }}
                    options={options}
                />
            ) : (
                <p className="image-chooser__empty" data-image-none="">
                    The project has no image yet.
                </p>
            )}
            <Button
                className="image-chooser__import"
                onClick={() => void importPng()}
                disabled={reading}
                data-image-import=""
            >
                {reading ? "Reading…" : "Import PNG…"}
            </Button>
            {problem ? (
                <p className="image-chooser__problem" role="alert" data-image-problem="">
                    {problem}
                </p>
            ) : null}
        </div>
    );
}
