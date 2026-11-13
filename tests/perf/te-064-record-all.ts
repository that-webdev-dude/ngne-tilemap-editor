import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// TE-064: records every benchmark behind a row of ENGINE §6 and SPEC §14 on both reference GPUs
// (RULES 8), one benchmark process at a time, with PERF_RECORD=1 and PERF_SUFFIX=<gpu>: each
// record is written to docs/evidence/<benchmark id>-<gpu>.json, replacing the one before. The
// machine's facts that ENGINE §6 asks for (Chrome, power plan and mode, AC, refresh rate) are
// read once and added to every record's environment (PERF_ENV). Run it alone, with nothing else
// loading the machine (tests/perf/README.md):
//
//     node tests/perf/te-064-record-all.ts                      every benchmark, both GPUs
//     node tests/perf/te-064-record-all.ts --gpu rtx-4060       one GPU
//     node tests/perf/te-064-record-all.ts te-013 te-064-idle   the files whose names hold these
//
// It prints a summary and exits non-zero when a benchmark failed. Records older than the run
// that were not replaced are listed at the end: they belong to no current benchmark.

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const EVIDENCE = fileURLToPath(new URL("../../docs/evidence/", import.meta.url));

/** The benchmarks behind the rows, in the order of ENGINE §6 and SPEC §14. */
const BENCHMARKS = [
    "te-013-pan",
    "te-017-paint",
    "te-015-chunk",
    "te-031-tab-switch",
    "te-068-frames-in-flight",
    "te-064-idle",
    "te-064-cold-load",
    "te-055-runtime",
    "te-019-bucket",
    "te-020-wand",
    "te-017-stamp-preview",
    "te-044-brush",
    "te-047-save-open",
    "te-048-autosave",
    "te-053-export",
    "te-028-update",
    "te-037-markers",
];

const REFERENCE_GPUS = ["intel-uhd", "rtx-4060"];

/** Windows' built-in power plans by scheme GUID. */
const POWER_PLANS: Record<string, string> = {
    "381b4222-f694-41f0-9685-ff5bb260df2e": "Balanced",
    "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c": "High performance",
    "a1841308-3541-4fab-bc81-f71556f20b4a": "Power saver",
    "e9a42b02-d5df-448d-aa00-03f14749eb61": "Ultimate Performance",
};

/** Power scheme names of Windows' power mode overlays (the "Power mode" setting). */
const POWER_MODES: Record<string, string> = {
    "961cc777-2547-4f9d-8174-7d86181b8a7a": "Best power efficiency",
    "00000000-0000-0000-0000-000000000000": "Balanced",
    "ded574b5-45a0-4f42-8737-46345c09c238": "Best performance",
};

/** Windows PowerShell at its fixed place under the Windows directory, not looked up in PATH. */
const POWERSHELL = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;

function powershell(command: string): string {
    const result = spawnSync(POWERSHELL, ["-NoProfile", "-Command", command], {
        encoding: "utf8",
    });
    return result.status === 0 ? result.stdout.trim() : "";
}

/** What ENGINE §6 asks every measurement to record beside the CPU. */
async function machine(): Promise<Record<string, unknown>> {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    const chrome = browser.version();
    await browser.close();
    if (process.platform !== "win32") return { chrome };
    // The scheme's GUID names the built-in plans in any display language; others by their name.
    const scheme = powershell("powercfg /getactivescheme");
    const guid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(scheme)?.[0];
    const plan =
        POWER_PLANS[guid?.toLowerCase() ?? ""] ?? /\(([^)]+)\)\s*$/.exec(scheme)?.[1] ?? "unknown";
    const overlay = powershell(
        "(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power\\User\\PowerSchemes').ActiveOverlayAcPowerScheme",
    );
    // Win32_Battery.BatteryStatus 2: the system has access to AC power.
    const battery = powershell("(Get-CimInstance Win32_Battery).BatteryStatus");
    const displays = powershell(
        'Get-CimInstance Win32_VideoController | Where-Object { $_.CurrentRefreshRate } | ForEach-Object { "$($_.Name): $($_.CurrentHorizontalResolution)x$($_.CurrentVerticalResolution) at $($_.CurrentRefreshRate) Hz" }',
    );
    return {
        chrome,
        powerPlan: plan,
        powerMode: POWER_MODES[overlay] ?? (overlay || "unknown"),
        power: battery === "" ? "unknown" : battery === "2" ? "AC" : "battery",
        displays: displays.split(/\r?\n/).filter((line) => line !== ""),
    };
}

function options(argv: string[]): { gpus: string[]; files: string[] } {
    const gpus: string[] = [];
    const filters: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--gpu") gpus.push(argv[++i] ?? "");
        else filters.push(argv[i]!);
    }
    for (const gpu of gpus) {
        if (!REFERENCE_GPUS.includes(gpu)) throw new Error(`--gpu ${gpu}: not a reference GPU`);
    }
    const files = BENCHMARKS.filter(
        (file) => filters.length === 0 || filters.some((filter) => file.includes(filter)),
    );
    if (files.length === 0) throw new Error(`No benchmark matches ${filters.join(", ")}`);
    return { gpus: gpus.length > 0 ? gpus : REFERENCE_GPUS, files };
}

/** Records under docs/evidence written before `since` (ISO date). */
function olderRecords(since: string): string[] {
    return readdirSync(EVIDENCE)
        .filter((name) => name.endsWith(".json"))
        .filter((name) => {
            const date: unknown = JSON.parse(readFileSync(`${EVIDENCE}${name}`, "utf8")).date;
            return typeof date === "string" && date < since;
        });
}

async function main(): Promise<void> {
    const { gpus, files } = options(process.argv.slice(2));
    const facts = await machine();
    console.log(`Machine: ${JSON.stringify(facts)}`);
    const started = new Date().toISOString();
    const results: { gpu: string; file: string; ok: boolean; seconds: number }[] = [];
    for (const gpu of gpus) {
        for (const file of files) {
            console.log(`\n=== ${file} on ${gpu}`);
            const start = Date.now();
            // One command line of fixed words and a file name from BENCHMARKS: nothing to escape.
            const run = spawnSync(
                `npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/${file}.perf.ts`,
                {
                    cwd: ROOT,
                    stdio: "inherit",
                    shell: true,
                    env: {
                        ...process.env,
                        PERF_GPU: gpu,
                        PERF_RECORD: "1",
                        PERF_SUFFIX: gpu,
                        PERF_ENV: JSON.stringify(facts),
                        PERF_ID: "",
                        PERF_OUT: "",
                    },
                },
            );
            results.push({
                gpu,
                file,
                ok: run.status === 0,
                seconds: Math.round((Date.now() - start) / 1000),
            });
        }
    }
    console.log("\nSummary:");
    for (const { gpu, file, ok, seconds } of results) {
        console.log(`  ${ok ? "ok    " : "FAILED"} ${gpu.padEnd(9)} ${file} (${seconds} s)`);
    }
    if (gpus.length === REFERENCE_GPUS.length && files.length === BENCHMARKS.length) {
        const older = olderRecords(started);
        if (older.length > 0)
            console.log(`\nRecords this run did not replace:\n  ${older.join("\n  ")}`);
    }
    if (results.some(({ ok }) => !ok)) process.exitCode = 1;
}

await main();
