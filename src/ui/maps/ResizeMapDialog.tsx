import { useEffect, useId, useRef, useState } from "react";
import type { ResizeMapRequest } from "../../app/maps/mapDialogs";
import { RESIZE_ANCHORS, anchorOffset, clampOffset, offsetRange } from "../../core/maps";
import type { ResizeMapValues } from "../../core/maps";
import type { PixelBuffer } from "../../core/model";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";
import { NumberField } from "../primitives/NumberField";
import { PivotGrid } from "../sprite/PivotGrid";
import type { Pivot } from "../sprite/PivotGrid";
import "../primitives/field.css";
import "./mapDialogs.css";

/** The largest box the preview takes, in CSS pixels. */
const PREVIEW_WIDTH = 256;
const PREVIEW_HEIGHT = 160;

/** A positive whole number, or `fallback`. */
const side = (value: number, fallback: number) =>
    Number.isInteger(value) && value > 0 ? value : fallback;

/** The offsets of `anchor` for a map going from `from` to the size in `values`. */
function anchoredOffsets(
    anchor: Pivot,
    from: ResizeMapRequest["from"],
    values: ResizeMapValues,
): Pick<ResizeMapValues, "offsetX" | "offsetY"> {
    return {
        offsetX: anchorOffset(anchor.x, from.width, side(values.width, from.width)),
        offsetY: anchorOffset(anchor.y, from.height, side(values.height, from.height)),
    };
}

/** The anchor whose offsets are those of `values`; null when none is. */
function anchorOf(from: ResizeMapRequest["from"], values: ResizeMapValues): Pivot | null {
    const anchor = RESIZE_ANCHORS.find((each) => {
        const offsets = anchoredOffsets(each, from, values);
        return offsets.offsetX === values.offsetX && offsets.offsetY === values.offsetY;
    });
    return anchor ? { x: anchor.x, y: anchor.y } : null;
}

/** The map's thumbnail on a canvas of its own pixels, stretched over the old bounds. */
function Thumbnail({ preview }: { preview: PixelBuffer }) {
    const canvas = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const element = canvas.current;
        if (!element) return;
        const data = new Uint8ClampedArray(preview.data);
        element
            .getContext("2d")
            ?.putImageData(new ImageData(data, preview.width, preview.height), 0, 0);
    }, [preview]);
    return (
        <canvas
            ref={canvas}
            className="resize-preview__thumbnail"
            width={preview.width}
            height={preview.height}
        />
    );
}

/**
 * The preview of Resize / Offset Map (DESIGN §9; Tiled's `ResizeHelper`): the new bounds as a
 * solid outline and the old map, its thumbnail at half opacity with a dashed outline, at the
 * offset, both scaled to fit the box, in map pixels.
 */
function ResizePreview({
    request,
    values,
}: {
    request: ResizeMapRequest;
    values: ResizeMapValues;
}) {
    const { from, preview } = request;
    const { tileWidth, tileHeight } = from;
    const newWidth = side(values.width, from.width) * tileWidth;
    const newHeight = side(values.height, from.height) * tileHeight;
    const oldWidth = from.width * tileWidth;
    const oldHeight = from.height * tileHeight;
    const offsetX = (Number.isFinite(values.offsetX) ? values.offsetX : 0) * tileWidth;
    const offsetY = (Number.isFinite(values.offsetY) ? values.offsetY : 0) * tileHeight;
    const left = Math.min(0, offsetX);
    const top = Math.min(0, offsetY);
    const right = Math.max(newWidth, offsetX + oldWidth);
    const bottom = Math.max(newHeight, offsetY + oldHeight);
    const scale = Math.min(PREVIEW_WIDTH / (right - left), PREVIEW_HEIGHT / (bottom - top));
    const box = (x: number, y: number, width: number, height: number) => ({
        left: `${(x - left) * scale}px`,
        top: `${(y - top) * scale}px`,
        width: `${width * scale}px`,
        height: `${height * scale}px`,
    });
    return (
        <div
            className="resize-preview"
            data-resize-preview=""
            role="img"
            aria-label={`The old map at offset ${values.offsetX}, ${values.offsetY} of the new bounds`}
            style={{ width: `${(right - left) * scale}px`, height: `${(bottom - top) * scale}px` }}
        >
            <div
                className="resize-preview__new"
                data-resize-new=""
                style={box(0, 0, newWidth, newHeight)}
            />
            <div
                className="resize-preview__old"
                data-resize-old=""
                style={box(offsetX, offsetY, oldWidth, oldHeight)}
            >
                <Thumbnail preview={preview} />
            </div>
        </div>
    );
}

/**
 * Resize / Offset Map (DESIGN §9; Tiled's Resize Map dialog, the sprite editor's Canvas size):
 * width and height in cells, the offset of the old map in the new one, the anchor grid that
 * sets the offset, and a preview of the old map inside the new bounds. While an anchor is
 * checked, a new size keeps the old map at that anchor; with none, the offset is moved into its
 * range, as Tiled's `ResizeHelper` does. The number fields take any number, so that a value out
 * of range is shown with its message; OK is disabled until every value is accepted. Nothing
 * changes until OK.
 */
export function ResizeMapDialog({ request }: { request: ResizeMapRequest }) {
    const { from } = request;
    const [values, setValues] = useState<ResizeMapValues>(request.initial);
    const [anchor, setAnchor] = useState<Pivot | null>(() => anchorOf(from, request.initial));
    const formId = useId();
    const sizeId = useId();
    const offsetId = useId();
    const problems = request.problems(values);
    const messages = [...new Set(Object.values(problems))];
    const valid = messages.length === 0;

    const resize = (patch: Pick<Partial<ResizeMapValues>, "width" | "height">) => {
        const next = { ...values, ...patch };
        if (anchor) return setValues({ ...next, ...anchoredOffsets(anchor, from, next) });
        const width = side(next.width, from.width);
        const height = side(next.height, from.height);
        setValues({
            ...next,
            offsetX: clampOffset(next.offsetX, offsetRange(from.width, width)),
            offsetY: clampOffset(next.offsetY, offsetRange(from.height, height)),
        });
    };
    const offset = (patch: Pick<Partial<ResizeMapValues>, "offsetX" | "offsetY">) => {
        const next = { ...values, ...patch };
        setValues(next);
        setAnchor(anchorOf(from, next));
    };
    const anchorAt = (next: Pivot) => {
        setAnchor(next);
        setValues({ ...values, ...anchoredOffsets(next, from, values) });
    };

    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) request.answer(null);
            }}
            title="Resize / Offset Map"
            actions={
                <>
                    <Button onClick={() => request.answer(null)}>Cancel</Button>
                    <Button
                        variant="primary"
                        type="submit"
                        form={formId}
                        disabled={!valid}
                        data-resize-ok=""
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
                <span className="ui-field__label" id={sizeId}>
                    Size
                </span>
                <div className="map-form__row" role="group" aria-labelledby={sizeId}>
                    <NumberField
                        label="Width"
                        value={values.width}
                        onChange={(width) => resize({ width })}
                        unit="cells"
                    />
                    <NumberField
                        label="Height"
                        value={values.height}
                        onChange={(height) => resize({ height })}
                        unit="cells"
                    />
                </div>
                <span className="ui-field__label" id={offsetId}>
                    Offset
                </span>
                <div className="map-form__row" role="group" aria-labelledby={offsetId}>
                    <NumberField
                        label="X"
                        value={values.offsetX}
                        onChange={(offsetX) => offset({ offsetX })}
                        unit="cells"
                    />
                    <NumberField
                        label="Y"
                        value={values.offsetY}
                        onChange={(offsetY) => offset({ offsetY })}
                        unit="cells"
                    />
                </div>
                <span className="ui-field__label" aria-hidden="true">
                    Anchor
                </span>
                <div className="map-form__row">
                    <PivotGrid label="Anchor" value={anchor} onChange={anchorAt} />
                </div>
                <span className="ui-field__label" aria-hidden="true">
                    Preview
                </span>
                <div className="map-form__row">
                    <ResizePreview request={request} values={values} />
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
