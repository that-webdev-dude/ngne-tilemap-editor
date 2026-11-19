import { Camera, Frame, WebGPURenderer } from "@ngne/core";
import type { Sprite, TextureSampling } from "@ngne/core";
import { pixelAt, readCanvas } from "../../../src/engine/testing/readCanvas";

// ENGINE §7: the rows that need the GPU, checked against the pinned engine
// (tests/e2e/engine-gaps.spec.ts). Each check draws on one 64 × 64 canvas, reads it back in the
// same task as the render, and returns what it found; the spec decides.

const SIZE = 64;
/** Clear colour, opaque blue; no texel below uses it. */
const CLEAR = 0x0000ff;

type Rgba = [number, number, number, number];

/** An opaque texel of a test texture: distinct for every (i, j) up to 6 × 6. */
function texel(i: number, j: number): Rgba {
    return [40 * i + 20, 40 * j + 20, 200, 255];
}

/** A canvas of `width × height` texels, each `colour(i, j)`. */
function image(width: number, height: number, colour: (i: number, j: number) => Rgba) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { colorSpace: "srgb" })!;
    const data = context.createImageData(width, height, { colorSpace: "srgb" });
    for (let j = 0; j < height; j++)
        for (let i = 0; i < width; i++) data.data.set(colour(i, j), (j * width + i) * 4);
    context.putImageData(data, 0, 0);
    return canvas;
}

let renderer: WebGPURenderer | null = null;

async function engine(): Promise<WebGPURenderer> {
    if (renderer) return renderer;
    const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
    renderer = await WebGPURenderer.create(canvas, SIZE, SIZE);
    return renderer;
}

/** Draws `sprites` with `camera` and returns the canvas as read back. */
async function draw(camera: Camera, sprites: Sprite[]): Promise<ImageData> {
    const r = await engine();
    const frame = new Frame();
    frame.scene(camera, 1);
    for (const sprite of sprites) frame.sprite(sprite);
    r.render(frame, CLEAR);
    return readCanvas(r.canvas);
}

/** Pixels of `actual` in the rectangle at (x, y) that differ from `expected(i, j)`. */
function mismatches(
    actual: ImageData,
    x: number,
    y: number,
    width: number,
    height: number,
    expected: (i: number, j: number) => Rgba,
): string[] {
    const out: string[] = [];
    for (let j = 0; j < height; j++)
        for (let i = 0; i < width; i++) {
            const got = pixelAt(actual, x + i, y + j);
            const want = expected(i, j);
            if (got.some((v, k) => v !== want[k]))
                out.push(`(${x + i}, ${y + j}) ${got.join(",")} want ${want.join(",")}`);
        }
    return out;
}

const blue: Rgba = [0, 0, 255, 255];
const full = (sprite: Partial<Sprite>): Sprite => ({
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    u: 0,
    v: 0,
    uw: 1,
    vh: 1,
    ...sprite,
});

/** Odd sizes under `pixelSnap`: a 5 × 3 texture at a fractional centre, plain and flipped. */
async function snap() {
    const r = await engine();
    await r.texture("gaps:5x3", image(5, 3, texel));
    const camera = new Camera();
    camera.pixelSnap = true;
    // Centre (20.3, 20.7): the corner rounds to (18, 19). Flipped at (40.3, 20.7): (38, 19).
    const plain = await draw(camera, [
        full({ x: 20.3, y: 20.7, width: 5, height: 3, texture: "gaps:5x3" }),
    ]);
    const flipped = await draw(camera, [
        full({ x: 40.3, y: 20.7, width: -5, height: 3, texture: "gaps:5x3" }),
    ]);
    return {
        plain: mismatches(plain, 18, 19, 5, 3, texel),
        plainBorder: mismatches(plain, 17, 18, 7, 5, (i, j) =>
            i === 0 || j === 0 || i === 6 || j === 4 ? blue : texel(i - 1, j - 1),
        ),
        flipped: mismatches(flipped, 38, 19, 5, 3, (i, j) => texel(4 - i, j)),
        flippedBorder: mismatches(flipped, 37, 18, 7, 5, (i, j) =>
            i === 0 || j === 0 || i === 6 || j === 4 ? blue : texel(4 - (i - 1), j - 1),
        ),
    };
}

/** Camera zoom 2 against the editor's own scaling of positions and sizes, at zoom 1. */
async function zoom() {
    const r = await engine();
    await r.texture("gaps:5x3", image(5, 3, texel));
    const zoomed = new Camera();
    zoomed.pixelSnap = false;
    zoomed.cut(0, 0, 2);
    const byEngine = await draw(zoomed, [
        full({ x: 12.5, y: 11.5, width: 5, height: 3, texture: "gaps:5x3" }),
    ]);
    const plain = new Camera();
    plain.pixelSnap = false;
    const byEditor = await draw(plain, [
        full({ x: 25, y: 23, width: 10, height: 6, texture: "gaps:5x3" }),
    ]);
    let differing = 0;
    for (let k = 0; k < byEngine.data.length; k++)
        if (byEngine.data[k] !== byEditor.data[k]) differing++;
    return {
        zoom: [zoomed.zoom, zoomed.previousZoom],
        blocks: mismatches(byEngine, 20, 20, 10, 6, (i, j) =>
            texel(Math.floor(i / 2), Math.floor(j / 2)),
        ),
        differingBytes: differing,
    };
}

/** A 2 × 2 texture over an 8 × 8 quad with UVs 0–4, registered with `sampling`. */
async function tiled(id: string, sampling: TextureSampling | undefined) {
    const r = await engine();
    await r.texture(id, image(2, 2, texel), undefined, sampling);
    const camera = new Camera();
    camera.pixelSnap = false;
    return draw(camera, [full({ x: 8, y: 8, width: 8, height: 8, texture: id, uw: 4, vh: 4 })]);
}

/** Repeat addressing against the default clamp. */
async function repeat() {
    const repeated = await tiled("gaps:repeat", { address: "repeat" });
    const clamped = await tiled("gaps:clamp", undefined);
    return {
        repeat: mismatches(repeated, 4, 4, 8, 8, (i, j) => texel(i % 2, j % 2)),
        clamp: mismatches(clamped, 4, 4, 8, 8, (i, j) => texel(Math.min(i, 1), Math.min(j, 1))),
    };
}

/** Red channel along row y of `image`, from x0 for `count` pixels. */
function reds(image: ImageData, x0: number, y: number, count: number): number[] {
    return Array.from({ length: count }, (_, i) => pixelAt(image, x0 + i, y)[0]);
}

/** Linear filtering: a two-texel ramp, and an atlas sub-rectangle next to another colour. */
async function linear() {
    const r = await engine();
    const ramp = image(2, 1, (i) => (i === 0 ? [0, 0, 0, 255] : [255, 0, 0, 255]));
    await r.texture("gaps:ramp-linear", ramp, undefined, { filter: "linear" });
    await r.texture("gaps:ramp-nearest", ramp);
    // Atlas of 4 × 1: two red texels, then two green ones; the quad shows the red half only.
    const atlas = image(4, 1, (i) => (i < 2 ? [255, 0, 0, 255] : [0, 255, 0, 255]));
    await r.texture("gaps:atlas-linear", atlas, undefined, { filter: "linear" });
    await r.texture("gaps:atlas-nearest", atlas);
    const camera = new Camera();
    camera.pixelSnap = false;
    const quad = (texture: string, y: number, uw = 1) =>
        full({ x: 24, y, width: 16, height: 4, texture, uw });
    const out = await draw(camera, [
        quad("gaps:ramp-linear", 10),
        quad("gaps:ramp-nearest", 20),
        quad("gaps:atlas-linear", 30, 0.5),
        quad("gaps:atlas-nearest", 40, 0.5),
    ]);
    return {
        rampLinear: reds(out, 16, 10, 16),
        rampNearest: reds(out, 16, 20, 16),
        atlasLinearGreen: pixelAt(out, 31, 30)[1],
        atlasNearestGreen: pixelAt(out, 31, 40)[1],
    };
}

/** Per-sprite clipping of a solid 32 × 32 sprite to a 4 × 4 rectangle. */
async function clip() {
    const camera = new Camera();
    camera.pixelSnap = false;
    const out = await draw(camera, [
        {
            x: 16,
            y: 16,
            width: 32,
            height: 32,
            color: 0xff0000,
            clip: { x: 8, y: 8, width: 4, height: 4 },
        },
    ]);
    let red = 0;
    for (let y = 0; y < SIZE; y++)
        for (let x = 0; x < SIZE; x++) if (pixelAt(out, x, y)[0] === 255) red++;
    return {
        red,
        inside: mismatches(out, 8, 8, 4, 4, () => [255, 0, 0, 255]),
        drawCalls: renderer!.drawCalls,
    };
}

/** Draw calls for three sprites of two textures, interleaved and grouped. */
async function batching() {
    const r = await engine();
    await r.texture(
        "gaps:a",
        image(1, 1, () => [255, 0, 0, 255]),
    );
    await r.texture(
        "gaps:b",
        image(1, 1, () => [0, 255, 0, 255]),
    );
    const camera = new Camera();
    const at = (x: number, texture: string) => full({ x, y: 8, width: 4, height: 4, texture });
    await draw(camera, [at(4, "gaps:a"), at(12, "gaps:b"), at(20, "gaps:a")]);
    const interleaved = r.drawCalls;
    await draw(camera, [at(4, "gaps:a"), at(20, "gaps:a"), at(12, "gaps:b")]);
    const grouped = r.drawCalls;
    return { interleaved, grouped };
}

/** `submittedWorkDone` after a frame, with an aborted signal, and after disposal. */
async function submittedWork() {
    const r = await engine();
    await draw(new Camera(), [{ x: 8, y: 8, width: 4, height: 4, color: 0xffffff }]);
    const settle = (promise: Promise<void>) =>
        promise.then(
            () => "resolved",
            (error: unknown) => `rejected: ${error instanceof Error ? error.name : String(error)}`,
        );
    const afterFrame = await settle(r.submittedWorkDone());
    const abort = new AbortController();
    abort.abort(new DOMException("stop", "AbortError"));
    const aborted = await settle(r.submittedWorkDone(abort.signal));
    r.dispose();
    renderer = null;
    const afterDispose = await settle(r.submittedWorkDone());
    return { afterFrame, aborted, afterDispose };
}

/**
 * `WebGPURenderer.create` with an adapter request that never settles, aborted after 50 ms:
 * whether the creation settles within `limit` ms. Replaces `navigator.gpu.requestAdapter`, so
 * it runs on a page of its own, last.
 */
async function hungCreate(limit: number, abortAfter: number | null) {
    const gpu = (navigator as Navigator & { gpu: { requestAdapter: () => Promise<unknown> } }).gpu;
    let requests = 0;
    gpu.requestAdapter = () => {
        requests++;
        return new Promise<never>(() => {});
    };
    const canvas = document.createElement("canvas");
    const abort = new AbortController();
    const start = performance.now();
    const created = WebGPURenderer.create(canvas, SIZE, SIZE, undefined, abort.signal).then(
        () => ({ outcome: "resolved", error: "" }),
        (error: unknown) => ({
            outcome: "rejected",
            error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        }),
    );
    if (abortAfter !== null) setTimeout(() => abort.abort(), abortAfter);
    const timeout = new Promise<{ outcome: string; error: string }>((resolve) =>
        setTimeout(() => resolve({ outcome: "pending", error: "" }), limit),
    );
    const result = await Promise.race([created, timeout]);
    return { ...result, requests, ms: Math.round(performance.now() - start) };
}

const checks = { snap, zoom, repeat, linear, clip, batching, submittedWork, hungCreate };
declare global {
    interface Window {
        engineGaps?: typeof checks;
    }
}
window.engineGaps = checks;
document.querySelector("#status")!.textContent = "ready";
