import { createStore } from "zustand/vanilla";

// Whether the pan key (Space, held) is down: while it is, a drag with the primary button pans
// the view like a middle-button drag (DESIGN §10.3 "Space (hold)"). Set by `view.commands.ts`,
// read by `pointerNavigation.ts`.

export const panHold = createStore<{ held: boolean }>(() => ({ held: false }));

export function setPanHeld(held: boolean): void {
    if (panHold.getState().held !== held) panHold.setState({ held });
}

export function isPanHeld(): boolean {
    return panHold.getState().held;
}
