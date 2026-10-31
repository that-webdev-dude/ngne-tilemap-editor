import type { PackFn } from "../../engine/viewport";
import { backgroundWorker } from "../worker/client";
// The task type, so that `run("pack.tileset")` is typed outside the worker's own glob.
import type {} from "../worker/tasks/pack.task";

/** Packs a tileset in the background worker (SPEC §10.2); the viewport uploads the result. */
export const packInWorker: PackFn = (tileset, signal) =>
    backgroundWorker.run("pack.tileset", { tileset }, { signal });
