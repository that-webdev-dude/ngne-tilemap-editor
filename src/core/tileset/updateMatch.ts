import type { Tile, TileSourceKey } from "../model";
import type { SourceEntry } from "./updateSource";

// The matching of "Update tileset from source" (SPEC §6.3): old tiles to the entries of the
// source re-read, in this order. 1. Unique fingerprint: a fingerprint held by exactly one old
// tile and exactly one entry. 2. Same key: an old tile still unmatched whose source key an
// unmatched entry has, with that entry's pixels. 3. Ambiguous: an old tile whose fingerprint
// appears several times among the unmatched entries, or that it shares with other unmatched old
// tiles; its candidates are the unmatched entries of its fingerprint. 4. Missing: every other
// old tile. 5. The entries left unmatched become new tiles.

/** How a matched tile changes: not at all, its key only, or its pixels. */
export type TileMatchKind = "unchanged" | "moved" | "changed";

/** An old tile matched by step 1 or 2 to entry `entry`. */
export interface TileMatch {
    tileId: number;
    entry: number;
    kind: TileMatchKind;
}

/** An old tile of step 3, with the entries it may take, in source order. */
export interface AmbiguousTile {
    tileId: number;
    candidates: number[];
}

/** The counts the update reports. `new`: entries no old tile matched (steps 1 and 2). */
export interface UpdateSummary {
    unchanged: number;
    moved: number;
    changed: number;
    new: number;
    ambiguous: number;
    missing: number;
}

export interface UpdateMatch {
    /** In the tileset's display order. */
    matched: TileMatch[];
    ambiguous: AmbiguousTile[];
    /** IDs of the missing tiles, in display order. */
    missing: number[];
    /** Entries no old tile matched, in source order. */
    unmatchedEntries: number[];
    summary: UpdateSummary;
}

const keyText = (key: TileSourceKey): string => JSON.stringify(key);

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, number[]> {
    const groups = new Map<string, number[]>();
    items.forEach((item, index) => {
        const key = keyOf(item);
        const group = groups.get(key);
        if (group) group.push(index);
        else groups.set(key, [index]);
    });
    return groups;
}

/** Matches `tiles` (a tileset's, in display order) to `entries` (a source's, in order). */
export function matchTiles(
    tiles: readonly Pick<Tile, "id" | "sourceKey" | "fingerprint">[],
    entries: readonly Pick<SourceEntry, "key" | "fingerprint">[],
): UpdateMatch {
    /** Per old tile (by index), its match; per entry, whether a tile took it. */
    const matches: (TileMatch | undefined)[] = new Array(tiles.length);
    const taken = new Uint8Array(entries.length);
    const take = (t: number, entry: number, kind: TileMatchKind) => {
        matches[t] = { tileId: tiles[t]!.id, entry, kind };
        taken[entry] = 1;
    };
    const sameKey = (t: number, entry: number) => {
        const key = tiles[t]!.sourceKey;
        return key !== null && keyText(key) === keyText(entries[entry]!.key);
    };

    // 1. Unique fingerprint: the pixels are the same; the key may change.
    const oldByFingerprint = groupBy(tiles, (tile) => tile.fingerprint);
    const newByFingerprint = groupBy(entries, (entry) => entry.fingerprint);
    tiles.forEach((tile, t) => {
        const news = newByFingerprint.get(tile.fingerprint);
        if (oldByFingerprint.get(tile.fingerprint)!.length !== 1 || news?.length !== 1) return;
        take(t, news[0]!, sameKey(t, news[0]!) ? "unchanged" : "moved");
    });

    // 2. Same key: the tile takes the entry's pixels.
    const entryByKey = new Map(entries.map((entry, index) => [keyText(entry.key), index]));
    tiles.forEach((tile, t) => {
        if (matches[t] || tile.sourceKey === null) return;
        const entry = entryByKey.get(keyText(tile.sourceKey));
        if (entry === undefined || taken[entry]) return;
        take(t, entry, entries[entry]!.fingerprint === tile.fingerprint ? "unchanged" : "changed");
    });

    // 3 and 4. Ambiguous and missing, against what steps 1 and 2 left.
    const ambiguous: AmbiguousTile[] = [];
    const missing: number[] = [];
    const unmatchedOld = new Map<string, number>();
    tiles.forEach((tile, t) => {
        if (!matches[t])
            unmatchedOld.set(tile.fingerprint, (unmatchedOld.get(tile.fingerprint) ?? 0) + 1);
    });
    tiles.forEach((tile, t) => {
        if (matches[t]) return;
        const candidates = (newByFingerprint.get(tile.fingerprint) ?? []).filter((e) => !taken[e]);
        if (candidates.length > 1 || unmatchedOld.get(tile.fingerprint)! > 1) {
            ambiguous.push({ tileId: tile.id, candidates });
        } else {
            missing.push(tile.id);
        }
    });

    const matched = matches.filter((match) => match !== undefined);
    const unmatchedEntries = entries.flatMap((_, entry) => (taken[entry] ? [] : [entry]));
    const count = (kind: TileMatchKind) => matched.filter((match) => match.kind === kind).length;
    return {
        matched,
        ambiguous,
        missing,
        unmatchedEntries,
        summary: {
            unchanged: count("unchanged"),
            moved: count("moved"),
            changed: count("changed"),
            new: unmatchedEntries.length,
            ambiguous: ambiguous.length,
            missing: missing.length,
        },
    };
}
