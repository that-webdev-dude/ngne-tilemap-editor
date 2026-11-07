import { Popover as RadixPopover } from "radix-ui";
import { memo, useCallback, useId, useMemo } from "react";
import type { RefObject } from "react";
import {
    editLayerExtra,
    editLayerProperties,
    finishLayerProperties,
    useLayersPanel,
} from "../../app/layers/layersPanel";
import type { LayerPropertiesDraft } from "../../app/layers/layersPanel";
import { useSession } from "../../app/state/session";
import { MAX_LAYER_OFFSET, MAX_PARALLAX, MAX_TEXT_LENGTH, findLayer } from "../../core/model";
import type { Layer } from "../../core/model";
import { NumberField } from "../primitives/NumberField";
import { Slider } from "../primitives/Slider";
import { useClosingPopover } from "../timeline/useClosingPopover";
import { extraCommands, layerFields } from "./layerFields";
import "../primitives/popover.css";

// The layer properties popover (DESIGN §8.2; TE-035; pattern of the sprite editor's
// `ui/timeline/LayerProperties.tsx`): name, class, opacity slider, offset X/Y and parallax X/Y,
// then the fields a layer kind registers (`*.layerField.tsx`: image and repeat, TE-036; marker
// colour, TE-037). What it shows changes nothing until it closes — by Enter, Escape or a press
// outside — and then once, in one undo step (`finishLayerProperties`). It is modal: a press
// outside closes it without reaching what lies there. It stays mounted for the frames that show
// the step and gives the focus back at once (`useClosingPopover`).

/** Applies the open popover: its fields and the kind fields that changed, one undo step. */
export function finishProperties(): void {
    finishLayerProperties((project, draft, layer) =>
        extraCommands(layerFields, project, draft.mapId, layer, draft.extras),
    );
}

const LayerPropertiesContent = memo(function LayerPropertiesContent({
    draft,
    layer,
    returnToRef,
    contentRef,
}: {
    draft: LayerPropertiesDraft;
    layer: Layer;
    returnToRef: RefObject<Element | null>;
    contentRef: RefObject<HTMLDivElement | null>;
}) {
    const nameId = useId();
    const classId = useId();
    const offset = { min: -MAX_LAYER_OFFSET, max: MAX_LAYER_OFFSET, step: 1 };
    const parallax = { min: -MAX_PARALLAX, max: MAX_PARALLAX, step: 0.1, precision: 4 };
    const kindFields = layerFields.filter((field) => field.appliesTo(layer));
    return (
        <RadixPopover.Portal>
            <RadixPopover.Content
                ref={contentRef}
                className="ui-popover layer-properties"
                aria-label="Layer properties"
                data-layer-properties=""
                side="left"
                align="start"
                sideOffset={6}
                collisionPadding={8}
                onOpenAutoFocus={() => {
                    returnToRef.current = document.activeElement;
                }}
                onCloseAutoFocus={(event) => {
                    // The host moved the focus already, in the commit that closed the popover.
                    event.preventDefault();
                }}
            >
                <form
                    className="layer-properties__form"
                    noValidate
                    onSubmit={(event) => {
                        event.preventDefault();
                        finishProperties();
                    }}
                    onKeyDown={(event) => {
                        // Enter in a field applies (a number field has taken its value first).
                        if (event.key === "Enter" && !event.defaultPrevented) {
                            event.preventDefault();
                            finishProperties();
                        }
                    }}
                >
                    <label className="ui-field__label" htmlFor={nameId}>
                        Name
                    </label>
                    <input
                        id={nameId}
                        className="layer-properties__text"
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={MAX_TEXT_LENGTH}
                        data-layer-field="name"
                        value={draft.name}
                        onChange={(event) => editLayerProperties({ name: event.target.value })}
                    />
                    <label className="ui-field__label" htmlFor={classId}>
                        Class
                    </label>
                    <input
                        id={classId}
                        className="layer-properties__text"
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={MAX_TEXT_LENGTH}
                        data-layer-field="class"
                        value={draft.class}
                        onChange={(event) => editLayerProperties({ class: event.target.value })}
                    />
                    <Slider
                        className="layer-properties__wide"
                        label="Opacity"
                        min={0}
                        max={255}
                        value={draft.opacity}
                        onChange={(opacity) => editLayerProperties({ opacity })}
                    />
                    <div className="layer-properties__pair">
                        <NumberField
                            label="Offset X"
                            unit="px"
                            {...offset}
                            value={draft.offsetX}
                            onChange={(offsetX) => editLayerProperties({ offsetX })}
                        />
                        <NumberField
                            label="Offset Y"
                            unit="px"
                            {...offset}
                            value={draft.offsetY}
                            onChange={(offsetY) => editLayerProperties({ offsetY })}
                        />
                        <NumberField
                            label="Parallax X"
                            {...parallax}
                            value={draft.parallaxX}
                            onChange={(parallaxX) => editLayerProperties({ parallaxX })}
                        />
                        <NumberField
                            label="Parallax Y"
                            {...parallax}
                            value={draft.parallaxY}
                            onChange={(parallaxY) => editLayerProperties({ parallaxY })}
                        />
                    </div>
                    {kindFields.map(({ id, read, Field }) => (
                        <div key={id} className="layer-properties__wide" data-layer-kind-field={id}>
                            <Field
                                layer={layer}
                                value={
                                    (id in draft.extras ? draft.extras[id] : read(layer)) as never
                                }
                                onChange={(value: unknown) => editLayerExtra(id, value)}
                            />
                        </div>
                    ))}
                </form>
            </RadixPopover.Content>
        </RadixPopover.Portal>
    );
});

/**
 * The popover's place in the Layers panel: a modal `RadixPopover.Root` whose anchor is the row
 * of the popover's layer in `tree` (a virtual anchor, so the row is not rebuilt when it opens).
 */
export const LayerPropertiesHost = memo(function LayerPropertiesHost({
    tree,
    fallback,
}: {
    tree: RefObject<HTMLElement | null>;
    fallback(): void;
}) {
    const properties = useLayersPanel((state) => state.properties);
    const { shown, opening, contentRef, returnToRef } = useClosingPopover(properties, fallback);
    const layerId = shown?.layerId ?? null;
    const layer = useSession((state) => {
        if (!shown) return null;
        const map = state.session.project.maps.find((each) => each.id === shown.mapId);
        return map ? (findLayer(map, shown.layerId)?.layer ?? null) : null;
    });
    const anchor = useMemo(
        () => ({
            current: {
                getBoundingClientRect: (): DOMRect => {
                    const row =
                        layerId === null
                            ? null
                            : (tree.current?.querySelector(`[data-layer-row="${layerId}"]`) ??
                              null);
                    return (row ?? tree.current ?? document.body).getBoundingClientRect();
                },
            },
        }),
        [tree, layerId],
    );
    const onOpenChange = useCallback((open: boolean) => {
        if (!open) finishProperties();
    }, []);
    return (
        <RadixPopover.Root
            modal
            open={shown !== null && layer !== null}
            onOpenChange={onOpenChange}
        >
            <RadixPopover.Anchor virtualRef={anchor} />
            {shown && layer ? (
                <LayerPropertiesContent
                    key={opening}
                    draft={shown}
                    layer={layer}
                    returnToRef={returnToRef}
                    contentRef={contentRef}
                />
            ) : null}
        </RadixPopover.Root>
    );
});
