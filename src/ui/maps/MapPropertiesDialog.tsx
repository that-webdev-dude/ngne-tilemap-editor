import { useId, useState } from "react";
import type { MapPropertiesRequest } from "../../app/maps/mapDialogs";
import { formatHex } from "../../core/color";
import type { MapFields } from "../../core/maps";
import { MAX_PARALLAX_ORIGIN, MAX_SLUG_LENGTH, MAX_TEXT_LENGTH } from "../../core/model";
import { ColourPicker } from "../colour/ColourPicker";
import { cssColour } from "../colour/pickerMath";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";
import { NumberField } from "../primitives/NumberField";
import { Popover } from "../primitives/Popover";
import "../primitives/field.css";
import "./mapDialogs.css";

/** The colour the picker starts from while the map has none: opaque black, as Tiled's. */
const FIRST_BACKGROUND = 0x000000ff;

const PARALLAX_ORIGIN = { min: -MAX_PARALLAX_ORIGIN, max: MAX_PARALLAX_ORIGIN, precision: 2 };

function TextRow({
    label,
    value,
    onChange,
    maxLength,
    invalid,
    field,
}: {
    label: string;
    value: string;
    onChange(value: string): void;
    maxLength: number;
    invalid: boolean;
    field: string;
}) {
    const id = useId();
    return (
        <>
            <label className="ui-field__label" htmlFor={id}>
                {label}
            </label>
            <input
                id={id}
                className="map-form__text"
                type="text"
                autoComplete="off"
                spellCheck={false}
                maxLength={maxLength}
                aria-invalid={invalid || undefined}
                data-map-field={field}
                value={value}
                onChange={(event) => onChange(event.target.value)}
            />
        </>
    );
}

/**
 * The background colour (DESIGN §9): a swatch that opens the colour picker in a popover, with
 * "None" to remove the colour. The picker edits the dialog's value; OK applies it.
 */
function BackgroundRow({
    value,
    onChange,
}: {
    value: number | null;
    onChange(value: number | null): void;
}) {
    const id = useId();
    const [open, setOpen] = useState(false);
    return (
        <>
            <span className="ui-field__label" id={id}>
                Background
            </span>
            <div className="map-form__row" role="group" aria-labelledby={id}>
                <Popover
                    label="Background colour"
                    open={open}
                    onOpenChange={setOpen}
                    className="map-form__picker"
                    trigger={
                        <button
                            type="button"
                            className="map-form__swatch"
                            aria-label={
                                value === null
                                    ? "Background colour: none"
                                    : `Background colour: ${formatHex(value)}`
                            }
                            data-map-background={value === null ? "none" : formatHex(value, true)}
                        >
                            {value === null ? (
                                <span className="map-form__swatch-none">None</span>
                            ) : (
                                <>
                                    <span className="map-form__swatch-colour">
                                        <span style={{ background: cssColour(value) }} />
                                    </span>
                                    <span>{formatHex(value)}</span>
                                </>
                            )}
                        </button>
                    }
                >
                    <ColourPicker
                        value={value ?? FIRST_BACKGROUND}
                        unset={value === null}
                        onChange={onChange}
                    />
                    <div className="map-form__picker-actions">
                        <Button
                            data-map-background-none=""
                            disabled={value === null}
                            onClick={() => {
                                onChange(null);
                                setOpen(false);
                            }}
                        >
                            None
                        </Button>
                    </div>
                </Popover>
            </div>
        </>
    );
}

/**
 * Map Properties (DESIGN §9): name, export name, class, tile size, background colour and
 * parallax origin. Nothing changes until OK; the command that opened the dialog applies the
 * changed values as one undo step.
 */
export function MapPropertiesDialog({ request }: { request: MapPropertiesRequest }) {
    const [values, setValues] = useState<MapFields>(request.initial);
    const formId = useId();
    const tileId = useId();
    const originId = useId();
    const problems = request.problems(values);
    const messages = [...new Set(Object.values(problems))];
    const valid = messages.length === 0;
    const set = (patch: Partial<MapFields>) => setValues((current) => ({ ...current, ...patch }));

    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) request.answer(null);
            }}
            title="Map Properties"
            actions={
                <>
                    <Button onClick={() => request.answer(null)}>Cancel</Button>
                    <Button
                        variant="primary"
                        type="submit"
                        form={formId}
                        disabled={!valid}
                        data-map-properties-ok=""
                    >
                        OK
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
                <TextRow
                    label="Name"
                    field="name"
                    value={values.name}
                    onChange={(name) => set({ name })}
                    maxLength={MAX_TEXT_LENGTH}
                    invalid={problems.name !== undefined}
                />
                <TextRow
                    label="Export name"
                    field="export-name"
                    value={values.exportName}
                    onChange={(exportName) => set({ exportName })}
                    maxLength={MAX_SLUG_LENGTH}
                    invalid={problems.exportName !== undefined}
                />
                <TextRow
                    label="Class"
                    field="class"
                    value={values.class}
                    onChange={(className) => set({ class: className })}
                    maxLength={MAX_TEXT_LENGTH}
                    invalid={problems.class !== undefined}
                />
                <span className="ui-field__label" id={tileId}>
                    Tile size
                </span>
                <div className="map-form__row" role="group" aria-labelledby={tileId}>
                    <NumberField
                        label="Width"
                        value={values.tileWidth}
                        onChange={(tileWidth) => set({ tileWidth })}
                        unit="px"
                    />
                    <NumberField
                        label="Height"
                        value={values.tileHeight}
                        onChange={(tileHeight) => set({ tileHeight })}
                        unit="px"
                    />
                </div>
                <BackgroundRow
                    value={values.backgroundColor}
                    onChange={(backgroundColor) => set({ backgroundColor })}
                />
                <span className="ui-field__label" id={originId}>
                    Parallax origin
                </span>
                <div className="map-form__row" role="group" aria-labelledby={originId}>
                    <NumberField
                        label="X"
                        value={values.parallaxOriginX}
                        onChange={(parallaxOriginX) => set({ parallaxOriginX })}
                        unit="px"
                        {...PARALLAX_ORIGIN}
                    />
                    <NumberField
                        label="Y"
                        value={values.parallaxOriginY}
                        onChange={(parallaxOriginY) => set({ parallaxOriginY })}
                        unit="px"
                        {...PARALLAX_ORIGIN}
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
