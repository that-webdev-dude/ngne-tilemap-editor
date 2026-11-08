import type { Transaction } from "../history";
import type { TerrainFillResult } from "./filler";

/**
 * Writes a terrain fill's cell patch into an open stroke transaction (SPEC §3) on its own tile
 * layer; invalid cells are not in the patch and stay as they are.
 */
export function applyTerrainFill(transaction: Transaction, result: TerrainFillResult): void {
    for (const { x, y, value } of result.cells) transaction.set(x, y, value);
}
