import type { PixelBuffer, Tileset } from "../../core/model";
import type { PackedTileset, TileUvTable } from "../../core/pack";

// The textures of the viewport (ENGINE §3): `ed:ts:<tilesetId>` for every tileset an open map
// uses, `ed:checker`. A texture is uploaded once, replaced when its source changes, released
// when nothing uses it. No NGNE import: the renderer is reached through `TextureTarget`.

/** The texture ID of a tileset's packed atlas. */
export function tilesetTextureId(tilesetId: string): string {
    return `ed:ts:${tilesetId}`;
}

export const CHECKER_TEXTURE_ID = "ed:checker";

/** What the renderer offers for textures; `WebGPURenderer` has this shape. */
export interface TextureTarget {
    texture(id: string, source: ImageBitmap, signal?: AbortSignal): Promise<void>;
    releaseTexture(id: string): void;
}

/** Packs a tileset into its atlas image and UV table (`packTileset`, here or in the worker). */
export type PackFn = (tileset: Tileset, signal?: AbortSignal) => Promise<PackedTileset>;

/** Makes the upload source of an image. */
export type BitmapFn = (pixels: PixelBuffer) => Promise<ImageBitmap>;

/** `createImageBitmap` of the pixels, straight alpha. */
export const bitmapFromPixels: BitmapFn = (pixels) =>
    createImageBitmap(
        // Pixel buffers never sit on shared memory.
        new ImageData(pixels.data as Uint8ClampedArray<ArrayBuffer>, pixels.width, pixels.height),
        { premultiplyAlpha: "none", colorSpaceConversion: "none" },
    );

export interface TextureSetHooks {
    /** A tileset's texture became drawable or changed: the scene has to be drawn again. */
    onChange(): void;
    /** An upload or a pack failed; the tileset's tiles are not drawn until it is invalidated. */
    onError(error: unknown): void;
}

/** A tileset the viewport can draw: its texture is on the renderer. */
export interface ReadyTileset {
    tileset: Tileset;
    texture: string;
    uvTable: TileUvTable;
    /**
     * The upload's number, unique among all uploads of the `TilesetTextures`, so a tileset
     * released and used again never repeats one; part of the emitter's cache key.
     */
    version: number;
}

interface Entry {
    tileset: Tileset;
    /** The number of the latest requested upload. */
    wanted: number;
    ready: ReadyTileset | null;
    /** Aborts the upload under way. */
    abort: AbortController | null;
}

/**
 * The tileset textures of a viewport. `use` names the tilesets that open maps need: each is
 * packed and uploaded, and every other one is released. `invalidate` repacks tilesets whose
 * pixels or tiles changed; the old texture stays drawable until the new one replaces it (the
 * upload is `texture()`, transactional), so the map never loses its tiles meanwhile.
 */
export class TilesetTextures {
    readonly #target: TextureTarget;
    readonly #pack: PackFn;
    readonly #bitmap: BitmapFn;
    readonly #hooks: TextureSetHooks;
    readonly #entries = new Map<string, Entry>();
    /** Uploads requested, of every tileset: numbers them. */
    #uploads = 0;
    #disposed = false;

    constructor(target: TextureTarget, pack: PackFn, bitmap: BitmapFn, hooks: TextureSetHooks) {
        this.#target = target;
        this.#pack = pack;
        this.#bitmap = bitmap;
        this.#hooks = hooks;
    }

    /** IDs of the textures on the renderer for tilesets. */
    get textureIds(): string[] {
        return [...this.#entries.values()]
            .filter((entry) => entry.ready !== null)
            .map((entry) => tilesetTextureId(entry.tileset.id));
    }

    /** The tilesets to draw from, in the order of `order`; those not uploaded yet are left out. */
    drawable(order: readonly Tileset[]): ReadyTileset[] {
        const ready: ReadyTileset[] = [];
        for (const tileset of order) {
            const found = this.#entries.get(tileset.id)?.ready;
            if (found) ready.push(found);
        }
        return ready;
    }

    /** Makes exactly `tilesets` the ones with a texture (uploading and releasing as needed). */
    use(tilesets: readonly Tileset[]): void {
        if (this.#disposed) return;
        const wanted = new Set(tilesets.map((tileset) => tileset.id));
        for (const [id, entry] of this.#entries) {
            if (wanted.has(id)) continue;
            entry.abort?.abort();
            // Absent IDs are no-ops; a first upload still under way is cancelled by this too.
            this.#target.releaseTexture(tilesetTextureId(id));
            this.#entries.delete(id);
        }
        for (const tileset of tilesets) {
            const entry = this.#entries.get(tileset.id);
            if (entry) {
                // Another object with the same ID is another tileset's content (a project that
                // replaced the session): its atlas is packed and uploaded again.
                if (entry.tileset !== tileset) {
                    entry.tileset = tileset;
                    this.#upload(entry);
                }
            } else {
                this.#upload({ tileset, wanted: 0, ready: null, abort: null });
            }
        }
    }

    /** The pixels or tiles of these tilesets changed: upload them again. */
    invalidate(ids: readonly string[]): void {
        if (this.#disposed) return;
        for (const id of ids) {
            const entry = this.#entries.get(id);
            if (entry) this.#upload(entry);
        }
    }

    dispose(): void {
        this.#disposed = true;
        for (const entry of this.#entries.values()) entry.abort?.abort();
        this.#entries.clear();
    }

    #upload(entry: Entry): void {
        const { tileset } = entry;
        if (!this.#entries.has(tileset.id)) this.#entries.set(tileset.id, entry);
        entry.abort?.abort();
        const abort = new AbortController();
        entry.abort = abort;
        this.#uploads += 1;
        entry.wanted = this.#uploads;
        const mine = entry.wanted;
        void (async () => {
            const packed = await this.#pack(tileset, abort.signal);
            if (abort.signal.aborted) return;
            const bitmap = await this.#bitmap(packed.image);
            try {
                if (abort.signal.aborted) return;
                await this.#target.texture(tilesetTextureId(tileset.id), bitmap, abort.signal);
            } finally {
                bitmap.close();
            }
            if (abort.signal.aborted || mine !== entry.wanted) return;
            entry.ready = {
                tileset,
                texture: tilesetTextureId(tileset.id),
                uvTable: packed.uvTable,
                version: mine,
            };
            entry.abort = null;
            this.#hooks.onChange();
        })().catch((error: unknown) => {
            if (abort.signal.aborted || this.#disposed) return;
            entry.abort = null;
            this.#hooks.onError(error);
        });
    }
}
