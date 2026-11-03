import { useId, useState } from "react";
import type {
    TilesetPropertiesRequest,
    TilesetSourceView,
} from "../../app/tilesets/edit/tilesetProperties";
import { MAX_SLUG_LENGTH, MAX_TEXT_LENGTH, MAX_TILE_OFFSET } from "../../core/model";
import type { TilesetSourceKind } from "../../core/model";
import type { TilesetFields } from "../../core/tileset";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";
import { NumberField } from "../primitives/NumberField";
import "../primitives/field.css";
import "./tilesetProperties.css";

const OFFSET = { min: -MAX_TILE_OFFSET, max: MAX_TILE_OFFSET };

const SOURCE_KINDS: Readonly<Record<TilesetSourceKind, string>> = {
    image: "Grid PNG",
    sprite: "Sprite project",
    atlas: "Sprite atlas",
    collection: "Image collection",
};

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
                className="tileset-properties__text"
                type="text"
                autoComplete="off"
                spellCheck={false}
                maxLength={maxLength}
                aria-invalid={invalid || undefined}
                data-tileset-field={field}
                value={value}
                onChange={(event) => onChange(event.target.value)}
            />
        </>
    );
}

/** A source field: read-only, as Tiled shows a tileset's image source. */
function SourceRow({ label, value, field }: { label: string; value: string; field: string }) {
    const id = useId();
    return (
        <>
            <label className="ui-field__label" htmlFor={id}>
                {label}
            </label>
            <input
                id={id}
                className="tileset-properties__text tileset-properties__text--read-only"
                type="text"
                readOnly
                data-tileset-source={field}
                value={value}
            />
        </>
    );
}

function SourceRows({ source }: { source: TilesetSourceView }) {
    const gridded = source.kind === "image" || source.kind === "sprite";
    return (
        <>
            <SourceRow label="Kind" value={SOURCE_KINDS[source.kind]} field="kind" />
            <SourceRow label="File" value={source.fileName} field="file" />
            <SourceRow
                label="Tile size"
                value={`${source.tileWidth} × ${source.tileHeight} px`}
                field="tile-size"
            />
            {gridded ? (
                <>
                    <SourceRow label="Margin" value={`${source.margin} px`} field="margin" />
                    <SourceRow label="Spacing" value={`${source.spacing} px`} field="spacing" />
                </>
            ) : null}
        </>
    );
}

/**
 * Tileset Properties (DESIGN §9): name, export name, class, tile offset X/Y, and the source
 * read-only (kind, file, tile size, margin, spacing). Nothing changes until OK; the command
 * that opened the dialog applies the values as one undo step.
 */
export function TilesetPropertiesDialog({ request }: { request: TilesetPropertiesRequest }) {
    const [values, setValues] = useState<TilesetFields>(request.initial);
    const formId = useId();
    const offsetId = useId();
    const problems = request.problems(values);
    const messages = [...new Set(Object.values(problems))];
    const valid = messages.length === 0;
    const set = (patch: Partial<TilesetFields>) =>
        setValues((current) => ({ ...current, ...patch }));

    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) request.answer(null);
            }}
            title="Tileset Properties"
            className="tileset-properties"
            actions={
                <>
                    <Button onClick={() => request.answer(null)}>Cancel</Button>
                    <Button
                        variant="primary"
                        type="submit"
                        form={formId}
                        disabled={!valid}
                        data-tileset-properties-ok=""
                    >
                        OK
                    </Button>
                </>
            }
        >
            <form
                id={formId}
                className="tileset-properties__form"
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
                <span className="ui-field__label" id={offsetId}>
                    Tile offset
                </span>
                <div className="tileset-properties__row" role="group" aria-labelledby={offsetId}>
                    <NumberField
                        label="X"
                        value={values.offsetX}
                        onChange={(offsetX) => set({ offsetX })}
                        unit="px"
                        {...OFFSET}
                    />
                    <NumberField
                        label="Y"
                        value={values.offsetY}
                        onChange={(offsetY) => set({ offsetY })}
                        unit="px"
                        {...OFFSET}
                    />
                </div>

                <h3 className="tileset-properties__heading">Source</h3>
                <SourceRows source={request.source} />

                <div className="tileset-properties__messages" role="alert">
                    {messages.map((message) => (
                        <p
                            key={message}
                            className="tileset-properties__message"
                            data-tileset-problem=""
                        >
                            {message}
                        </p>
                    ))}
                </div>
            </form>
        </Dialog>
    );
}
