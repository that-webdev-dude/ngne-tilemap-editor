// TE-001 page for the shared wait helpers (tests/e2e/support/wait.ts): a frame loop that
// counts the frames it "submits", and an element that grows over several frames, then keeps
// its final size. Both start when a test calls them.

declare global {
    interface Window {
        te001: { frames: number; submit(frames: number): void; grow(): void };
    }
}

const growing = document.querySelector<HTMLElement>("#growing");
if (!growing) throw new Error("Missing #growing");

window.te001 = {
    frames: 0,
    /** Counts `frames` frames, one per animation frame. */
    submit(frames) {
        let left = frames;
        const tick = () => {
            window.te001.frames += 1;
            if (--left > 0) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    },
    /** Grows the element from 10 × 10 to 100 × 60 px, one step per animation frame. */
    grow() {
        let step = 1;
        const next = () => {
            step += 1;
            growing.style.width = `${step * 10}px`;
            growing.style.height = `${step * 6}px`;
            if (step < 10) requestAnimationFrame(next);
        };
        requestAnimationFrame(next);
    },
};

export {};
