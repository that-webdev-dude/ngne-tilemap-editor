import type { Region } from "../../core/model";
import { selectionBoundary } from "../../core/selection";
import type { SelectionBoundary } from "../../core/selection";

// The boundaries the overlay draws from (TE-020), worked out once per mask and shared by the
// draws of a mask's ring: the ants of the selection and of a selection tool's gesture in
// progress (`pendingSelection.ts`). A gesture's result in Replace mode is its very mask
// (`selectionOf` keeps a mask cut to its cells), so the ants find the boundary the gesture's
// preview worked out. Only the masks asked for last are kept — the selection's and a pending
// one's — never one for each mask the history holds.

/** How many masks keep their boundary. */
export const KEPT_BOUNDARIES = 2;

const kept: { mask: Region; boundary: SelectionBoundary }[] = [];

/** The boundary of `mask` (`selectionBoundary`), worked out again only for a mask not kept. */
export function boundaryOf(mask: Region): SelectionBoundary {
    const index = kept.findIndex((entry) => entry.mask === mask);
    if (index >= 0) {
        const [entry] = kept.splice(index, 1);
        kept.unshift(entry!);
        return entry!.boundary;
    }
    const boundary = selectionBoundary(mask);
    kept.unshift({ mask, boundary });
    kept.length = Math.min(kept.length, KEPT_BOUNDARIES);
    return boundary;
}

/** Lets go of the boundary of `mask`, if it is kept. */
export function forgetBoundary(mask: Region): void {
    const index = kept.findIndex((entry) => entry.mask === mask);
    if (index >= 0) kept.splice(index, 1);
}
