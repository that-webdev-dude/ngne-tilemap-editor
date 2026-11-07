import type { Frame } from "@ngne/core";
import { MAX_IMAGE_SIDE, walkLayers } from "../../core/model";
import type { ImageLayer, PixelBuffer, Project, ProjectMap } from "../../core/model";
import type { SpriteLike } from "../../core/runtime/emit";
import { clipQuad } from "./clipQuad";
import type { DeviceRect } from "./clipQuad";
import { toDevice } from "./geometry";
import type { Camera2D, DeviceSize, MapRect } from "./geometry";
import type { BitmapFn, TextureTarget } from "./textures";

// Image layers in the viewport (ENGINE §3, §4): one texture per image layer, `ed:img:<layerId>`,
// uploaded while the map shows and released with it; the layer draws its image with its top-left
// corner at the layer's shift (FORMAT §3.4), and a repeated axis as a grid of quads covering the
// area drawn. So that a small image repeated over a large view does not take a quad per copy, the
// texture of a repeated axis holds several copies side by side (at least `MIN_REPEAT_SPAN` px,
// at most 8192 px): the same pixels, fewer quads. No NGNE value import: the renderer is reached
// through `TextureTarget`.

/** The texture ID of an image layer (ENGINE §3). */
export function imageTextureId(layerId: number): string {
    return `ed:img:${layerId}`;
}

/** A repeated axis's texture spans at least this many pixels, when 8192 px allow it. */
export const MIN_REPEAT_SPAN = 512;

/** Copies of the image side by side in the texture along an axis of `side` px. */
export function repeatCopies(side: number, repeat: boolean): number {
    if (!repeat) return 1;
    return Math.max(
        1,
        Math.min(Math.floor(MAX_IMAGE_SIDE / side), Math.ceil(MIN_REPEAT_SPAN / side)),
    );
}

/** `copiesX × copiesY` copies of `pixels`, side by side. */
export function repeatedPixels(pixels: PixelBuffer, copiesX: number, copiesY: number): PixelBuffer {
    if (copiesX === 1 && copiesY === 1) return pixels;
    const { width, height, data } = pixels;
    const out = new Uint8ClampedArray(width * copiesX * height * copiesY * 4);
    const row = width * 4;
    const stride = row * copiesX;
    for (let y = 0; y < height; y += 1) {
        const source = data.subarray(y * row, (y + 1) * row);
        const first = y * stride;
        for (let k = 0; k < copiesX; k += 1) out.set(source, first + k * row);
    }
    const block = stride * height;
    for (let k = 1; k < copiesY; k += 1) out.copyWithin(k * block, 0, block);
    return { width: width * copiesX, height: height * copiesY, data: out };
}

/** What a layer's texture holds: the image's pixels (by identity) and the copies of each axis. */
interface Content {
    pixels: PixelBuffer;
    copiesX: number;
    copiesY: number;
}

/** An image layer's texture, ready to draw. */
export interface ReadyImage {
    texture: string;
    /** The span of one quad in map pixels: the image times its copies. */
    spanX: number;
    spanY: number;
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
    return a.pixels === b.pixels && a.copiesX === b.copiesX && a.copiesY === b.copiesY;
}

function contentOf(layer: ImageLayer, pixels: PixelBuffer): Content {
    return {
        pixels,
        copiesX: repeatCopies(pixels.width, layer.repeatX),
        copiesY: repeatCopies(pixels.height, layer.repeatY),
    };
}

/**
 * The image layer textures of a viewport. `use` names the shown map: each of its image layers
 * gets a texture of its image (uploaded again when the image or its repeat changes), every other
 * one is released. A texture is drawn only while it holds the layer's current content.
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
        const wanted = new Map<number, Content>();
        if (project && map) {
            let images: Map<string, PixelBuffer> | null = null;
            for (const { layer } of walkLayers(map.layers)) {
                if (layer.type !== "image") continue;
                images ??= new Map(project.images.map((image) => [image.id, image.pixels]));
                const pixels = images.get(layer.imageId);
                if (pixels) wanted.set(layer.id, contentOf(layer, pixels));
            }
        }
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
        void (async () => {
            const { pixels, copiesX, copiesY } = content;
            const bitmap = await this.#bitmap(repeatedPixels(pixels, copiesX, copiesY));
            try {
                if (abort.signal.aborted) return;
                await this.#target.texture(texture, bitmap, abort.signal);
            } finally {
                bitmap.close();
            }
            if (abort.signal.aborted || own.wanted !== content) return;
            own.ready = {
                ...content,
                texture,
                spanX: pixels.width * copiesX,
                spanY: pixels.height * copiesY,
            };
            own.abort = null;
            this.#hooks.onChange();
        })().catch((error: unknown) => {
            if (abort.signal.aborted || this.#disposed) return;
            own.abort = null;
            this.#hooks.onError(error);
        });
    }
}

/** The first and last copy index of an axis that a span `[from, from + length)` meets. */
function copies(
    from: number,
    length: number,
    shift: number,
    span: number,
    repeat: boolean,
): [number, number] | null {
    if (!repeat) return shift < from + length && shift + span > from ? [0, 0] : null;
    const first = Math.floor((from - shift) / span);
    const last = Math.ceil((from + length - shift) / span) - 1;
    return last >= first ? [first, last] : null;
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
 * Emits the quads of an image layer that meet `area` (map pixels): one, or a grid along each
 * repeated axis. With `clip`, each quad is cut to it (device pixels). Returns the quads emitted.
 */
export function emitImageLayer(
    frame: Frame,
    camera: Camera2D,
    size: DeviceSize,
    draw: ImageDraw,
    area: MapRect,
    place: { layer: number; depth: number; clip?: DeviceRect | null },
): number {
    const { layer, ready, opacity, shift } = draw;
    const xs = copies(area.x, area.width, shift.x, ready.spanX, layer.repeatX);
    const ys = copies(area.y, area.height, shift.y, ready.spanY, layer.repeatY);
    if (!xs || !ys) return 0;
    const width = ready.spanX * camera.scale;
    const height = ready.spanY * camera.scale;
    const quad: SpriteLike = {
        x: 0,
        y: 0,
        width,
        height,
        rotation: 0,
        texture: ready.texture,
        u: 0,
        v: 0,
        uw: 1,
        vh: 1,
        alpha: opacity / 255,
        color: 0xffffffff,
        layer: place.layer,
        depth: place.depth,
    };
    const cut: SpriteLike = { ...quad };
    let count = 0;
    for (let ky = ys[0]; ky <= ys[1]; ky += 1) {
        for (let kx = xs[0]; kx <= xs[1]; kx += 1) {
            const at = toDevice(
                camera,
                size,
                shift.x + kx * ready.spanX,
                shift.y + ky * ready.spanY,
            );
            quad.x = at.x + width / 2;
            quad.y = at.y + height / 2;
            if (place.clip) {
                if (!clipQuad(quad, place.clip, cut)) continue;
                frame.sprite(cut);
            } else {
                frame.sprite(quad);
            }
            count += 1;
        }
    }
    return count;
}
