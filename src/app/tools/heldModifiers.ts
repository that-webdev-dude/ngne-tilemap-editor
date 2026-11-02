import type { ToolModifiers } from "./types";

// The modifier keys held now, for previews that change with them between strokes (the stamp
// brush's line and ellipse, SPEC §4.3): followed from key and pointer events on the window
// while anything subscribes, and cleared when the window loses focus.

const NONE: Readonly<ToolModifiers> = { shift: false, ctrl: false, alt: false, meta: false };

let held: Readonly<ToolModifiers> = NONE;
const listeners = new Set<() => void>();

/** The modifier keys held now (none while nothing subscribes). */
export function heldModifiers(): Readonly<ToolModifiers> {
    return held;
}

function take(next: Readonly<ToolModifiers>): void {
    const same =
        next.shift === held.shift &&
        next.ctrl === held.ctrl &&
        next.alt === held.alt &&
        next.meta === held.meta;
    if (same) return;
    held = next;
    for (const listener of [...listeners]) listener();
}

const onEvent = (event: KeyboardEvent | PointerEvent) =>
    take({ shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey });
const onBlur = () => take(NONE);

/** Calls `listener` when the held modifiers change; returns the function that stops it. */
export function subscribeHeldModifiers(listener: () => void): () => void {
    if (listeners.size === 0) {
        window.addEventListener("keydown", onEvent, true);
        window.addEventListener("keyup", onEvent, true);
        window.addEventListener("pointermove", onEvent, true);
        window.addEventListener("pointerdown", onEvent, true);
        window.addEventListener("blur", onBlur);
    }
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        window.removeEventListener("keydown", onEvent, true);
        window.removeEventListener("keyup", onEvent, true);
        window.removeEventListener("pointermove", onEvent, true);
        window.removeEventListener("pointerdown", onEvent, true);
        window.removeEventListener("blur", onBlur);
        held = NONE;
    };
}
