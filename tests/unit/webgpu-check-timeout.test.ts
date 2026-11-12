import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NavigatorLike, WebGpuSupport } from "../../src/ui/platform/webgpu";
import {
    ADAPTER_TIMED_OUT,
    ADAPTER_TIMEOUT_MS,
    checkWebGpu,
} from "../../src/ui/startup/webGpuCheck";

// The time limit on the editor's WebGPU check (DESIGN §9, WebGPU required): 5 s per adapter
// request, one retry, then the notice instead of a blank window.

/** A navigator whose adapter requests answer after `delays[n]` ms (`null`: never). */
function navigatorAnswering(delays: (number | null)[], adapter: object | null = {}) {
    const requestAdapter = vi.fn(() => {
        const delay = delays[requestAdapter.mock.calls.length - 1] ?? null;
        return new Promise<object | null>((resolve) => {
            if (delay !== null) setTimeout(() => resolve(adapter), delay);
        });
    });
    const nav: NavigatorLike = { gpu: { requestAdapter } };
    return { nav, requestAdapter };
}

/** Starts the check and records its answer once it settles. */
function start(nav: NavigatorLike) {
    const state: { result: WebGpuSupport | null } = { result: null };
    void checkWebGpu(nav).then((result) => {
        state.result = result;
    });
    return state;
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("WebGPU check time limit", () => {
    it("ends unsupported with a timeout detail when no adapter request ever settles", async () => {
        const { nav, requestAdapter } = navigatorAnswering([null, null]);
        const check = start(nav);

        await vi.advanceTimersByTimeAsync(ADAPTER_TIMEOUT_MS - 1);
        expect(check.result).toBeNull();
        expect(requestAdapter).toHaveBeenCalledTimes(1);

        // The first limit passes: one retry, still no answer.
        await vi.advanceTimersByTimeAsync(1);
        expect(check.result).toBeNull();
        expect(requestAdapter).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(ADAPTER_TIMEOUT_MS);
        expect(check.result).toEqual({
            status: "unsupported",
            reason: "no-adapter",
            detail: "WebGPU adapter request timed out",
        });
        expect(check.result).toEqual(ADAPTER_TIMED_OUT);
        // No third request.
        await vi.advanceTimersByTimeAsync(ADAPTER_TIMEOUT_MS * 4);
        expect(requestAdapter).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("is supported when a slow adapter request settles within its limit", async () => {
        const { nav, requestAdapter } = navigatorAnswering([ADAPTER_TIMEOUT_MS - 500]);
        const check = start(nav);

        await vi.advanceTimersByTimeAsync(ADAPTER_TIMEOUT_MS - 501);
        expect(check.result).toBeNull();
        await vi.advanceTimersByTimeAsync(1);
        expect(check.result).toEqual({ status: "supported" });
        expect(requestAdapter).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("is supported when the retry settles", async () => {
        const { nav, requestAdapter } = navigatorAnswering([null, 1_000]);
        const check = start(nav);

        await vi.advanceTimersByTimeAsync(ADAPTER_TIMEOUT_MS + 1_000);
        expect(check.result).toEqual({ status: "supported" });
        expect(requestAdapter).toHaveBeenCalledTimes(2);
    });

    it("takes a late answer of the first request while the retry is pending", async () => {
        const { nav, requestAdapter } = navigatorAnswering([ADAPTER_TIMEOUT_MS + 2_000, null]);
        const check = start(nav);

        await vi.advanceTimersByTimeAsync(ADAPTER_TIMEOUT_MS + 1_999);
        expect(check.result).toBeNull();
        await vi.advanceTimersByTimeAsync(1);
        expect(check.result).toEqual({ status: "supported" });
        expect(requestAdapter).toHaveBeenCalledTimes(2);
    });

    it("passes a settled answer through unchanged", async () => {
        const noAdapter = start(navigatorAnswering([0], null).nav);
        const noApi = start({});
        const rejected = start({
            gpu: { requestAdapter: () => Promise.reject(new Error("adapter request blocked")) },
        });

        await vi.advanceTimersByTimeAsync(0);
        expect(noAdapter.result).toEqual({ status: "unsupported", reason: "no-adapter" });
        expect(noApi.result).toEqual({ status: "unsupported", reason: "no-api" });
        expect(rejected.result).toEqual({
            status: "unsupported",
            reason: "no-adapter",
            detail: "Error: adapter request blocked",
        });
    });
});
