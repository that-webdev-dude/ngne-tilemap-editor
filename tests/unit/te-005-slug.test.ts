import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
    MAX_SLUG_LENGTH,
    RESERVED_SLUG,
    createProject,
    exportNames,
    isSlug,
    sequentialIds,
    slugify,
    uniqueSlug,
} from "../../src/core/model";

// Slugs (FORMAT §1.1): `[a-z0-9][a-z0-9_-]*`, 1 to 64 characters, never `ngne-tilemap`,
// unique case-insensitively against a project's export names.

const SLUG = /^[a-z0-9][a-z0-9_-]*$/;

describe("slugify", () => {
    it("lowers A–Z, keeps _, and turns every other run into one -", () => {
        expect(slugify("Hero Walk")).toBe("hero-walk");
        expect(slugify("  Grass__Tiles  (v2) ")).toBe("grass__tiles-v2");
        expect(slugify("ÉTÉ")).toBe("t");
        expect(slugify("---")).toBe("untitled");
        expect(slugify("", "map")).toBe("map");
        expect(slugify("_leading")).toBe("leading");
    });

    it("appends the fallback to a Windows device name (sprite editor rule)", () => {
        expect(slugify("CON")).toBe("con-untitled");
        expect(slugify("lpt1", "map")).toBe("lpt1-map");
        expect(slugify("console")).toBe("console");
        expect(uniqueSlug("Nul", ["nul-map"], "map")).toBe("nul-map-2");
    });

    it("cuts to 64 characters without a trailing -", () => {
        const long = `${"a".repeat(63)}-bbbb`;
        expect(slugify(long)).toBe("a".repeat(63));
        expect(slugify("x".repeat(200))).toHaveLength(MAX_SLUG_LENGTH);
    });

    it("is a slug for every string", () => {
        fc.assert(
            fc.property(fc.string({ unit: "grapheme" }), (name) => {
                const slug = slugify(name);
                expect(slug.length).toBeGreaterThanOrEqual(1);
                expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
                expect(slug).toMatch(SLUG);
            }),
        );
    });
});

describe("isSlug", () => {
    it("accepts the pattern and refuses the reserved slug, uppercase and length 65", () => {
        expect(isSlug("a")).toBe(true);
        expect(isSlug("tile_set-2")).toBe(true);
        expect(isSlug("a".repeat(64))).toBe(true);
        expect(isSlug("a".repeat(65))).toBe(false);
        expect(isSlug("")).toBe(false);
        expect(isSlug("-a")).toBe(false);
        expect(isSlug("_a")).toBe(false);
        expect(isSlug("A")).toBe(false);
        expect(isSlug(RESERVED_SLUG)).toBe(false);
        expect(isSlug(42)).toBe(false);
    });
});

describe("uniqueSlug", () => {
    it("appends -2, -3, … against taken names, compared case-insensitively", () => {
        expect(uniqueSlug("Grass", [])).toBe("grass");
        expect(uniqueSlug("Grass", ["grass"])).toBe("grass-2");
        expect(uniqueSlug("Grass", ["GRASS", "grass-2"])).toBe("grass-3");
        expect(uniqueSlug("grass-2", ["grass-2"])).toBe("grass-2-2");
    });

    it("never produces ngne-tilemap", () => {
        expect(uniqueSlug("NGNE Tilemap", [])).toBe("ngne-tilemap-2");
        expect(uniqueSlug("ngne-tilemap", ["ngne-tilemap-2"])).toBe("ngne-tilemap-3");
    });

    it("keeps the suffix within 64 characters", () => {
        const name = "b".repeat(80);
        const first = uniqueSlug(name, []);
        const second = uniqueSlug(name, [first]);
        expect(second).toBe(`${"b".repeat(62)}-2`);
        expect(second).toHaveLength(MAX_SLUG_LENGTH);
        const taken = Array.from({ length: 10 }, (_, n) => `${"b".repeat(61)}-${n + 1}`);
        expect(uniqueSlug(name, [first, second, ...taken])).toHaveLength(MAX_SLUG_LENGTH);
    });

    it("is a slug distinct from every taken name, whatever the case (fast-check)", () => {
        const taken = fc.array(fc.string({ unit: "grapheme", maxLength: 70 }), { maxLength: 12 });
        fc.assert(
            fc.property(fc.string({ unit: "grapheme", maxLength: 100 }), taken, (name, list) => {
                const slug = uniqueSlug(name, list);
                expect(isSlug(slug)).toBe(true);
                expect(slug).not.toBe(RESERVED_SLUG);
                const lowered = new Set(list.map((item) => item.toLowerCase()));
                expect(lowered.has(slug)).toBe(false);
            }),
        );
    });

    it("avoids the export names of a project", () => {
        const project = createProject({ name: "Overworld", newId: sequentialIds() });
        expect(project.exportName).toBe("overworld");
        expect(project.maps[0]!.exportName).toBe("map-1");
        expect(exportNames(project)).toEqual(["map-1"]);
        expect(uniqueSlug("Map 1", exportNames(project), "map")).toBe("map-1-2");
    });
});
