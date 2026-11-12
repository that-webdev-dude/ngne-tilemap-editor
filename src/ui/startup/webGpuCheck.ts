import { useEffect, useState } from "react";
import { detectWebGpu, initialWebGpuSupport } from "../platform/webgpu";
import type { NavigatorLike, WebGpuSupport } from "../platform/webgpu";

// The WebGPU gate of the editor with a time limit (DESIGN §9, WebGPU required). The browser's
// `requestAdapter()` can stay pending for good; without a limit the editor would show nothing.
// `platform/webgpu.ts` is a verbatim copy from the sprite editor, so the limit wraps it here.

/** How long one adapter request may take before it is retried or given up. */
export const ADAPTER_TIMEOUT_MS = 5_000;
/** Adapter requests made before the check gives up: the first and one retry. */
export const ADAPTER_ATTEMPTS = 2;

export const ADAPTER_TIMED_OUT: WebGpuSupport = {
    status: "unsupported",
    reason: "no-adapter",
    detail: "WebGPU adapter request timed out",
};

export interface CheckLimits {
    timeoutMs?: number;
    attempts?: number;
}

const PENDING = Symbol("pending");

/** `promise`'s value, or `PENDING` once `ms` have passed without one. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | typeof PENDING> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<typeof PENDING>((resolve) => {
        timer = setTimeout(() => resolve(PENDING), ms);
    });
    return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

/**
 * `detectWebGpu` with a time limit per adapter request. A request still pending at its limit is
 * retried; an earlier request that answers late still counts. When none has answered after the
 * last attempt, WebGPU counts as unsupported. Never rejects.
 */
export async function checkWebGpu(
    nav: NavigatorLike,
    { timeoutMs = ADAPTER_TIMEOUT_MS, attempts = ADAPTER_ATTEMPTS }: CheckLimits = {},
): Promise<WebGpuSupport> {
    const requests: Promise<WebGpuSupport>[] = [];
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        requests.push(detectWebGpu(nav));
        const result = await within(Promise.race(requests), timeoutMs);
        if (result !== PENDING) return result;
    }
    return ADAPTER_TIMED_OUT;
}

/** The editor's WebGPU support: `useWebGpuSupport` of `platform/webgpu.ts` with the time limit. */
export function useWebGpuCheck(): WebGpuSupport {
    const [support, setSupport] = useState<WebGpuSupport>(() =>
        initialWebGpuSupport(navigator as NavigatorLike),
    );
    useEffect(() => {
        let live = true;
        void checkWebGpu(navigator as NavigatorLike).then((result) => {
            if (live) setSupport(result);
        });
        return () => {
            live = false;
        };
    }, []);
    return support;
}
