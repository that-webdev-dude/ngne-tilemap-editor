// The error of the `ngne-tilemap` reader (FORMAT §3.8). One implementation: it lives in the
// runtime that games carry (`core/runtime/runtime.ts`), and the editor uses the same.

export { TilemapError } from "../runtime/runtime";
export type { TilemapErrorCode } from "../runtime/runtime";
