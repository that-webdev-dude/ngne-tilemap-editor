import { describe, expect, it } from "vitest";
import type { Property, PropertyType } from "../../src/core/model";
import { PROPERTY_TYPES, convertProperty, defaultProperty } from "../../src/core/properties";

// TE-040: Change Type (SPEC §9). Every type-to-type conversion: the value converted where Qt's
// `QVariant::convert` converts it (as Tiled's Properties view, v1.12.2), else the new type's
// default (`false`, `0`, `""`, `#000000ff`). The table is in src/core/properties/convert.ts.

const p = (type: PropertyType, value: Property["value"]) =>
    ({ name: "x", type, value }) as Property;
const to = (from: Property, type: PropertyType) => convertProperty(from, type).value;

describe("defaults", () => {
    it('are false, 0, 0, "", #000000ff and ""', () => {
        expect(PROPERTY_TYPES.map((type) => defaultProperty("x", type).value)).toEqual([
            false,
            0,
            0,
            "",
            "#000000ff",
            "",
        ]);
    });
});

describe("every pair of types", () => {
    const samples: Property[] = [
        p("bool", true),
        p("int", 7),
        p("float", 2.5),
        p("string", "12"),
        p("color", "#11223344"),
        p("file", "a/b.png"),
    ];
    // Row: from; column: to, in PROPERTY_TYPES order (bool int float string color file).
    const expected: Property["value"][][] = [
        [true, 1, 1, "true", "#000000ff", ""],
        [true, 7, 7, "7", "#000000ff", ""],
        [true, 3, 2.5, "2.5", "#000000ff", ""],
        [true, 12, 12, "12", "#000000ff", "12"],
        [false, 0, 0, "#11223344", "#11223344", ""],
        [false, 0, 0, "a/b.png", "#000000ff", "a/b.png"],
    ];
    samples.forEach((sample, row) => {
        PROPERTY_TYPES.forEach((type, column) => {
            it(`${sample.type} → ${type}`, () => {
                const result = convertProperty(sample, type);
                expect(result).toEqual({ name: "x", type, value: expected[row]![column] });
            });
        });
    });
});

describe("bool", () => {
    it('false gives 0, 0 and "false"', () => {
        const value = p("bool", false);
        expect([to(value, "int"), to(value, "float"), to(value, "string")]).toEqual([
            0,
            0,
            "false",
        ]);
    });
});

describe("int", () => {
    it("0 is false, other values true", () => {
        expect(to(p("int", 0), "bool")).toBe(false);
        expect(to(p("int", -3), "bool")).toBe(true);
    });

    it("keeps its value as a float and in decimal text", () => {
        expect(to(p("int", -9_007_199_254_740_991), "float")).toBe(-9_007_199_254_740_991);
        expect(to(p("int", -42), "string")).toBe("-42");
    });
});

describe("float", () => {
    it("0 is false, other values true", () => {
        expect(to(p("float", 0), "bool")).toBe(false);
        expect(to(p("float", -0.25), "bool")).toBe(true);
    });

    it("rounds half away from zero to int", () => {
        expect([2.5, -2.5, 2.49, -0.4, 1e15 + 0.5].map((v) => to(p("float", v), "int"))).toEqual([
            3,
            -3,
            2,
            0,
            1e15 + 1,
        ]);
    });

    it("out of the int range gives 0", () => {
        expect(to(p("float", 1e16), "int")).toBe(0);
        expect(to(p("float", -1e300), "int")).toBe(0);
    });

    it("writes the shortest text", () => {
        expect(to(p("float", 0.1 + 0.2), "string")).toBe("0.30000000000000004");
        expect(to(p("float", 1e21), "string")).toBe("1e+21");
        expect(to(p("float", -0.5), "string")).toBe("-0.5");
    });
});

describe("string", () => {
    it('is false for "", "0" and "false" in any case, else true', () => {
        const texts = ["", "0", "false", "FALSE", "False", "no", "1", "true", " 0", "0.0"];
        expect(texts.map((text) => to(p("string", text), "bool"))).toEqual([
            false,
            false,
            false,
            false,
            false,
            true,
            true,
            true,
            true,
            true,
        ]);
    });

    it("converts integer text to int, ignoring surrounding white space", () => {
        const texts = [" 12 ", "-5", "+8", "1.5", "1e3", "abc", "", "9007199254740992", "0x10"];
        expect(texts.map((text) => to(p("string", text), "int"))).toEqual([
            12, -5, 8, 0, 0, 0, 0, 0, 0,
        ]);
    });

    it("converts number text to float", () => {
        const texts = [" 1.5 ", "-.25", "1e3", "2.", "abc", "", "Infinity", "1e999", "0x10"];
        expect(texts.map((text) => to(p("string", text), "float"))).toEqual([
            1.5, -0.25, 1000, 2, 0, 0, 0, 0, 0,
        ]);
    });

    it("converts its own colour spellings to color, lowercase", () => {
        const texts = ["#AABBCCDD", "#aabbcc", "#ABC", "red", "aabbccdd", "#aabbccdd "];
        expect(texts.map((text) => to(p("string", text), "color"))).toEqual([
            "#aabbccdd",
            "#aabbccff",
            "#000000ff",
            "#000000ff",
            "#000000ff",
            "#000000ff",
        ]);
    });

    it("keeps its text as a file of at most 1024 code units", () => {
        expect(to(p("string", "x".repeat(1024)), "file")).toBe("x".repeat(1024));
        expect(to(p("string", "x".repeat(1025)), "file")).toBe("");
    });
});

describe("color and file", () => {
    it("color keeps its text as string only", () => {
        const colour = p("color", "#00ff00ff");
        expect(PROPERTY_TYPES.map((type) => to(colour, type))).toEqual([
            false,
            0,
            0,
            "#00ff00ff",
            "#00ff00ff",
            "",
        ]);
    });

    it("file keeps its text as string only", () => {
        const file = p("file", "#00ff00ff");
        expect(PROPERTY_TYPES.map((type) => to(file, type))).toEqual([
            false,
            0,
            0,
            "#00ff00ff",
            "#000000ff",
            "#00ff00ff",
        ]);
    });
});

describe("the name", () => {
    it("is kept by every conversion", () => {
        for (const type of PROPERTY_TYPES) {
            expect(convertProperty({ name: "speed", type: "int", value: 1 }, type).name).toBe(
                "speed",
            );
        }
    });
});
