import { describe, expect, it } from "vitest";
import { compositeThumbnail, thumbnailSize } from "../../src/core/compositor";
import { createMarkerLayer } from "../../src/core/model";
import { mapOf, pixelAt, projectOf, tileLayerOf, tilesetOf } from "./te-012-support";

// Thumbnails (FORMAT §2.7).

describe("thumbnail size", () => {
    it("scales a 1000 × 40 map of 16 px (16 000 × 640 pixels) to 128 × 5", () => {
        expect(thumbnailSize(1000 * 16, 40 * 16)).toEqual({ width: 128, height: 5 });
        const map = mapOf({ width: 1000, height: 40, tileWidth: 16, layers: [tileLayerOf(1, [])] });
        const thumbnail = compositeThumbnail(projectOf(map, []), map);
        expect([thumbnail.width, thumbnail.height]).toEqual([128, 5]);
        expect(thumbnail.data).toHaveLength(128 * 5 * 4);
    });

    it("keeps the size of a map within 128 pixels", () => {
        expect(thumbnailSize(128, 128)).toEqual({ width: 128, height: 128 });
        expect(thumbnailSize(64, 96)).toEqual({ width: 64, height: 96 });
        const map = mapOf({ width: 4, height: 6, tileWidth: 16, layers: [tileLayerOf(1, [])] });
        const thumbnail = compositeThumbnail(projectOf(map, []), map);
        expect([thumbnail.width, thumbnail.height]).toEqual([64, 96]);
    });

    it("makes the shorter side at least 1 and rounds to nearest", () => {
        expect(thumbnailSize(100_000, 1)).toEqual({ width: 128, height: 1 });
        expect(thumbnailSize(1, 4096)).toEqual({ width: 1, height: 128 });
        expect(thumbnailSize(300, 200)).toEqual({ width: 128, height: 85 }); // 85.33
        expect(thumbnailSize(300, 100)).toEqual({ width: 128, height: 43 }); // 42.67
        expect(thumbnailSize(256, 192)).toEqual({ width: 128, height: 96 });
    });
});

describe("thumbnail pixels", () => {
    // 100 × 30 cells of 16 px (1600 × 480 pixels): a 128 × 38 thumbnail. Every cell holds one of
    // 7 solid tiles, chosen by position.
    const letters = ["A", "B", "C", "D", "E", "F", "G"];
    const tileset = tilesetOf(
        letters.map((letter) => Array.from({ length: 16 }, () => letter.repeat(16))),
        { slot: 1 },
    );
    const width = 100;
    const height = 30;
    const tileAt = (cx: number, cy: number): number => (cx * 5 + cy * 3) % letters.length;

    function build(layers: Parameters<typeof mapOf>[0]["layers"] = []) {
        const cells: [number, number, number, number][] = [];
        for (let cy = 0; cy < height; cy += 1) {
            for (let cx = 0; cx < width; cx += 1) cells.push([cx, cy, 1, tileAt(cx, cy)]);
        }
        const map = mapOf({
            width,
            height,
            tileWidth: 16,
            layers: [tileLayerOf(1, cells), ...layers],
        });
        return { map, project: projectOf(map, [tileset]) };
    }

    it("shows map pixel (floor((x + ½) · W / w), floor((y + ½) · H / h)) at each pixel", () => {
        const { map, project } = build();
        const thumbnail = compositeThumbnail(project, map);
        const W = width * 16;
        const H = height * 16;
        const [w, h] = [thumbnail.width, thumbnail.height];
        expect([w, h]).toEqual([128, 38]);
        for (let y = 0; y < h; y += 1) {
            for (let x = 0; x < w; x += 1) {
                const mapX = Math.floor(((x + 0.5) * W) / w);
                const mapY = Math.floor(((y + 0.5) * H) / h);
                const tile = tileAt(Math.floor(mapX / 16), Math.floor(mapY / 16));
                const letter = letters[tile]!;
                const expected = pixelAt(
                    {
                        width: 1,
                        height: 1,
                        data: tileset.pixels.data.subarray(tile * 16 * 4, tile * 16 * 4 + 4),
                    },
                    0,
                    0,
                );
                expect(pixelAt(thumbnail, x, y), `${x},${y} ${letter}`).toEqual(expected);
            }
        }
    });

    it("uses opacity and offsets but not parallax, markers or animation", () => {
        const plain = build();
        const base = compositeThumbnail(plain.project, plain.map);

        // Parallax and a marker layer change nothing.
        const moved = build([
            tileLayerOf(5, [[3, 3, 1, 1]], { parallaxX: 0, parallaxY: 0 }),
            createMarkerLayer(6, "Markers"),
        ]);
        const withParallax = build([
            tileLayerOf(5, [[3, 3, 1, 1]], { parallaxX: 1, parallaxY: 1 }),
        ]);
        expect([...compositeThumbnail(moved.project, moved.map).data]).toEqual([
            ...compositeThumbnail(withParallax.project, withParallax.map).data,
        ]);

        // An animated tile shows its own pixels.
        const animated = build();
        animated.project.tilesets[0]!.tiles[0]!.animation = [
            { tile: 1, ms: 100 },
            { tile: 2, ms: 100 },
        ];
        expect([...compositeThumbnail(animated.project, animated.map).data]).toEqual([
            ...base.data,
        ]);

        // An offset moves a layer by whole map pixels, nearest-sampled.
        const shifted = build();
        shifted.map.layers[0]!.offsetX = 25; // two thumbnail columns of 12.5 pixels
        const offset = compositeThumbnail(shifted.project, shifted.map);
        expect(pixelAt(offset, 0, 0)).toEqual([0, 0, 0, 0]);
        expect(pixelAt(offset, 2, 0)).not.toEqual([0, 0, 0, 0]);
    });
});
