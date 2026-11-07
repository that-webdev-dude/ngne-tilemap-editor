import { describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";
import { rgbToHsv } from "../../src/core/color";
import {
    changeHsv,
    keyAlpha,
    keyHue,
    keySaturationValue,
    pickAlpha,
    pickHue,
    pickSaturationValue,
} from "../../src/ui/colour/pickerEdits";
import type { PickerColour } from "../../src/ui/colour/pickerEdits";

// TE-032: the colour picker adapted from the sprite editor (DESIGN §3.3) edits one colour given
// by its caller (the map's background colour) instead of the foreground and background. The
// edits keep the HSV beside the colour, so a drag through black or grey keeps the hue.

function store(colour: number) {
    const { r, g, b } = { r: colour >>> 24, g: (colour >>> 16) & 0xff, b: (colour >>> 8) & 0xff };
    return createStore<PickerColour>(() => ({ colour, hsv: rgbToHsv(r, g, b) }));
}

const BOX = { left: 10, top: 20, width: 100, height: 50 };

describe("picker edits on a caller's colour", () => {
    it("the field sets saturation and value, the strips hue and alpha", () => {
        const colour = store(0xff0000ff);
        pickSaturationValue(colour, BOX, 110, 20);
        expect(colour.getState().colour).toBe(0xff0000ff);
        pickSaturationValue(colour, BOX, 10, 20);
        expect(colour.getState().colour).toBe(0xffffffff);
        pickSaturationValue(colour, BOX, 110, 45);
        expect(colour.getState().colour).toBe(0x800000ff);
        pickHue(colour, BOX, 10 + 100 / 3);
        expect(colour.getState().colour).toBe(0x008000ff);
        pickAlpha(colour, BOX, 10);
        expect(colour.getState().colour).toBe(0x00800000);
        pickAlpha(colour, BOX, 500);
        expect(colour.getState().colour).toBe(0x008000ff);
    });

    it("black keeps the hue and saturation it was dragged through", () => {
        const colour = store(0x0000ffff);
        pickSaturationValue(colour, BOX, 110, 70);
        expect(colour.getState().colour).toBe(0x000000ff);
        expect(colour.getState().hsv).toMatchObject({ h: 240, s: 1, v: 0 });
        pickSaturationValue(colour, BOX, 110, 20);
        expect(colour.getState().colour).toBe(0x0000ffff);
    });

    it("keys step the field and the strips; other keys are left alone", () => {
        const colour = store(0xff0000ff);
        expect(keyHue(colour, "ArrowRight", true)).toBe(true);
        expect(colour.getState().hsv.h).toBe(10);
        expect(keySaturationValue(colour, "ArrowDown", false)).toBe(true);
        expect(colour.getState().hsv.v).toBeCloseTo(0.99);
        expect(keyAlpha(colour, "Home", false)).toBe(true);
        expect(colour.getState().colour & 0xff).toBe(0);
        expect(keyHue(colour, "a", false)).toBe(false);
        expect(keyAlpha(colour, "Enter", false)).toBe(false);
    });

    it("changeHsv keeps the alpha unless given one", () => {
        const colour = store(0x00ff0080);
        changeHsv(colour, { h: 0 });
        expect(colour.getState().colour).toBe(0xff000080);
        changeHsv(colour, {}, 255);
        expect(colour.getState().colour).toBe(0xff0000ff);
    });
});
