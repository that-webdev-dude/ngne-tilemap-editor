import { describe, expect, it } from "vitest";
import { expandTag } from "../../src/core/sprite/animation";
import { compositeFrame } from "../../src/core/sprite/composite/compositeFrame";
import { pack } from "../../src/core/sprite/export/pack";
import { validateAtlas } from "../../src/core/sprite/export/validateAtlas";
import { deserialize } from "../../src/core/sprite/project/deserialize";
import { packNgsprite } from "../support/ngsprite";

// The sprite core subtree (DESIGN §3.1) end to end on the sprite editor's golden project file
// (`se/tests/unit/se-040-fixtures/golden-v1.ngsprite`, PROVENANCE.md): read it, composite its
// frames, pack them and validate the atlas that describes the result.

// Stored unpacked (`te-002-fixtures/golden-v1.ngsprite.d/`) and packed back into the upstream
// file's bytes, which te-002-provenance checks.
const GOLDEN = packNgsprite(new URL("./te-002-fixtures/golden-v1.ngsprite.d/", import.meta.url));

/** The composite of the fixture's first frame, from `se/tests/unit/se-040-support.ts`. */
const FIRST_FRAME_COMPOSITE = [
    [10, 20, 30, 255],
    [11, 12, 13, 255],
    [70, 80, 90, 255],
    [100, 110, 120, 128],
    [0, 0, 0, 255],
    [255, 255, 255, 255],
    [21, 22, 23, 255],
    [0, 0, 0, 0],
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255],
    [31, 32, 33, 255],
].flat();

describe("sprite core subtree", () => {
    it("reads, composites, packs and validates the golden project", async () => {
        const { doc } = await deserialize(GOLDEN);
        expect([doc.width, doc.height]).toEqual([4, 3]);

        const frames = doc.frames.map((frame) => compositeFrame(doc, frame.id));
        expect([...frames[0]!.data]).toEqual(FIRST_FRAME_COMPOSITE);

        const { atlas, rects } = pack(frames, doc.exportSettings);
        for (const rect of rects) {
            for (const index of rect.frameIndices) {
                const frame = frames[index]!;
                for (let y = 0; y < rect.contentH; y += 1) {
                    for (let x = 0; x < rect.contentW; x += 1) {
                        const from = ((rect.offsetY + y) * frame.width + rect.offsetX + x) * 4;
                        const to = ((rect.y + y) * atlas.width + rect.x + x) * 4;
                        const pixel = frame.data.subarray(from, from + 4);
                        const expected = pixel[3] === 0 ? [0, 0, 0, 0] : [...pixel];
                        expect([...atlas.data.subarray(to, to + 4)], `frame ${index}`).toEqual(
                            expected,
                        );
                    }
                }
            }
        }
        const frameIds = doc.frames.map((_, index) => `frame-${index}`);
        const atlasFrames = Object.fromEntries(
            rects.flatMap(({ x, y, w, h, sourceW, sourceH, offsetX, offsetY, frameIndices }) =>
                frameIndices.map((index) => [
                    frameIds[index],
                    {
                        x,
                        y,
                        w,
                        h,
                        sourceW,
                        sourceH,
                        offsetX,
                        offsetY,
                        pivot: [doc.pivot.x, doc.pivot.y],
                    },
                ]),
            ),
        );
        const animations = Object.fromEntries(
            doc.tags.map((tag, index) => {
                const entries = expandTag(doc, tag).map(({ frameId, ms }) => ({
                    frame: frameIds[doc.frames.findIndex((frame) => frame.id === frameId)],
                    ms,
                }));
                const durationMs = entries.reduce((sum, entry) => sum + entry.ms, 0);
                const playback = tag.repeat === 0 ? "loop" : "once";
                return [`tag-${index}`, { playback, durationMs, entries }];
            }),
        );
        expect(Object.keys(animations).length).toBeGreaterThan(0);

        const json = {
            format: "ngne-sprite-atlas",
            version: 1,
            generator: "te-002",
            image: "golden.png",
            width: atlas.width,
            height: atlas.height,
            frames: atlasFrames,
            animations,
        };
        const meta = validateAtlas(json, { width: atlas.width, height: atlas.height });
        expect(Object.keys(meta.frames)).toEqual(frameIds);
        expect(meta.animations).toEqual(animations);
    });
});
