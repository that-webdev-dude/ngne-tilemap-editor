import { test } from "@playwright/test";
import type { LaunchOptions } from "@playwright/test";
import { conformanceTests } from "./te-055-cases";

// TE-055: export conformance (SPEC §10.3) at device pixel ratio 1.25, as TE-013's readback:
// this file starts its own Chrome with that scale factor, keeping the configured launch
// arguments and replacing only `--force-device-scale-factor`. Launch options belong to the
// worker, which is why they are set for the whole file.
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

conformanceTests(RATIO);
