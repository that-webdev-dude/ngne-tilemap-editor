import { describe, expect, it } from "vitest";
import { rowStatusText } from "../../src/ui/tilesets/update/rowText";

// SPEC §6.3 step 3: a tile is ambiguous also when it shares its fingerprint with other unmatched
// old tiles, so an ambiguous row can have no candidate.
const ambiguous = (count: number) => ({
    status: "ambiguous" as const,
    candidates: Array.from({ length: count }, (_, i) => i),
});

describe("TE-028 row status text", () => {
    it("says an ambiguous row without candidates shares its picture with other tiles", () => {
        expect(rowStatusText(ambiguous(0))).toBe("Ambiguous: shares its picture with other tiles");
    });
    it("uses the singular for one candidate", () => {
        expect(rowStatusText(ambiguous(1))).toBe("Ambiguous: 1 source tile matches");
    });
    it("counts two candidates", () => {
        expect(rowStatusText(ambiguous(2))).toBe("Ambiguous: 2 source tiles match");
    });
    it("counts seven candidates", () => {
        expect(rowStatusText(ambiguous(7))).toBe("Ambiguous: 7 source tiles match");
    });
    it("leaves a missing row unchanged", () => {
        expect(rowStatusText({ status: "missing", candidates: [] })).toBe(
            "Missing from the source",
        );
    });
});
