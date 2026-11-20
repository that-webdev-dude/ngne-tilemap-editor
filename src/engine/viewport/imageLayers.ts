import type { Frame, Sprite } from "@ngne/core";
import { walkLayers } from "../../core/model";
import type { ImageLayer, PixelBuffer, Project, ProjectMap } from "../../core/model";
import type { MapRect, PixelRect } from "./geometry";
import type { BitmapFn, TextureSampling, TextureTarget } from "./textures";

// Image layers in the viewport (ENGINE §3, §4): one texture per image layer, `ed:img:<layerId>`,
// holding the layer's image once, uploaded while the map shows and released with it. The layer
// draws its image with its top-left corner at the layer's shift (FORMAT §3.4) as one quad. A
// layer that repeats on either axis has its texture sampled with repeat addressing, and its quad
// covers the area drawn along each repeated axis, its UVs carrying the copies it spans and where
// in a copy the area starts. No NGNE value import: the renderer is reached through
// `TextureTarget`.

/** The texture ID of an image layer (ENGINE §3). */
export function imageTextureId(layerId: number): string {
    return `ed:img:${layerId}`;
}

/** The sampling of a repeated image layer's texture: UVs outside 0–1 tile the image. */
export const REPEAT_SAMPLING: TextureSampling = { address: "repeat" };

/** What a layer's texture holds: the image's pixels (by identity), and how they are sampled. */
interface Content {
    pixels: PixelBuffer;
    repeat: boolean;
}

/** An image layer's texture, ready to draw. */
export interface ReadyImage {
    texture: string;
    /** The image's size in map pixels. */
    width: number;
    height: number;
}

interface Entry {
    wanted: Content;
    ready: (Content & ReadyImage) | null;
    abort: AbortController | null;
}

export interface ImageTextureHooks {
    /** A texture became drawable: the scene has to be drawn again. */
    onChange(): void;
    onError(error: unknown): void;
}

function sameContent(a: Content, b: Content): boolean {
    return a.pixels === b.pixels && a.repeat === b.repeat;
}

function contentOf(layer: ImageLayer, pixels: PixelBuffer): Content {
    return { pixels, repeat: layer.repeatX || layer.repeatY };
}

/** The content of each image layer of `map` whose image exists, by layer ID. */
function wantedContent(project: Project, map: ProjectMap): Map<number, Content> {
    const wanted = new Map<number, Content>();
    let images: Map<string, PixelBuffer> | null = null;
    for (const { layer } of walkLayers(map.layers)) {
        if (layer.type !== "image") continue;
        images ??= new Map(project.images.map((image) => [image.id, image.pixels]));
        const pixels = images.get(layer.imageId);
        if (pixels) wanted.set(layer.id, contentOf(layer, pixels));
    }
    return wanted;
}

/**
 * The image layer textures of a viewport. `use` names the shown map: each of its image layers
 * gets a texture of its image (uploaded again when the image changes, or when the layer starts
 * or stops repeating), every other one is released. A texture is drawn only while it holds the
 * layer's current content.
 */
export class ImageLayerTextures {
    readonly #target: TextureTarget;
    readonly #bitmap: BitmapFn;
    readonly #hooks: ImageTextureHooks;
    readonly #entries = new Map<number, Entry>();
    #disposed = false;

    constructor(target: TextureTarget, bitmap: BitmapFn, hooks: ImageTextureHooks) {
        this.#target = target;
        this.#bitmap = bitmap;
        this.#hooks = hooks;
    }

    /** Makes the image layers of `map` (none when null) the ones with a texture. */
    use(project: Project | null, map: ProjectMap | null): void {
        if (this.#disposed) return;
        const wanted = project && map ? wantedContent(project, map) : new Map<number, Content>();
        for (const [id, entry] of this.#entries) {
            if (wanted.has(id)) continue;
            entry.abort?.abort();
            this.#target.releaseTexture(imageTextureId(id));
            this.#entries.delete(id);
        }
        for (const [id, content] of wanted) {
            const entry = this.#entries.get(id);
            if (entry && sameContent(entry.wanted, content)) continue;
            this.#upload(id, content);
        }
    }

    /** The texture of `layer` when it holds the layer's current image; null otherwise. */
    ready(layer: ImageLayer, pixels: PixelBuffer): ReadyImage | null {
        const ready = this.#entries.get(layer.id)?.ready;
        if (!ready || !sameContent(ready, contentOf(layer, pixels))) return null;
        return ready;
    }

    dispose(): void {
        this.#disposed = true;
        for (const entry of this.#entries.values()) entry.abort?.abort();
        this.#entries.clear();
    }

    #upload(id: number, content: Content): void {
        let entry = this.#entries.get(id);
        if (!entry) {
            entry = { wanted: content, ready: null, abort: null };
            this.#entries.set(id, entry);
        }
        entry.abort?.abort();
        entry.wanted = content;
        const abort = new AbortController();
        entry.abort = abort;
        const own = entry;
        const texture = imageTextureId(id);
        const sampling = content.repeat ? REPEAT_SAMPLING : undefined;
        void (async () => {
            const { pixels } = content;
            const bitmap = await this.#bitmap(pixels);
            try {
                if (abort.signal.aborted) return;
                await this.#target.texture(texture, bitmap, abort.signal, sampling);
            } finally {
                bitmap.close();
            }
            if (abort.signal.aborted || own.wanted !== content) return;
            own.ready = { ...content, texture, width: pixels.width, height: pixels.height };
            own.abort = null;
            this.#hooks.onChange();
        })().catch((error: unknown) => {
            if (abort.signal.aborted || this.#disposed) return;
            own.abort = null;
            this.#hooks.onError(error);
        });
    }
}

/** One axis of an image layer's quad, in map pixels and in UV (one unit per copy). */
interface Axis {
    start: number;
    length: number;
    uv: number;
    copies: number;
}

/**
 * An axis of the quad that draws an image of `side` px placed at `shift` over the span
 * `[from, from + length)`: on a repeated axis the span, starting `uv` into a copy; otherwise the
 * image, when it meets the span. Null when nothing is drawn.
 */
function axis(
    from: number,
    length: number,
    shift: number,
    side: number,
    repeat: boolean,
): Axis | null {
    if (!repeat) {
        const meets = shift < from + length && shift + side > from;
        return meets ? { start: shift, length: side, uv: 0, copies: 1 } : null;
    }
    if (length <= 0) return null;
    const at = (from - shift) / side;
    return { start: from, length, uv: at - Math.floor(at), copies: length / side };
}

/** Where and how an image layer is drawn. */
export interface ImageDraw {
    layer: ImageLayer;
    ready: ReadyImage;
    /** 0..255. */
    opacity: number;
    /** The layer's shift in map pixels (FORMAT §3.4). */
    shift: { x: number; y: number };
}

/**
 * Emits the quad of an image layer when it meets `area` (map pixels): the image, in map pixels,
 * stretched to the area along each repeated axis with UVs that tile it. With `clip` (device
 * pixels), the quad has it as its sprite clip. Returns the quads emitted.
 */
export function emitImageLayer(
    frame: Frame,
    draw: ImageDraw,
    area: MapRect,
    place: { layer: number; depth: number; clip?: PixelRect | null },
): number {
    const { layer, ready, opacity, shift } = draw;
    const xs = axis(area.x, area.width, shift.x, ready.width, layer.repeatX);
    const ys = axis(area.y, area.height, shift.y, ready.height, layer.repeatY);
    if (!xs || !ys) return 0;
    const quad: Sprite = {
        x: xs.start + xs.length / 2,
        y: ys.start + ys.length / 2,
        width: xs.length,
        height: ys.length,
        rotation: 0,
        texture: ready.texture,
        u: xs.uv,
        v: ys.uv,
        uw: xs.copies,
        vh: ys.copies,
        alpha: opacity / 255,
        color: 0xffffffff,
        layer: place.layer,
        depth: place.depth,
    };
    if (place.clip) quad.clip = place.clip;
    frame.sprite(quad);
    return 1;
}
