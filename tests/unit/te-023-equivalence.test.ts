import { describe, expect, it } from "vitest";
import { importAtlas, importSprite, readSpriteOutline } from "../../src/core/tileset";
import { emptyProject } from "./te-022-support";
import { spriteFixture, tilePixels } from "./te-023-support";

// TE-023, SPEC §6.1: a sprite imported with one tile per frame shows the same pixels and
// animations as the atlas the sprite editor exports from it (frames all, no trim), imported as
// TE-022 does. Only the source keys differ, and a frame identical to an earlier one is that
// frame's tile. The fixture has such a frame (frame c repeats frame a), hidden and reference
// layers, a multiply layer at partial opacities, and forward, ping-pong, reverse and repeating
// tags.

async function both() {
    const { sprite, atlasJson, atlasPng } = spriteFixture();
    const fromSprite = await importSprite(emptyProject(), sprite, {
        fileName: "tiles.ngsprite",
        tileWidth: 16,
        tileHeight: 16,
        margin: 0,
        spacing: 0,
    });
    const fromAtlas = await importAtlas(emptyProject(), atlasJson, atlasPng, {
        fileName: "tiles.atlas.json",
    });
    return { fromSprite, fromAtlas, frameIds: readSpriteOutline(sprite).frames.map((f) => f.id) };
}

describe("sprite and atlas equivalence", () => {
    it("has one tile per distinct frame, with the pixels of the atlas's tile", async () => {
        const { fromSprite, fromAtlas, frameIds } = await both();
        const sprite = fromSprite.tileset;
        const atlas = fromAtlas.tileset;
        expect([sprite.tileWidth, sprite.tileHeight]).toEqual([atlas.tileWidth, atlas.tileHeight]);
        expect(atlas.tiles).toHaveLength(frameIds.length);

        // The atlas tile of each frame, as the sprite's tile it equals: the first equal frame's.
        const distinct: number[] = [];
        const tileOfFrame = atlas.tiles.map((tile) => {
            const pixels = tilePixels(atlas, tile.id);
            const earlier = distinct.findIndex((first) =>
                tilePixels(atlas, first).every((value, at) => value === pixels[at]),
            );
            if (earlier >= 0) return earlier;
            distinct.push(tile.id);
            return distinct.length - 1;
        });
        expect(tileOfFrame).toEqual([0, 1, 0, 2, 3]);
        expect(sprite.tiles).toHaveLength(distinct.length);
        distinct.forEach((atlasTile, k) => {
            expect(tilePixels(sprite, k)).toEqual(tilePixels(atlas, atlasTile));
            expect(sprite.tiles[k]!.fingerprint).toBe(atlas.tiles[atlasTile]!.fingerprint);
        });

        // Only the source keys differ.
        expect(atlas.tiles.map((tile) => tile.sourceKey)).toEqual(
            frameIds.map((_, index) => `tiles-${index}`),
        );
        expect(sprite.tiles.map((tile) => tile.sourceKey)).toEqual(
            distinct.map((atlasTile) => [frameIds[atlasTile], 0, 0]),
        );
    });

    it("has the same animations on the same tiles", async () => {
        const { fromSprite, fromAtlas } = await both();
        const sprite = fromSprite.tileset;
        const atlas = fromAtlas.tileset;
        const tileOf = new Map(
            atlas.tiles.map((tile) => [
                tile.id,
                sprite.tiles.findIndex((own) => own.fingerprint === tile.fingerprint),
            ]),
        );
        const fromAtlasAnimations = atlas.tiles
            .filter((tile) => tile.animation.length > 0)
            .map((tile) => [
                tileOf.get(tile.id),
                tile.animation.map((frame) => [tileOf.get(frame.tile), frame.ms]),
            ]);
        const fromSpriteAnimations = sprite.tiles
            .filter((tile) => tile.animation.length > 0)
            .map((tile) => [tile.id, tile.animation.map((frame) => [frame.tile, frame.ms])]);
        // walk (ping-pong), blink (forward, repeat 2) and back (reverse).
        expect(fromAtlasAnimations).toHaveLength(3);
        expect(fromSpriteAnimations).toEqual(fromAtlasAnimations);
        expect(fromSprite.warnings.map((warning) => warning.code)).toEqual(
            fromAtlas.warnings.map((warning) => warning.code),
        );
    });
});
