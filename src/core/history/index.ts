// Commands, transactions and the undo history of SPEC §3. A project changes only through its
// `History`: `execute(command)` for a command, `begin(target)` for a tool stroke.

export type { Allocator } from "./allocate";
export { defaultAllocator } from "./allocate";
export {
    BYTES_PER_PATCHED_CELL,
    CELL_PATCH_OVERHEAD_BYTES,
    CELL_PATCH_WORDS,
    cellPatchCommand,
    tileLayerCells,
} from "./cellPatch";
export type { CellPatch } from "./cellPatch";
export { compositeCommand, mergeTouched, touchedNothing } from "./command";
export type { Command, Touched } from "./command";
export { AllocationError, TransactionError } from "./errors";
export { DEFAULT_HISTORY_BUDGET_BYTES, History } from "./history";
export type {
    HistoryChange,
    HistoryListener,
    HistoryOptions,
    MemoryWarningListener,
    ProjectVerifier,
} from "./history";
export type { Transaction, TransactionOptions } from "./transaction";
