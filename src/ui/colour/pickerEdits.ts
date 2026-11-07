import type { Hsv } from "../../core/color";
import { hsvToRgb, packRgba } from "../../core/color";
import { alphaAfterKey, fractionAlong, hueAfterKey, svAfterKey } from "./pickerMath";

// What the controls of the colour panel (DESIGN §5.3) do to the colour it edits, for a pointer
// position or a key: `ColourPicker.tsx` calls these with the panel's own colour, the unit tests
// with values of their own. Free of the DOM and of React.
//
// The panel edits HSV as it keeps it beside the colour (`PickerColour.hsv`), so a drag to the
// bottom or the left edge of the field, where the colour turns black or grey, keeps the hue
// and brings it back when the drag returns. The colour is one value given by the panel's caller
// (a map's background colour, a layer colour, a colour property: DESIGN §3.3).

/** The colour the panel edits, 0xRRGGBBAA, with the HSV it keeps for it. */
export interface PickerColour {
    colour: number;
    hsv: Hsv;
}

/** Where the panel's colour lives: read it, and set a new one. */
export interface ColourStore {
    getState(): PickerColour;
    setState(next: PickerColour): void;
}

/** A control's box in client pixels, inside its border. */
export interface Box {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** The HSV the store keeps for its colour. */
export function storedHsv(store: ColourStore): Hsv {
    return store.getState().hsv;
}

/** Changes part of the colour's HSV, and its alpha, keeping the rest as stored. */
export function changeHsv(
    store: ColourStore,
    change: Partial<Hsv>,
    alpha = store.getState().colour & 0xff,
): void {
    const hsv = { ...storedHsv(store), ...change };
    const { r, g, b } = hsvToRgb(hsv.h, hsv.s, hsv.v);
    store.setState({ colour: packRgba(r, g, b, alpha), hsv });
}

/**
 * The saturation/value field at client position `x, y`: saturation from left to right, value
 * from bottom to top, clamped to the field; the hue as stored.
 */
export function pickSaturationValue(store: ColourStore, box: Box, x: number, y: number): void {
    changeHsv(store, {
        s: fractionAlong(x, box.left, box.width),
        v: 1 - fractionAlong(y, box.top, box.height),
    });
}

/** The hue strip at client `x`: 0° at its left end, 360° at its right end. */
export function pickHue(store: ColourStore, box: Box, x: number): void {
    changeHsv(store, { h: fractionAlong(x, box.left, box.width) * 360 });
}

/** The alpha strip at client `x`: 0 at its left end, 255 at its right end. */
export function pickAlpha(store: ColourStore, box: Box, x: number): void {
    changeHsv(store, {}, Math.round(fractionAlong(x, box.left, box.width) * 255));
}

/** A key on the saturation/value field; returns whether the field took it. */
export function keySaturationValue(store: ColourStore, key: string, shift: boolean): boolean {
    const next = svAfterKey(storedHsv(store), key, shift);
    if (!next) return false;
    changeHsv(store, next);
    return true;
}

/** A key on the hue strip; returns whether the strip took it. */
export function keyHue(store: ColourStore, key: string, shift: boolean): boolean {
    const next = hueAfterKey(storedHsv(store).h, key, shift);
    if (next === null) return false;
    changeHsv(store, { h: next });
    return true;
}

/** A key on the alpha strip; returns whether the strip took it. */
export function keyAlpha(store: ColourStore, key: string, shift: boolean): boolean {
    const next = alphaAfterKey(store.getState().colour & 0xff, key, shift);
    if (next === null) return false;
    changeHsv(store, {}, next);
    return true;
}
