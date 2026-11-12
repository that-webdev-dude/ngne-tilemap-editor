# Benchmarks

The benchmarks of the budgets in ENGINE §6 and SPEC §14, one file per ticket
(`te-0xx-*.perf.ts`). They are measured and recorded, not asserted: `npm run check` does not
run them. Which numbers count: RULES 8; the records are written under `docs/evidence/`.

## Running

- One benchmark at a time, with nothing else loading the machine: no E2E run, no other
  benchmark, no agent.
- `npx vitest run --config vitest.perf.config.ts --silent=false tests/perf/<file>` runs one;
  every result is printed (`record.ts`). Vitest hides the console of a passing test without
  `--silent=false`; the record is written either way.
- `PERF_GPU` selects the WebGPU adapter of a browser benchmark: `intel-uhd` or `rtx-4060` (the
  reference hardware of ENGINE §6) or `swiftshader` (software, no reference). The adapter is
  checked before anything is measured: a wrong one fails the run. Without `PERF_GPU` a browser
  benchmark is skipped.
- `PERF_RECORD=1` writes the record to `docs/evidence/<id>.json`, with the environment and the
  date. Only the orchestrator sets it, on reference hardware.
- `PERF_ID=<id>` names the record of this one run: it is printed and written under `<id>`
  instead of the benchmark's own id, which the record keeps as `benchmarkId`. A run on other
  hardware is recorded this way beside the reference records, for example
  `te-017-paint-cloud-swiftshader`. A process records once under a `PERF_ID`.

- `PERF_SUFFIX=<gpu>` names every record of a process `<id>-<gpu>`, keeping the benchmark's
  id as `benchmarkId`, so a benchmark that records several results is recorded per GPU. It
  cannot be combined with `PERF_ID`.
- `PERF_ENV` adds a JSON object of facts about the machine to each record's environment;
  `PERF_OUT=<directory>` writes the records there instead of `docs/evidence`.

## Recording the reference rows

`node tests/perf/te-064-record-all.ts` runs every benchmark behind a row of ENGINE §6 and
SPEC §14 on both reference GPUs, one process at a time, and writes
`docs/evidence/<id>-<gpu>.json`, replacing the record before. It reads Chrome's version, the
power plan and mode, AC power and the display's refresh rate once and adds them to every record.
`--gpu <gpu>` limits it to one GPU; arguments name the benchmarks to run (part of the file
name). Run it with nothing else loading the machine. `te-011-emit` and `cleanup-pan-selection`
back no row and are not part of it.

The Perf workflow (`.github/workflows/perf.yml`) runs every benchmark on SwiftShader on each push,
report-only, and keeps the records as an artifact.

Browser benchmarks start installed Chrome with `--force-color-profile=srgb`, the adapter's
flags and a device pixel ratio of 1, in a 1920 × 1080 window.
