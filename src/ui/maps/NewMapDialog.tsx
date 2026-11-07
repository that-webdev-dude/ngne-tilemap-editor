import { useId, useState } from "react";
import { NEW_MAP_SIZE_PRESETS } from "../../app/maps/mapDialogs";
import type { NewMapRequest } from "../../app/maps/mapDialogs";
import type { NewMapValues } from "../../core/maps";
import { MAX_TEXT_LENGTH } from "../../core/model";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";
import { NumberField } from "../primitives/NumberField";
import { SegmentedControl } from "../primitives/SegmentedControl";
import "../primitives/field.css";
import "./mapDialogs.css";

const presetValue = (width: number, height: number) => `${width}x${height}`;

const PRESET_OPTIONS = NEW_MAP_SIZE_PRESETS.map(([width, height]) => ({
    value: presetValue(width, height),
    label: `${width} × ${height}`,
}));

/**
 * New Map (DESIGN §9; the sprite editor's New sprite dialog): name, width and height in cells,
 * tile width and height in pixels, and the size presets. The number fields take any number, so
 * that a value out of range is shown with its message instead of being silently changed;
 * Create is disabled until every value is accepted.
 */
export function NewMapDialog({ request }: { request: NewMapRequest }) {
    const [values, setValues] = useState<NewMapValues>(request.initial);
    const formId = useId();
    const nameId = useId();
    const sizeId = useId();
    const tileId = useId();
    const problems = request.problems(values);
    const messages = [...new Set(Object.values(problems))];
    const valid = messages.length === 0;
    const preset = NEW_MAP_SIZE_PRESETS.some(
        ([width, height]) => width === values.width && height === values.height,
    )
        ? presetValue(values.width, values.height)
        : "";
    const change = (patch: Partial<NewMapValues>) =>
        setValues((current) => ({ ...current, ...patch }));

    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) request.answer(null);
            }}
            title="New Map"
            actions={
                <>
                    <Button onClick={() => request.answer(null)}>Cancel</Button>
                    <Button
                        variant="primary"
                        type="submit"
                        form={formId}
                        disabled={!valid}
                        data-new-map-create=""
                    >
                        Create
                    </Button>
                </>
            }
        >
            <form
                id={formId}
                className="map-form"
                noValidate
                onSubmit={(event) => {
                    event.preventDefault();
                    if (valid) request.answer(values);
                }}
            >
                <label className="ui-field__label" htmlFor={nameId}>
                    Name
                </label>
                <input
                    id={nameId}
                    className="map-form__text"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={MAX_TEXT_LENGTH}
                    aria-invalid={problems.name !== undefined || undefined}
                    data-map-field="name"
                    value={values.name}
                    onChange={(event) => change({ name: event.target.value })}
                />
                <span className="ui-field__label" id={sizeId}>
                    Map size
                </span>
                <div className="map-form__row" role="group" aria-labelledby={sizeId}>
                    <NumberField
                        label="Width"
                        value={values.width}
                        onChange={(width) => change({ width })}
                        unit="cells"
                    />
                    <NumberField
                        label="Height"
                        value={values.height}
                        onChange={(height) => change({ height })}
                        unit="cells"
                    />
                </div>
                <span className="map-form__gap" />
                <SegmentedControl
                    label="Size presets"
                    value={preset}
                    onChange={(value) => {
                        const [width, height] = value.split("x").map(Number);
                        change({ width: width!, height: height! });
                    }}
                    options={PRESET_OPTIONS}
                />
                <span className="ui-field__label" id={tileId}>
                    Tile size
                </span>
                <div className="map-form__row" role="group" aria-labelledby={tileId}>
                    <NumberField
                        label="Width"
                        value={values.tileWidth}
                        onChange={(tileWidth) => change({ tileWidth })}
                        unit="px"
                    />
                    <NumberField
                        label="Height"
                        value={values.tileHeight}
                        onChange={(tileHeight) => change({ tileHeight })}
                        unit="px"
                    />
                </div>
                <div className="map-form__messages" role="alert">
                    {messages.map((message) => (
                        <p key={message} className="map-form__message" data-map-problem="">
                            {message}
                        </p>
                    ))}
                </div>
            </form>
        </Dialog>
    );
}
