import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { installDeviceToolkit } from "./te-013-devices";
import { framesOf, loadScene, openEditor } from "./te-013-support";
import { afterFrames } from "./support/wait";

// The viewport's frames-in-flight budget (ENGINE §4, §6): it waits on `submittedWorkDone()` for
// each frame it submits and, with 2 frames unfinished, holds a redraw until one finishes. The
// GPU's completion is held in the page (`GPUQueue.onSubmittedWorkDone`, which NGNE's wait
// relies on), so the frames stay unfinished as long as a test needs.

interface GpuHold {
    /** From now on, completions are held until `release`. */
    hold(): void;
    /** Lets every held completion through and stops holding. */
    release(): void;
    /** Unhandled promise rejections of the page. */
    rejections: string[];
}

declare global {
    interface Window {
        __gpuHold: GpuHold;
    }
}

/** Runs in the page before its scripts. Self-contained: it is sent as source text. */
function installGpuHold(): void {
    interface Queue {
        onSubmittedWorkDone(this: Queue): Promise<void>;
    }
    const prototype = (globalThis as unknown as { GPUQueue?: { prototype: Queue } }).GPUQueue
        ?.prototype;
    let holding = false;
    const held: (() => void)[] = [];
    const rejections: string[] = [];
    if (prototype) {
        const original = prototype.onSubmittedWorkDone;
        prototype.onSubmittedWorkDone = function (this: Queue) {
            const work = original.call(this);
            if (!holding) return work;
            return new Promise<void>((resolve, reject) => {
                held.push(() => void work.then(resolve, reject));
            });
        };
    }
    window.addEventListener("unhandledrejection", (event) => {
        rejections.push(String(event.reason));
    });
    window.__gpuHold = {
        hold() {
            holding = true;
        },
        release() {
            holding = false;
            for (const letGo of held.splice(0)) letGo();
        },
        rejections,
    };
}

const BUDGET = 2;
const VIEW = { zoom: 1, background: 0x203040ff, originX: 37, originY: 23 };

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installDeviceToolkit);
    await page.addInitScript(installGpuHold);
});

const inFlight = (page: Page) =>
    page.evaluate(() => window.__ngneTest!.viewport!.stats.framesInFlight);

/** Opens the scene and waits until no frame is asked for or unfinished. */
async function settledScene(page: Page): Promise<void> {
    await openEditor(page);
    await loadScene(page, VIEW);
    let last = -1;
    await expect
        .poll(async () => {
            const now = await framesOf(page);
            const stable = now === last && (await inFlight(page)) === 0;
            last = now;
            return stable;
        })
        .toBe(true);
}

/** Changes the view's zoom in place and tells the store, one change per animation frame. */
async function zoomSteps(page: Page, zooms: number[]): Promise<void> {
    for (const zoom of zooms) {
        await page.evaluate((zoom) => {
            const store = window.__ngneTest!.session.getState();
            const session = store.session;
            session.perMap.get(session.activeMapId)!.view.zoom = zoom;
            store.touch();
        }, zoom);
        await afterFrames(page, 2);
    }
}

test("the viewport holds redraws at 2 frames in flight and then draws the latest view once", async ({
    page,
}) => {
    await settledScene(page);
    const before = await framesOf(page);
    await page.evaluate(() => window.__gpuHold.hold());

    // Six changes, each in an animation frame of its own; the GPU finishes none of the frames.
    await zoomSteps(page, [1.5, 2, 3, 4, 6, 8]);
    expect(await framesOf(page)).toBe(before + BUDGET);
    expect(await inFlight(page)).toBe(BUDGET);
    await afterFrames(page, 4);
    expect(await framesOf(page)).toBe(before + BUDGET);

    // Once the GPU finishes, the held redraw runs once, with the view as it is now: no frame is
    // queued per change.
    await page.evaluate(() => window.__gpuHold.release());
    await framesPast(page, before + BUDGET);
    await expect.poll(() => inFlight(page)).toBe(0);
    await afterFrames(page, 4);
    expect(await framesOf(page)).toBe(before + BUDGET + 1);
    const drawn = await page.evaluate(() => {
        const probe = window.__ngneTest!.viewport!;
        const held = probe.stats.sprites;
        probe.renderNow();
        return { held, latest: probe.stats.sprites };
    });
    expect(drawn.held).toBe(drawn.latest);
    expect(await page.evaluate(() => window.__gpuHold.rejections)).toEqual([]);
});

/**
 * Opens the settled scene, holds the GPU and makes three changes: the viewport submits the budget
 * and has that many frames in flight. Returns the frames submitted before the changes.
 */
async function framesHeldAtBudget(page: Page): Promise<number> {
    await settledScene(page);
    const before = await framesOf(page);
    await page.evaluate(() => window.__gpuHold.hold());
    await zoomSteps(page, [1.5, 2, 3]);
    expect(await framesOf(page)).toBe(before + BUDGET);
    expect(await inFlight(page)).toBe(BUDGET);
    return before;
}

/** Waits until the viewport has submitted more than `frames` frames. */
function framesPast(page: Page, frames: number) {
    return page.waitForFunction((n) => window.__ngneTest!.viewport!.stats.frames > n, frames);
}

test("a device lost with frames in flight settles them and the viewport draws again", async ({
    page,
}) => {
    const before = await framesHeldAtBudget(page);

    // NGNE settles the waits of a lost device itself; the queue's completions stay held.
    await page.evaluate(() => window.__te013Devices.loseDevice());
    await page.waitForFunction(() => window.__ngneTest!.viewport!.status === "ready");
    await framesPast(page, before + BUDGET);
    await page.evaluate(() => window.__gpuHold.release());
    await expect.poll(() => inFlight(page)).toBe(0);

    // No redraw is stuck: a change draws.
    const after = await framesOf(page);
    await zoomSteps(page, [1]);
    await framesPast(page, after);
    expect(await page.evaluate(() => window.__gpuHold.rejections)).toEqual([]);
});

test("disposing a viewport with frames in flight leaves no unhandled rejection", async ({
    page,
}) => {
    await framesHeldAtBudget(page);

    // Closing the project unmounts the viewport, whose renderer rejects the pending waits.
    await page.evaluate(() => window.__ngneTest!.session.getState().close());
    await page.waitForFunction(() => window.__ngneTest!.viewport === null);
    await afterFrames(page, 4);
    await page.evaluate(() => window.__gpuHold.release());
    await afterFrames(page, 4);
    expect(await page.evaluate(() => window.__gpuHold.rejections)).toEqual([]);
});
