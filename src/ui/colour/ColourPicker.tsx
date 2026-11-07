import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { formatHex, hsvToRgb, packRgba, parseHex, rgbToHsv, unpackRgba } from "../../core/color";
import type { Hsv } from "../../core/color";
import { NumberField } from "../primitives/NumberField";
import { SegmentedControl } from "../primitives/SegmentedControl";
import { cancelNextContextMenu } from "./cancelContextMenu";
import {
    changeHsv,
    keyAlpha,
    keyHue,
    keySaturationValue,
    pickAlpha,
    pickHue,
    pickSaturationValue,
    storedHsv,
} from "./pickerEdits";
import type { Box, ColourStore, PickerColour } from "./pickerEdits";
import { cssColour } from "./pickerMath";
import "./colourPicker.css";

// The colour panel (DESIGN §3.3, after the sprite editor's DESIGN §5.3): a saturation/value
// field, a hue strip and an alpha strip, a hex field, and H S V or R G B fields chosen with a
// segmented control. It edits one colour given by its caller (a map's background colour, a
// layer or terrain colour, a colour property), with either button, as the sprite editor's
// swatch editor does; each change goes to the caller's `onChange`. Every control works from the
// keyboard (arrow keys on the field and the strips). What each control does to the colour is in
// `pickerEdits.ts`.

const Picker = createContext<ColourStore | null>(null);

function usePickerStore(): ColourStore {
    const store = useContext(Picker);
    if (!store) throw new Error("A colour control is used outside its ColourPicker.");
    return store;
}

/** Whether a key comes with a modifier that leaves it to the shortcuts. */
function chorded(event: KeyboardEvent): boolean {
    return event.ctrlKey || event.altKey || event.metaKey;
}

/** The inner box of an element in client pixels: inside its border. */
function innerBox(element: Element): Box {
    const rect = element.getBoundingClientRect();
    return {
        left: rect.left + element.clientLeft,
        top: rect.top + element.clientTop,
        width: element.clientWidth,
        height: element.clientHeight,
    };
}

type Pick = (x: number, y: number, element: HTMLElement) => void;

/**
 * The pointer of the field and the strips: a left or right press edits the colour, through the
 * drag that follows. The context menu of a right press is cancelled.
 */
function useColourDrag(pick: Pick) {
    const drag = useRef<{ pointerId: number; button: number } | null>(null);
    const end = (event: PointerEvent<HTMLElement>) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current = null;
    };
    return {
        onPointerDown(event: PointerEvent<HTMLElement>) {
            if (drag.current || (event.button !== 0 && event.button !== 2)) return;
            if (event.button === 2) cancelNextContextMenu();
            // No text selection from the drag. The control takes the focus itself, so a
            // field being typed in commits first.
            event.preventDefault();
            const element = event.currentTarget;
            element.focus({ preventScroll: true });
            try {
                element.setPointerCapture(event.pointerId);
            } catch {
                // The pointer is gone already; its release or cancel ends the drag.
            }
            drag.current = { pointerId: event.pointerId, button: event.button };
            pick(event.clientX, event.clientY, element);
        },
        onPointerMove(event: PointerEvent<HTMLElement>) {
            const current = drag.current;
            if (!current || current.pointerId !== event.pointerId) return;
            // Its button released while another stays down: the drag ends.
            if ((event.buttons & (current.button === 2 ? 2 : 1)) === 0) {
                end(event);
                return;
            }
            pick(event.clientX, event.clientY, event.currentTarget);
        },
        onPointerUp: end,
        onPointerCancel: end,
        onLostPointerCapture: end,
        onContextMenu: (event: MouseEvent<HTMLElement>) => event.preventDefault(),
    };
}

/** The saturation/value square: saturation from left to right, value from bottom to top. */
function SaturationValueField({ hsv }: { hsv: Hsv }) {
    const store = usePickerStore();
    const drag = useColourDrag((x, y, element) =>
        pickSaturationValue(store, innerBox(element), x, y),
    );
    const pure = hsvToRgb(hsv.h, 1, 1);
    const saturation = Math.round(hsv.s * 100);
    const value = Math.round(hsv.v * 100);
    return (
        <div
            role="slider"
            tabIndex={0}
            aria-label="Saturation and value"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={saturation}
            aria-valuetext={`Saturation ${saturation}%, value ${value}%`}
            className="colour-sv"
            data-colour-control="sv"
            style={{
                background: `linear-gradient(to top, rgb(0 0 0), rgb(0 0 0 / 0)), linear-gradient(to right, rgb(255 255 255), rgb(${pure.r} ${pure.g} ${pure.b}))`,
            }}
            onKeyDown={(event) => {
                if (chorded(event)) return;
                if (keySaturationValue(store, event.key, event.shiftKey)) {
                    event.preventDefault();
                }
            }}
            {...drag}
        >
            <span
                className="colour-sv__handle"
                style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
            />
        </div>
    );
}

interface StripProps {
    kind: "hue" | "alpha";
    label: string;
    value: number;
    max: number;
    valueText: string;
    /** Background of the track. */
    fill: string;
    /** Sets the colour from client `x` over the track's box. */
    pick(store: ColourStore, box: Box, x: number): void;
    /** Applies a key to the colour; returns whether the strip took it. */
    step(store: ColourStore, key: string, shift: boolean): boolean;
}

/** A 10 px strip in a 24 px hit area (DESIGN §5.3). */
function ColourStrip({ kind, label, value, max, valueText, fill, pick, step }: StripProps) {
    const store = usePickerStore();
    const drag = useColourDrag((x, _y, element) =>
        pick(store, innerBox(element.firstElementChild ?? element), x),
    );
    return (
        <div
            role="slider"
            tabIndex={0}
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={Math.round(value)}
            aria-valuetext={valueText}
            className={`colour-strip colour-strip--${kind}`}
            data-colour-control={kind}
            onKeyDown={(event) => {
                if (chorded(event)) return;
                if (step(store, event.key, event.shiftKey)) event.preventDefault();
            }}
            {...drag}
        >
            <span className="colour-strip__track">
                <span className="colour-strip__fill" style={{ background: fill }} />
                <span className="colour-strip__thumb" style={{ left: `${(value / max) * 100}%` }} />
            </span>
        </div>
    );
}

const HUES = [0, 60, 120, 180, 240, 300, 360].map((hue) => {
    const { r, g, b } = hsvToRgb(hue, 1, 1);
    return `rgb(${r} ${g} ${b})`;
});

/**
 * The colour as hex text; what is typed applies on Enter or when the field is left. No length
 * limit: pasted text with white space around the digits is taken (`parseHex` trims it).
 */
function HexField({
    colour,
    unset,
    onChange,
}: {
    colour: number;
    /** The caller has no colour yet: the colour shown is taken too. */
    unset: boolean;
    onChange(colour: number): void;
}) {
    const [draft, setDraft] = useState<string | null>(null);
    const commit = () => {
        if (draft === null) return;
        const parsed = parseHex(draft);
        setDraft(null);
        if (parsed !== null && (parsed !== colour || unset)) onChange(parsed);
    };
    return (
        <input
            className="colour-panel__hex"
            type="text"
            aria-label="Hex"
            autoComplete="off"
            spellCheck={false}
            value={draft ?? formatHex(colour)}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
                if (event.key === "Enter") commit();
                else if (event.key === "Escape") setDraft(null);
            }}
        />
    );
}

type FieldMode = "hsv" | "rgb";
const FIELD_MODES = [
    { value: "hsv", label: "HSV" },
    { value: "rgb", label: "RGB" },
] as const;

/** The panel's colour for `colour`: its HSV, keeping what it leaves open from `previous`. */
function pickerColour(colour: number, previous?: Hsv): PickerColour {
    const { r, g, b } = unpackRgba(colour);
    return { colour, hsv: rgbToHsv(r, g, b, previous) };
}

export interface ColourPickerProps {
    /** The colour shown and edited, 0xRRGGBBAA. */
    value: number;
    /** Receives every change of the colour. */
    onChange(value: number): void;
    /**
     * The caller has no colour yet (a background colour of "None") and `value` is only where
     * the panel starts: the first edit is reported even when it gives `value` itself.
     */
    unset?: boolean;
}

/** The colour panel: edits `value` and reports each change to `onChange`. */
export function ColourPicker({ value, onChange, unset = false }: ColourPickerProps) {
    const [store] = useState(() => createStore<PickerColour>(() => pickerColour(value)));
    // A colour set from outside (another control, undo): the panel follows it, keeping the hue
    // it had where the new colour leaves it open. That is no edit of the panel's: not reported.
    const following = useRef(false);
    useEffect(() => {
        const state = store.getState();
        if (state.colour === value) return;
        following.current = true;
        try {
            store.setState(pickerColour(value, state.hsv));
        } finally {
            following.current = false;
        }
    }, [store, value]);
    // The panel's own edits go to the caller.
    useEffect(
        () =>
            store.subscribe((state, previous) => {
                if (following.current || state === previous) return;
                if (unset || state.colour !== value) {
                    onChange(state.colour);
                }
            }),
        [store, value, onChange, unset],
    );
    const shown = useStore(store);
    return (
        <Picker.Provider value={store}>
            <ColourPanel colour={shown.colour} hsv={shown.hsv} unset={unset} />
        </Picker.Provider>
    );
}

function ColourPanel({ colour, hsv, unset }: PickerColour & { unset: boolean }) {
    const store = usePickerStore();
    const [mode, setMode] = useState<FieldMode>("hsv");
    const rgba = unpackRgba(colour);
    const setColour = (next: number) => {
        const { r, g, b } = unpackRgba(next);
        store.setState({ colour: next, hsv: rgbToHsv(r, g, b, storedHsv(store)) });
    };
    const setChannel = (channel: "r" | "g" | "b", value: number) => {
        const channels = unpackRgba(store.getState().colour);
        channels[channel] = value;
        setColour(packRgba(channels.r, channels.g, channels.b, channels.a));
    };
    return (
        <div className="colour-panel" data-colour-panel="">
            <SaturationValueField hsv={hsv} />
            <ColourStrip
                kind="hue"
                label="Hue"
                value={hsv.h}
                max={360}
                valueText={`${Math.round(hsv.h)}°`}
                fill={`linear-gradient(to right, ${HUES.join(", ")})`}
                pick={pickHue}
                step={keyHue}
            />
            <ColourStrip
                kind="alpha"
                label="Alpha"
                value={rgba.a}
                max={255}
                valueText={`${rgba.a} of 255`}
                fill={`linear-gradient(to right, ${cssColour(colour, 0)}, ${cssColour(colour, 1)})`}
                pick={pickAlpha}
                step={keyAlpha}
            />
            <div className="colour-panel__row">
                <SegmentedControl
                    label="Colour fields"
                    value={mode}
                    onChange={setMode}
                    options={FIELD_MODES}
                />
                <HexField colour={colour} unset={unset} onChange={setColour} />
            </div>
            <div className="colour-panel__row colour-panel__fields">
                {mode === "hsv" ? (
                    <>
                        <NumberField
                            label="H"
                            unit="°"
                            min={0}
                            max={360}
                            value={Math.round(hsv.h)}
                            onChange={(h) => changeHsv(store, { h })}
                        />
                        <NumberField
                            label="S"
                            unit="%"
                            min={0}
                            max={100}
                            value={Math.round(hsv.s * 100)}
                            onChange={(s) => changeHsv(store, { s: s / 100 })}
                        />
                        <NumberField
                            label="V"
                            unit="%"
                            min={0}
                            max={100}
                            value={Math.round(hsv.v * 100)}
                            onChange={(v) => changeHsv(store, { v: v / 100 })}
                        />
                    </>
                ) : (
                    <>
                        {(["r", "g", "b"] as const).map((channel) => (
                            <NumberField
                                key={channel}
                                label={channel.toUpperCase()}
                                min={0}
                                max={255}
                                value={rgba[channel]}
                                onChange={(value) => setChannel(channel, value)}
                            />
                        ))}
                    </>
                )}
            </div>
        </div>
    );
}
