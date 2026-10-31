import { createStore } from "zustand/vanilla";
import type { DeviceSize } from "../../engine/viewport/geometry";

// The size of the viewport in device pixels, as view navigation needs it (TE-014). The
// viewport host reports it from its `ResizeObserver`, the same measurement that sizes the NGNE
// canvas and the overlay canvas, so the pan limits and the mapping refer to the pixels on
// screen.

const NO_SIZE: DeviceSize = { width: 0, height: 0 };

export interface ViewportSize {
    /** The viewport in device pixels; 0 × 0 while none is mounted or it is not laid out. */
    readonly size: DeviceSize;
    /** The viewport has this size now. */
    report(size: DeviceSize): void;
    /**
     * Calls `listener` after a size was reported, in a task of its own and once for all the
     * reports of one task. Returns the function that stops it.
     *
     * Sizes are reported from inside the delivery of a `ResizeObserver`. A listener that
     * changes a store there makes React render there, together with whatever another observer
     * of that delivery has queued: elements change size while sizes are being delivered, and
     * the browser reports a "ResizeObserver loop" error. `size` itself is current at once.
     */
    subscribe(listener: () => void): () => void;
}

export function createViewportSize(): ViewportSize {
    const store = createStore<{ size: DeviceSize }>(() => ({ size: NO_SIZE }));
    return {
        get size() {
            return store.getState().size;
        },
        report(size) {
            const now = store.getState().size;
            if (size.width === now.width && size.height === now.height) return;
            store.setState({ size: { width: size.width, height: size.height } });
        },
        subscribe(listener) {
            let pending: ReturnType<typeof setTimeout> | undefined;
            const stop = store.subscribe(() => {
                pending ??= setTimeout(() => {
                    pending = undefined;
                    listener();
                }, 0);
            });
            return () => {
                stop();
                clearTimeout(pending);
                pending = undefined;
            };
        },
    };
}

/** The viewport size of the app. */
export const viewportSize = createViewportSize();

export function hasSize(size: DeviceSize): boolean {
    return size.width > 0 && size.height > 0;
}
