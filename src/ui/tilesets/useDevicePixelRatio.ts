import { useSyncExternalStore } from "react";

// `window.devicePixelRatio` as React state. The ratio changes when the window moves to another
// screen or the browser zoom changes; the only event for it is the media query on the ratio
// the page has now, which stops matching when it changes, so each change listens anew.

function subscribe(notify: () => void): () => void {
    let query = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onChange = () => {
        query.removeEventListener("change", onChange);
        query = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
        query.addEventListener("change", onChange);
        notify();
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
}

/** The page's device pixels per CSS pixel, now and after every change. */
export function useDevicePixelRatio(): number {
    return useSyncExternalStore(subscribe, () => window.devicePixelRatio);
}
