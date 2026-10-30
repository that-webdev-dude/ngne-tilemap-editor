import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { openApp } from "./support/wait";

test("the app starts from the dev server", async ({ page }) => {
    await openApp(page);
    await expect(page).toHaveTitle("NGNE Tilemap Editor");
    await expect(page.locator("#root [data-region]")).toHaveCount(7);
});

test("NGNE 0.3.0 draws a rect on a WebGPU canvas and readCanvas returns its pixels", async ({
    page,
}) => {
    // The engine the dev server resolves `@ngne/core` to.
    const engine = JSON.parse(
        readFileSync(
            new URL("../../node_modules/@ngne/core/package.json", import.meta.url),
            "utf8",
        ),
    ) as { version: string };
    expect(engine.version).toBe("0.3.0");

    await page.goto("/tests/e2e/harness/te-001-smoke.html");
    const output = page.locator("#result");
    await expect(output).not.toBeEmpty();
    const { adapter, ...result } = JSON.parse((await output.textContent()) ?? "{}") as Record<
        string,
        unknown
    >;
    // Hardware locally, SwiftShader in CI; recorded with the result, not asserted.
    test.info().annotations.push({ type: "adapter", description: String(adapter) });
    console.log(`WebGPU adapter: ${String(adapter)}`);

    expect(result).toEqual({
        status: "ready",
        width: 64,
        height: 64,
        inside: [255, 0, 0, 255],
        insideEdge: [255, 0, 0, 255],
        farEdge: [255, 0, 0, 255],
        outsideEdge: [0, 0, 255, 255],
        outsideFarEdge: [0, 0, 255, 255],
        corner: [0, 0, 255, 255],
        errors: [],
    });
});
