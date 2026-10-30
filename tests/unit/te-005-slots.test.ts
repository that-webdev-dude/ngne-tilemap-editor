import { describe, expect, it } from "vitest";
import { MAX_SLOT, SlotError, assignSlots, createProject, freeSlot } from "../../src/core/model";
import type { Tileset } from "../../src/core/model";

// Session slots (SPEC §2.2): the lowest free slot 1..255; a 256th tileset is refused.

const slotted = (slots: number[]) => slots.map((slot) => ({ slot }));

describe("freeSlot", () => {
    it("is 1 for an empty project", () => {
        expect(freeSlot([])).toBe(1);
    });

    it("is the lowest slot no tileset holds, whatever the list order", () => {
        expect(freeSlot(slotted([1, 2, 3]))).toBe(4);
        expect(freeSlot(slotted([3, 1, 4]))).toBe(2);
        expect(freeSlot(slotted([2, 3]))).toBe(1);
        expect(freeSlot(slotted([1, 2, 4]))).toBe(3);
    });

    it("fills a gap left by a removed tileset before a new high slot", () => {
        const slots = slotted([1, 2, 3]);
        slots.splice(1, 1);
        expect(freeSlot(slots)).toBe(2);
    });

    it("refuses the 256th tileset", () => {
        const full = slotted(Array.from({ length: MAX_SLOT }, (_, i) => i + 1));
        expect(freeSlot(full.slice(0, MAX_SLOT - 1))).toBe(MAX_SLOT);
        expect(() => freeSlot(full)).toThrow(SlotError);
    });
});

describe("assignSlots", () => {
    const tileset = (slot: number) => ({ slot }) as Tileset;

    it("gives every tileset of an opened project its list position", () => {
        const project = createProject();
        project.tilesets = [tileset(0), tileset(0), tileset(0)];
        assignSlots(project);
        expect(project.tilesets.map((t) => t.slot)).toEqual([1, 2, 3]);
    });

    it("refuses more than 255 tilesets and changes nothing", () => {
        const project = createProject();
        project.tilesets = Array.from({ length: MAX_SLOT + 1 }, () => tileset(0));
        expect(() => assignSlots(project)).toThrow(SlotError);
        expect(project.tilesets.every((t) => t.slot === 0)).toBe(true);
    });
});
