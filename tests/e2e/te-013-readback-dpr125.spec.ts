import { test } from "@playwright/test";
import type { LaunchOptions } from "@playwright/test";
import { readbackTests } from "./te-013-readback-cases";

// TE-013: viewport readback at device pixel ratio 1.25.
//
// `devicePixelContentBoxSize`, which sizes the canvas, follows the browser's own scale factor
// and not the emulated one. So this file starts its own Chrome with that scale factor: the
// configured launch arguments are kept and only `--force-device-scale-factor` is replaced.
// Launch options belong to the worker, which is why they are set for the whole file.
const RATIO = 1.25;

test.use({
    deviceScaleFactor: RATIO,
    launchOptions: [
        async (
            { launchOptions }: { launchOptions: LaunchOptions },
            use: (options: LaunchOptions) => Promise<void>,
        ) => {
            const kept = (launchOptions.args ?? []).filter(
                (argument) => !argument.startsWith("--force-device-scale-factor"),
            );
            await use({
                ...launchOptions,
                args: [...kept, `--force-device-scale-factor=${RATIO}`],
            });
        },
        { scope: "worker" },
    ],
});

readbackTests(RATIO);
