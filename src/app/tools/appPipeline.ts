import { setKeyContext } from "../keymap/contextState";
import { notices } from "../notices/notices";
import { sessionStore } from "../state/session";
import { statusStore } from "../state/status";
import type { ViewMapping } from "../view/coordinates";
import { isPanHeld } from "../view/panHold";
import { noteStrokeCells } from "../viewport/strokeCells";
import { toolState } from "./activeTool";
import { createToolPipeline } from "./pipeline";
import type { ToolPipeline } from "./pipeline";
import type { Tool } from "./types";

/**
 * Reports a failed stroke as a toast naming its tool, as a failed command is reported: a
 * commit that cannot allocate has put the cells back (SPEC §3), a tool that threw has been
 * cancelled.
 */
export function reportStrokeError(error: unknown, tool: Pick<Tool, "label">): void {
    console.error(`${tool.label} stroke failed:`, error);
    const reason = error instanceof Error ? error.message : String(error);
    notices.error(`${tool.label} failed: ${reason}`);
}

/** Where the pointer pipeline of the app reads the mapping of the map on screen. */
let mappingSource: (() => ViewMapping | null) | null = null;

/**
 * The pointer pipeline of the app (SPEC §4.1), on the app's stores and viewport. The overlay
 * on the page connects it to the pointer (`attachToolPointer`); `tools.commands.ts` cancels
 * its stroke on Escape.
 */
export const toolPipeline: ToolPipeline = createToolPipeline({
    session: sessionStore,
    status: statusStore,
    tools: toolState,
    mapping: () => mappingSource?.() ?? null,
    onError: reportStrokeError,
    later(callback, ms) {
        const timer = setTimeout(callback, ms);
        return () => clearTimeout(timer);
    },
    // While a gesture is open, Enter closes it (DESIGN §10.1, `gesture.commands.ts`).
    gesture: (open) => setKeyContext("gesture", open),
    cellsChanged: noteStrokeCells,
    // A primary drag with Space held pans the view (`view/pointerNavigation.ts`).
    navigating: isPanHeld,
});

/**
 * Makes `source` the mapping the app's pipeline reads: the viewport's, as the map is on
 * screen. Returns the function that disconnects it, which also cancels a stroke in progress.
 */
export function connectToolMapping(source: () => ViewMapping | null): () => void {
    mappingSource = source;
    return () => {
        toolPipeline.cancel();
        if (mappingSource === source) mappingSource = null;
    };
}
