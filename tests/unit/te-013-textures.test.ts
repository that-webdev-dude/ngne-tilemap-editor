import { describe, expect, it } from "vitest";
import type { Tileset } from "../../src/core/model";
import { packTileset } from "../../src/core/pack";
import type { PackedTileset } from "../../src/core/pack";
import { TilesetTextures, tilesetTextureId } from "../../src/engine/viewport/textures";
import type { TextureTarget } from "../../src/engine/viewport/textures";
import { createViewportSceneProject } from "../support/viewportScene";

// TE-013: the tileset textures of the viewport (ENGINE §3) against a fake renderer: uploaded
// once, released when no open map uses them, replaced on change without a gap.

const tilesets = createViewportSceneProject({ background: null }).tilesets;
const [first, second, third] = tilesets as [Tileset, Tileset, Tileset];

interface Upload {
    id: string;
    release: () => void;
    signal: AbortSignal | undefined;
}

/** A renderer whose uploads settle when the test says so. */
function fakeTarget() {
    const uploads: Upload[] = [];
    const held = new Set<string>();
    const released: string[] = [];
    const target: TextureTarget = {
        texture(id, _source, signal) {
            return new Promise<void>((resolve) => {
                uploads.push({
                    id,
                    signal,
                    release: () => {
                        held.add(id);
                        resolve();
                    },
                });
            });
        },
        releaseTexture(id) {
            held.delete(id);
            released.push(id);
        },
    };
    return { target, uploads, held, released };
}

const bitmap = () => Promise.resolve({ close() {} } as ImageBitmap);

function setup() {
    const renderer = fakeTarget();
    const packs: string[] = [];
    const changes: number[] = [];
    const errors: unknown[] = [];
    let failPack: Error | null = null;
    const pack = (tileset: Tileset): Promise<PackedTileset> => {
        packs.push(tileset.id);
        return failPack ? Promise.reject(failPack) : Promise.resolve(packTileset(tileset));
    };
    const textures = new TilesetTextures(renderer.target, pack, bitmap, {
        onChange: () => changes.push(changes.length),
        onError: (error) => errors.push(error),
    });
    return {
        ...renderer,
        textures,
        packs,
        changes,
        errors,
        failPacks(error: Error) {
            failPack = error;
        },
    };
}

/** Lets promise continuations run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("use", () => {
    it("packs and uploads each tileset once and reports when it can be drawn", async () => {
        const t = setup();
        t.textures.use([first, second]);
        t.textures.use([first, second]);
        await settle();
        expect(t.packs).toEqual([first.id, second.id]);
        expect(t.uploads.map((u) => u.id)).toEqual([
            tilesetTextureId(first.id),
            tilesetTextureId(second.id),
        ]);
        expect(t.textures.drawable(tilesets)).toEqual([]);

        t.uploads[1]!.release();
        await settle();
        expect(t.textures.drawable(tilesets).map((r) => r.tileset.id)).toEqual([second.id]);
        expect(t.changes).toHaveLength(1);
        t.uploads[0]!.release();
        await settle();
        // The order is the project's, not the order of arrival.
        expect(t.textures.drawable(tilesets).map((r) => r.tileset.id)).toEqual([
            first.id,
            second.id,
        ]);
    });

    it("hands out the UV table of the packed atlas", async () => {
        const t = setup();
        t.textures.use([third]);
        await settle();
        t.uploads[0]!.release();
        await settle();
        const [ready] = t.textures.drawable(tilesets);
        expect(ready!.texture).toBe(tilesetTextureId(third.id));
        expect(ready!.uvTable.ids).toEqual(packTileset(third).uvTable.ids);
        expect(ready!.uvTable.uv).toEqual(packTileset(third).uvTable.uv);
    });

    it("releases the textures of tilesets no longer used, and nothing else", async () => {
        const t = setup();
        t.textures.use([first, second]);
        await settle();
        for (const upload of t.uploads) upload.release();
        await settle();
        t.textures.use([second]);
        expect(t.released).toEqual([tilesetTextureId(first.id)]);
        expect(t.held.has(tilesetTextureId(first.id))).toBe(false);
        expect(t.held.has(tilesetTextureId(second.id))).toBe(true);
        expect(t.textures.drawable(tilesets).map((r) => r.tileset.id)).toEqual([second.id]);

        t.textures.use([]);
        expect(t.released).toEqual([tilesetTextureId(first.id), tilesetTextureId(second.id)]);
        expect(t.textures.textureIds).toEqual([]);
    });

    it("cancels an upload under way when its tileset is released", async () => {
        const t = setup();
        t.textures.use([first]);
        await settle();
        const upload = t.uploads[0]!;
        t.textures.use([]);
        expect(upload.signal!.aborted).toBe(true);
        upload.release();
        await settle();
        // The late result does not make the tileset drawable.
        expect(t.textures.drawable(tilesets)).toEqual([]);
        expect(t.changes).toEqual([]);
    });
});

describe("invalidate", () => {
    it("keeps the old texture drawable until the new one replaces it", async () => {
        const t = setup();
        t.textures.use([first]);
        await settle();
        t.uploads[0]!.release();
        await settle();
        const before = t.textures.drawable(tilesets)[0]!;

        t.textures.invalidate([first.id]);
        await settle();
        expect(t.uploads).toHaveLength(2);
        expect(t.textures.drawable(tilesets)[0]).toBe(before);
        expect(t.released).toEqual([]);

        t.uploads[1]!.release();
        await settle();
        const after = t.textures.drawable(tilesets)[0]!;
        expect(after.version).toBe(before.version + 1);
        expect(t.changes).toHaveLength(2);
    });

    it("lets the newest upload win when two overlap", async () => {
        const t = setup();
        t.textures.use([first]);
        await settle();
        t.textures.invalidate([first.id]);
        await settle();
        expect(t.uploads[0]!.signal!.aborted).toBe(true);
        t.uploads[0]!.release();
        t.uploads[1]!.release();
        await settle();
        expect(t.textures.drawable(tilesets)[0]!.version).toBe(2);
        expect(t.changes).toHaveLength(1);
    });

    it("uploads again when the project replaces a tileset by another object with the same ID", async () => {
        const t = setup();
        t.textures.use([first]);
        await settle();
        t.uploads[0]!.release();
        await settle();
        const before = t.textures.drawable(tilesets)[0]!;

        t.textures.use([first]);
        await settle();
        expect(t.uploads).toHaveLength(1);

        const replaced = { ...first, pixels: { ...first.pixels } };
        t.textures.use([replaced]);
        await settle();
        expect(t.uploads).toHaveLength(2);
        // The old texture is drawn until the new one is in.
        expect(t.textures.drawable(tilesets)[0]).toBe(before);
        t.uploads[1]!.release();
        await settle();
        const after = t.textures.drawable([replaced])[0]!;
        expect(after.tileset).toBe(replaced);
        expect(after.version).toBe(before.version + 1);
    });

    it("ignores tilesets that have no texture", async () => {
        const t = setup();
        t.textures.invalidate([first.id]);
        await settle();
        expect(t.packs).toEqual([]);
    });
});

describe("failures and disposal", () => {
    it("reports a pack failure and draws nothing of that tileset", async () => {
        const t = setup();
        const failure = new Error("cannot pack");
        t.failPacks(failure);
        t.textures.use([first]);
        await settle();
        expect(t.errors).toEqual([failure]);
        expect(t.textures.drawable(tilesets)).toEqual([]);
        expect(t.uploads).toEqual([]);
    });

    it("does nothing after dispose, and aborts what was under way", async () => {
        const t = setup();
        t.textures.use([first]);
        await settle();
        const upload = t.uploads[0]!;
        t.textures.dispose();
        expect(upload.signal!.aborted).toBe(true);
        t.textures.use([second]);
        t.textures.invalidate([first.id]);
        await settle();
        expect(t.uploads).toHaveLength(1);
    });
});
