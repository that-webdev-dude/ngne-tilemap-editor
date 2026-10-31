import { createServer as createNetServer } from "node:net";
import { chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";

// What a browser benchmark needs (tests/perf/README.md): the app from a Vite dev server in
// installed Chrome, new headless, with the flags of one WebGPU adapter and one device pixel
// ratio; the adapter is checked before anything is measured, and a wrong one fails the run.
// `PERF_GPU` is `intel-uhd`, `rtx-4060` (the reference hardware of ENGINE §6) or `swiftshader`
// (software, no reference). Without it a browser benchmark is skipped.

interface GpuConfig {
    label: string;
    args: string[];
    vendor: string;
    architecture: RegExp;
}

export const GPUS: Record<string, GpuConfig> = {
    "intel-uhd": {
        label: "Intel UHD",
        args: ["--force-low-power-gpu"],
        vendor: "intel",
        architecture: /^gen-12/,
    },
    "rtx-4060": {
        label: "RTX 4060",
        args: ["--force-high-performance-gpu"],
        vendor: "nvidia",
        architecture: /^lovelace$/,
    },
    swiftshader: {
        label: "SwiftShader",
        args: [
            "--use-webgpu-adapter=swiftshader",
            "--enable-unsafe-webgpu",
            "--enable-unsafe-swiftshader",
            ...(process.platform === "win32"
                ? []
                : [
                      "--no-sandbox",
                      "--enable-features=Vulkan",
                      "--use-angle=vulkan",
                      "--use-vulkan=swiftshader",
                      "--disable-vulkan-surface",
                  ]),
        ],
        vendor: "google",
        architecture: /^swiftshader$/,
    },
};

/** The adapter `PERF_GPU` names; undefined without it (the benchmark is skipped). */
export const gpu: GpuConfig | undefined = GPUS[process.env.PERF_GPU ?? ""];

export const WINDOW = { width: 1920, height: 1080 };

export interface BrowserRun {
    page: Page;
    /** The adapter Chrome gave the page, as `vendor architecture`. */
    adapter: string;
    close(): Promise<void>;
}

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createNetServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            server.close(() =>
                typeof address === "object" && address
                    ? resolve(address.port)
                    : reject(new Error("no port")),
            );
        });
    });
}

/**
 * Starts the dev server and Chrome at device pixel ratio `ratio` on the adapter of `PERF_GPU`,
 * opens the app and checks the adapter. Throws when there is no `PERF_GPU` or the adapter is
 * another one.
 */
export async function openApp(ratio: number): Promise<BrowserRun> {
    if (!gpu) throw new Error("PERF_GPU is not set");
    const port = await freePort();
    const server: ViteDevServer = await createServer({
        server: { host: "127.0.0.1", port, strictPort: true },
        logLevel: "error",
    });
    await server.listen();
    let browser: Browser | null = null;
    try {
        browser = await chromium.launch({
            channel: "chrome",
            headless: true,
            args: [
                "--force-color-profile=srgb",
                `--force-device-scale-factor=${ratio}`,
                ...gpu.args,
            ],
        });
        const context = await browser.newContext({
            viewport: WINDOW,
            deviceScaleFactor: ratio,
        });
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${port}/`);
        await page.waitForSelector("html[data-app-ready]");
        const adapter = await page.evaluate(async () => {
            // The DOM library of the pinned TypeScript has no WebGPU types.
            const { gpu } = navigator as unknown as {
                gpu: {
                    requestAdapter(): Promise<{
                        info: { vendor: string; architecture: string };
                    } | null>;
                };
            };
            const adapter = await gpu.requestAdapter();
            return adapter ? `${adapter.info.vendor} ${adapter.info.architecture}`.trim() : "none";
        });
        const [vendor = "", architecture = ""] = adapter.split(" ");
        if (vendor !== gpu.vendor || !gpu.architecture.test(architecture)) {
            throw new Error(
                `PERF_GPU=${process.env.PERF_GPU} but Chrome gave the adapter "${adapter}"`,
            );
        }
        await page.waitForFunction(() => window.__ngneTest?.viewport?.status === "ready");
        const opened = browser;
        return {
            page,
            adapter,
            async close() {
                await opened.close();
                await server.close();
            },
        };
    } catch (error) {
        await browser?.close();
        await server.close();
        throw error;
    }
}
