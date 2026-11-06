import type { History } from "../../core/history";
import type { CommandSpec } from "../commands/types";
import { showMapOfStep } from "../tabs/tabs";
import { activeHistory } from "./session";

/**
 * The history when undo and redo may use it. While a transaction is open (a stroke) they would
 * throw, and `canUndo` still reads true, so that is checked first.
 */
function idleHistory(): History | null {
    const history = activeHistory();
    return history.transaction ? null : history;
}

/**
 * Undoes (`"undo"`) or redoes the next step. A step for a map other than the active one first
 * shows that map's tab, so a change is never undone out of sight (SPEC §3).
 */
function step(kind: "undo" | "redo"): void {
    const history = idleHistory();
    if (!history) return;
    if (!showMapOfStep(kind === "undo" ? history.undoMapId : history.redoMapId)) return;
    if (kind === "undo") history.undo();
    else history.redo();
}

/** "Undo Stamp Brush": the verb, then the label of the step it would act on. */
function titled(verb: string, label: string | null | undefined): string {
    return label ? `${verb} ${label}` : verb;
}

// DESIGN §10.3: Ctrl+Z; Ctrl+Y, Ctrl+Shift+Z. Not bound in `text`: a field undoes its own
// typing. Group 1 of the Edit menu (DESIGN §5).
export const commands: CommandSpec[] = [
    {
        id: "edit.undo",
        title: () => titled("Undo", activeHistory().undoLabel),
        shortcut: "Ctrl+Z",
        menuPath: ["Edit"],
        menuOrder: 100,
        enabled: () => idleHistory()?.canUndo ?? false,
        run: () => step("undo"),
    },
    {
        id: "edit.redo",
        title: () => titled("Redo", activeHistory().redoLabel),
        shortcut: ["Ctrl+Y", "Ctrl+Shift+Z"],
        menuPath: ["Edit"],
        menuOrder: 110,
        enabled: () => idleHistory()?.canRedo ?? false,
        run: () => step("redo"),
    },
];
