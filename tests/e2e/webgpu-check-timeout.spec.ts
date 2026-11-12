import { expect, test } from "@playwright/test";
import { collectErrors } from "./te-003-support";
import { openApp } from "./support/wait";

// The time limit on the editor's WebGPU check (DESIGN §9, WebGPU required): an adapter request
// that never settles ends, after one retry, on the notice instead of a blank window.

declare global {
    interface Window {
        /** When each adapter request was made, ms since navigation start. */
        __adapterRequests?: number[];
    }
}

test("when the adapter request never settles the WebGPU-required notice shows after a retry", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await page.addInitScript(() => {
        window.__adapterRequests = [];
        Object.defineProperty(Navigator.prototype, "gpu", {
            configurable: true,
            get: () => ({
                requestAdapter: () => {
                    window.__adapterRequests!.push(performance.now());
                    return new Promise<never>(() => undefined);
                },
            }),
        });
    });
    await openApp(page);

    const notice = page.locator('[data-notice="webgpu-required"]');
    // Two 5 s limits; the margin covers a slow start.
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(notice.getByRole("heading", { name: "WebGPU required" })).toBeVisible();
    await expect(notice.locator("[data-notice-reason]")).toHaveAttribute(
        "data-notice-reason",
        "no-adapter",
    );
    await expect(notice).toContainText("WebGPU adapter request timed out");
    await expect(page.locator("[data-region]")).toHaveCount(0);

    // StrictMode runs the check's effect twice in development: each run makes one request,
    // then one retry no earlier than 5 s later.
    const requests = await page.evaluate(() => window.__adapterRequests!);
    expect(requests).toHaveLength(4);
    const [firstA, firstB, retryA, retryB] = requests;
    expect(retryA! - firstA!).toBeGreaterThanOrEqual(4_999);
    expect(retryB! - firstB!).toBeGreaterThanOrEqual(4_999);
    expect(errors).toEqual([]);
});
