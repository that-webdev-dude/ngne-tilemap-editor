import { MAX_SLOT } from "./limits";
import type { Project, Tileset } from "./types";

// Session slots (SPEC §2.2): bits 20..27 of an in-memory cell value name a tileset by its
// slot, 1..255, assigned lowest-free when a project opens or a tileset is added, never
// written to a file.

/** Thrown when every slot 1..255 is taken: the project cannot hold a 256th tileset. */
export class SlotError extends Error {
    override readonly name = "SlotError";
}

/** The lowest slot 1..255 that none of `tilesets` holds. Throws `SlotError` when none is free. */
export function freeSlot(tilesets: readonly Pick<Tileset, "slot">[]): number {
    const taken = new Uint8Array(MAX_SLOT + 1);
    for (const { slot } of tilesets) {
        if (Number.isInteger(slot) && slot >= 1 && slot <= MAX_SLOT) taken[slot] = 1;
    }
    for (let slot = 1; slot <= MAX_SLOT; slot += 1) {
        if (taken[slot] === 0) return slot;
    }
    throw new SlotError(`All ${MAX_SLOT} tileset slots are taken.`);
}

/**
 * Gives every tileset of a freshly opened project a slot: in list order, each the lowest free
 * one. Throws `SlotError` (before changing anything) when the project has more than 255.
 */
export function assignSlots(project: Project): void {
    if (project.tilesets.length > MAX_SLOT) {
        throw new SlotError(
            `A project holds at most ${MAX_SLOT} tilesets, got ${project.tilesets.length}.`,
        );
    }
    project.tilesets.forEach((tileset, index) => {
        tileset.slot = index + 1;
    });
}
