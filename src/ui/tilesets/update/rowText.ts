// The status line of a row of the Update Tileset from Source dialog (SPEC §6.3, DESIGN §9,
// TE-028). Pure, so it unit-tests without React.

export interface RowStatus {
    status: "ambiguous" | "missing";
    candidates: readonly number[];
}

/** What the row says about its tile: how many source tiles match it, or that none does. */
export function rowStatusText(row: RowStatus): string {
    if (row.status !== "ambiguous") return "Missing from the source";
    const count = row.candidates.length;
    if (count === 0) return "Ambiguous: shares its picture with other tiles";
    return count === 1
        ? "Ambiguous: 1 source tile matches"
        : `Ambiguous: ${count} source tiles match`;
}
