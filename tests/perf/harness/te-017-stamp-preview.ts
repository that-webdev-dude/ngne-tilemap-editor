// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { appCommands } from "../../../src/app/commands/appCommands";
import { overlayLayers } from "../../../src/app/overlay/overlayLayers";
import { toolState } from "../../../src/app/tools/activeTool";
import { currentStamp } from "../../../src/app/tools/stamp/currentStamp";
import { currentViewMapping } from "../../../src/app/view/viewNavigation";
import { createProjectSession } from "../../../src/core/model";
import type { Project, TileLayer } from "../../../src/core/model";
import { createReferenceProject, REFERENCE } from "../../support/referenceProject";

// fix-stamp-preview benchmark page module (tests/perf/te-017-stamp-preview.perf.ts): the
// reference map at 100% in the editor's viewport, its cells 16 px or, with every tile enlarged
// twice, 32 px, the stamp brush on the layer under the parallax layer. Select All, Copy and
// Paste make the whole layer the current stamp (256 × 256 cells); its preview on the overlay is
// then drawn at the pointer and in the rail. The main thread's longest task is measured around
// each step, and every overlay redraw is timed, from its first draw layer's start to its last
// one's end. The page imports it into the running editor.

function viewport() {
    const probe = window.__ngneTest?.viewport;
    if (!probe) throw new Error("te-017 stamp preview: no viewport");
    return probe;
}

/** Resolves when `condition` holds, checked between tasks. */
function until(condition: () => boolean): Promise<void> {
    return new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
            if (condition()) {
                channel.port1.close();
                resolve();
            } else {
                channel.port2.postMessage(null);
            }
        };
        channel.port2.postMessage(null);
    });
}

/** Milliseconds of each overlay redraw since the page was opened, and when each one began and ended. */
const redrawMs: number[] = [];
const redrawStart: number[] = [];
const redrawEnd: number[] = [];

/** Times every redraw of the overlay: its bottom layer's start to its top layer's end. */
function timeRedraws(): void {
    const bottom = overlayLayers[0]!;
    const top = overlayLayers[overlayLayers.length - 1]!;
    const drawBottom = bottom.draw;
    const drawTop = top.draw;
    let start = 0;
    bottom.draw = (frame) => {
        start = performance.now();
        drawBottom(frame);
    };
    top.draw = (frame) => {
        try {
            drawTop(frame);
        } finally {
            const end = performance.now();
            redrawMs.push(end - start);
            redrawStart.push(start);
            redrawEnd.push(end);
        }
    };
}

/** Every tile of `project` enlarged `factor` times, nearest neighbour, and its maps' cells. */
function enlarge(project: Project, factor: number): void {
    for (const tileset of project.tilesets) {
        const { width, height, data } = tileset.pixels;
        const wide = width * factor;
        const out = new Uint8ClampedArray(wide * height * factor * 4);
        for (let y = 0; y < height * factor; y++) {
            for (let x = 0; x < wide; x++) {
                const from = (Math.floor(y / factor) * width + Math.floor(x / factor)) * 4;
                out.set(data.subarray(from, from + 4), (y * wide + x) * 4);
            }
        }
        Object.assign(tileset, {
            tileWidth: tileset.tileWidth * factor,
            tileHeight: tileset.tileHeight * factor,
            pixels: { width: wide, height: height * factor, data: out },
        });
    }
    for (const map of project.maps) {
        Object.assign(map, {
            tileWidth: map.tileWidth * factor,
            tileHeight: map.tileHeight * factor,
        });
    }
}

export interface Opened {
    canvas: [number, number];
    cell: number;
}

/**
 * Opens the reference map with cells of `cell` px (16 or 32) at 100% in its middle, the layer
 * under the parallax layer active and the stamp brush selected, and times the overlay's redraws
 * from then on.
 */
export async function openReference(cell: number): Promise<Opened> {
    const probe = viewport();
    const project = createReferenceProject();
    if (cell !== REFERENCE.tileWidth) enlarge(project, cell / REFERENCE.tileWidth);
    const session = createProjectSession(project);
    const map = project.maps[0]!;
    const mapSession = session.perMap.get(session.activeMapId)!;
    const side = REFERENCE.width * cell;
    Object.assign(mapSession.view, { centreX: side / 2, centreY: side / 2, zoom: 1 });
    mapSession.activeLayerId = (map.layers[REFERENCE.parallaxLayer - 1] as TileLayer).id;
    window.__ngneTest!.session.getState().replace(session);
    await until(() => probe.textureIds().filter((id) => id.startsWith("ed:ts:")).length === 2);
    if (!toolState.select("stamp")) throw new Error("te-017 stamp preview: no stamp brush");
    timeRedraws();
    await until(() => probe.stats.frames > 0);
    // The overview's build in the background (ENGINE §4) is over before anything is measured.
    await until(() => probe.chunkStats().ready && probe.chunkStats().pending === 0);
    return { canvas: [probe.canvas.width, probe.canvas.height], cell };
}

/** The client position of the centre of cell `(x, y)` as the map is on screen. */
export function cellClient(x: number, y: number): { x: number; y: number } {
    const mapping = currentViewMapping()!;
    const { tileWidth, tileHeight } = mapping.frame;
    return mapping.mapToClient((x + 0.5) * tileWidth, (y + 0.5) * tileHeight);
}

/** Resolves when the overlay has no redraw left to make, one animation frame later included. */
export async function settled(): Promise<void> {
    const overlay = () => window.__ngneTest!.overlay!;
    do {
        await until(() => overlay().pending === false);
        await new Promise((resolve) => requestAnimationFrame(resolve));
    } while (overlay().pending);
}

/** The number of redraws timed so far. */
export function mark(): number {
    return redrawMs.length;
}

/** The redraws timed since `from` (a `mark`). */
export function redrawsSince(from: number): number[] {
    return redrawMs.slice(from);
}

// A message loop measures the main thread, as TE-015's benchmark does: the longest gap between
// two of its turns is the longest task meanwhile.
let loop: MessageChannel | null = null;
let lastTurn = 0;
let longestGapMs = 0;

/** Starts measuring the main thread's tasks; `longestTask` stops. */
export function watchTasks(): void {
    loop?.port1.close();
    const channel = new MessageChannel();
    loop = channel;
    lastTurn = performance.now();
    longestGapMs = 0;
    channel.port1.onmessage = () => {
        const now = performance.now();
        longestGapMs = Math.max(longestGapMs, now - lastTurn);
        lastTurn = now;
        if (loop === channel) channel.port2.postMessage(null);
    };
    channel.port2.postMessage(null);
}

/** Stops measuring: the longest task since `watchTasks`, milliseconds. */
export function longestTask(): number {
    loop?.port1.close();
    loop = null;
    return Math.max(longestGapMs, performance.now() - lastTurn);
}

export interface Step {
    /** The longest main-thread task from the command to the preview drawn, milliseconds. */
    longestTaskMs: number;
    /** The command's own run, milliseconds. */
    commandMs: number;
    /** From the command to the overlay's first redraw after it, milliseconds. */
    firstRedrawMs: number;
    /** From the command to the overlay's last redraw of the preview, milliseconds. */
    completeMs: number;
    /** Each overlay redraw in between, milliseconds. */
    redrawMs: number[];
    /** The current stamp after it: width and height. */
    stamp: [number, number];
}

function run(id: string): void {
    const command = appCommands.get(id);
    if (!command?.enabled()) throw new Error(`te-017 stamp preview: ${id} is not enabled`);
    void command.run();
}

/** Runs command `id` and times it, its tasks and the overlay's redraws until the preview is drawn. */
async function step(id: string): Promise<Step> {
    const from = mark();
    watchTasks();
    const start = performance.now();
    run(id);
    const commandMs = performance.now() - start;
    await settled();
    const longestTaskMs = longestTask();
    const redraws = redrawsSince(from);
    const stamp = currentStamp();
    return {
        longestTaskMs,
        commandMs,
        firstRedrawMs: redraws.length > 0 ? redrawStart[from]! - start : 0,
        completeMs: redraws.length > 0 ? redrawEnd[redrawEnd.length - 1]! - start : 0,
        redrawMs: redraws,
        stamp: stamp ? [stamp.width, stamp.height] : [0, 0],
    };
}

/** Select All and Copy: the whole layer in the clipboard (TE-021's commands, not measured). */
export async function copyLayer(): Promise<void> {
    run("select.all");
    run("edit.copy");
    await settled();
}

/** Paste: the clipboard becomes the current stamp. */
export function paste(): Promise<Step> {
    return step("edit.paste");
}

/** Rotate Stamp Right (R). */
export function rotate(): Promise<Step> {
    return step("stamp.rotateRight");
}
