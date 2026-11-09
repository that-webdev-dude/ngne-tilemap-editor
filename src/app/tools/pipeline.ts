import type { StoreApi } from "zustand/vanilla";
import type { CellRect } from "../../core/cells";
import { touchedNothing } from "../../core/history";
import type { Touched, Transaction } from "../../core/history";
import { findLayer } from "../../core/model";
import type { ProjectSession } from "../../core/model";
import { pointsOnLine } from "../../core/raster/line";
import type { PixelPoint } from "../../core/raster/line";
import { maskHas, tileSelectionOf } from "../../core/selection";
import type { SessionState } from "../state/session";
import type { StatusState } from "../state/status";
import type { ViewMapping } from "../view/coordinates";
import type { ToolState } from "./activeTool";
import { paintableTileLayers, resolvePaintTarget } from "./paintTarget";
import { activeLayerId, activeMap } from "./toolSets";
import type {
    PaintStroke,
    Tool,
    ToolButton,
    ToolContext,
    ToolModifiers,
    ToolPointer,
} from "./types";

// The cell pointer pipeline of the viewport (SPEC §3, §4.1): pointer input on the overlay,
// mapped through the inverse view transform to map pixels and cells, drives the active tool.
// No DOM here: `attachToolPointer` turns pointer and key events into the inputs below, so the
// policy is unit-tested in Node with synthetic sequences.
//
//   pointer down (left or right) → active tool; a paint tool's target resolved (a visible,
//     unlocked tile layer) and its transaction begun → onDown → onMove per sample, each with
//     the cells crossed since the one before (`pointsOnLine`) → onUp → commit (one history
//     entry, or none when nothing changed) → onCommit
//   Escape, pointer cancel, a right click during a left drag, the active map or layer
//     changed → onCancel → abort (cells as before)
//
// One stroke at a time: other pointers are ignored while one is in progress, and the middle
// button is never taken (it pans, TE-014), nor a press while the pan key is held. The tool of
// a stroke is the tool active at its pointer down.
//
// A gesture (DESIGN §10.1, the `gesture` context) is a stroke its tool keeps open past the
// release (`ToolContext.openGesture`):
//
//   first press → onDown … onUp → (open) hover moves → onHover → next press → onDown … onUp
//     → … → Enter, a double click or the tool itself → onClose → commit → onCommit
//   Escape, a pointer cancel during a press, the map or layer left, the active tool changed
//     → onCancel → abort
//
// Cells a stroke writes are shown before it ends: the pipeline reports them (`cellsChanged`)
// after each pointer event, and the cells an abort puts back.

/** `PointerEvent.button` values. */
const LEFT = 0;
const RIGHT = 2;
/** `PointerEvent.buttons` bits of the left and right buttons. */
const PRESSED: Readonly<Record<ToolButton, number>> = { primary: 1, secondary: 2 };
/** How long transient feedback stays in the status bar: as long as a toast. */
export const FEEDBACK_MS = 4000;

/** The fields of a pointer event the pipeline reads. */
export interface PointerInput {
    pointerId: number;
    /** `PointerEvent.button`: 0 left, 1 middle, 2 right; -1 for a move. */
    button: number;
    /** `PointerEvent.buttons`: the buttons held. */
    buttons: number;
    clientX: number;
    clientY: number;
    shiftKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    metaKey: boolean;
    timeStamp: number;
}

/** The fields of a key event the pipeline reads. */
export interface KeyInput {
    type: "down" | "up";
    /** The key as chords name it (`eventKey` of commands/chord.ts); null for none. */
    key: string | null;
    shiftKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    metaKey: boolean;
    repeat: boolean;
}

export interface PipelineSources {
    session: StoreApi<SessionState>;
    status: StoreApi<StatusState>;
    /** The active tool; a gesture ends when it changes (`subscribe`). */
    tools: Pick<ToolState, "active" | "options"> & Partial<Pick<ToolState, "subscribe">>;
    /** The mapping of the active map as it is on screen; null while no viewport is on the page. */
    mapping(): ViewMapping | null;
    /** Calls `callback` after `ms` milliseconds; returns the function that cancels it. */
    later(callback: () => void, ms: number): () => void;
    /**
     * Receives what a tool threw or a transaction refused, with the stroke's tool; the
     * default logs it. A refused commit has put the cells back.
     */
    onError?(error: unknown, tool: Tool): void;
    /** A gesture opened (true) or ended (false): the app switches the `gesture` key context. */
    gesture?(open: boolean): void;
    /**
     * Cells of the active map that a stroke wrote, or that its abort put back, before any
     * history entry tells of them: the viewport draws them.
     */
    cellsChanged?(touched: Touched): void;
    /** A press now belongs to view navigation (the pan key is held): the pipeline leaves it. */
    navigating?(): boolean;
}

export interface ToolPipeline {
    /** True while a stroke is in progress, an open gesture included. */
    readonly stroking: boolean;
    /** The tool of the stroke in progress, or null. */
    readonly strokeTool: Tool | null;
    /** The pointer of the stroke in progress while its button is held, or null. */
    readonly strokePointer: number | null;
    /** The button of the stroke in progress while it is held, or null. */
    readonly strokeButton: ToolButton | null;
    /** True while a gesture is open (`ToolContext.openGesture`). */
    readonly gesture: boolean;
    /** True while a gesture is open between its presses: moves with no button reach it. */
    readonly hovering: boolean;
    /**
     * A button went down over the viewport. Returns true when it began a stroke, a press of
     * the open gesture, or cancelled the stroke (a right click during a left drag): the
     * caller captures the pointer and prevents the event's default.
     */
    down(input: PointerInput): boolean;
    /**
     * The pointer moved: its samples, oldest first (the coalesced events of one event). While
     * `hovering`, the last of them goes to the gesture's tool.
     */
    move(inputs: readonly PointerInput[]): void;
    /** A button came up: the stroke of that pointer ends, or the press of a gesture. */
    up(input: PointerInput): void;
    /**
     * Cancels the stroke in progress (Escape, pointer cancel), an open gesture included.
     * Returns whether there was one.
     */
    cancel(): boolean;
    /**
     * Closes the open gesture and keeps it (Enter, a double click). Returns whether there was
     * one.
     */
    closeGesture(): boolean;
    /** A key went down or up; returns true when the stroke's tool used it. */
    key(input: KeyInput): boolean;
    /** Stops following the stores; a stroke in progress is cancelled. */
    dispose(): void;
}

interface Stroke {
    readonly tool: Tool;
    /** The pointer and the button of the press in progress (of a gesture, its latest). */
    pointerId: number;
    button: ToolButton;
    readonly context: ToolContext;
    readonly session: ProjectSession;
    readonly mapId: string;
    /** The active layer's id at the press, as `activeLayerId` gives it. */
    readonly layerId: number;
    readonly transaction: Transaction | null;
    /** The mapping of the last sample, used while none can be read. */
    mapping: ViewMapping;
    /** The cell of the last sample passed on; null before the press. */
    last: PixelPoint | null;
    /** Cells written since they were last reported to `cellsChanged`. */
    unreported: CellRect | null;
    /** The tool made the stroke a gesture: it stays open past its release. */
    gesture: boolean;
    /** The button of the press is held; false between the presses of a gesture. */
    pressed: boolean;
}

function union(a: CellRect | null, b: CellRect): CellRect {
    if (!a) return b;
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const right = Math.max(a.x + a.width, b.x + b.width);
    const bottom = Math.max(a.y + a.height, b.y + b.height);
    return { x, y, width: right - x, height: bottom - y };
}

function modifiersOf(input: Omit<KeyInput, "type" | "key" | "repeat">): ToolModifiers {
    return {
        shift: input.shiftKey,
        ctrl: input.ctrlKey,
        alt: input.altKey,
        meta: input.metaKey,
    };
}

/**
 * A pointer sample in the coordinates of `mapping`. `last` is the cell of the sample before
 * it in the stroke: the sample carries the cells from there to its own (`ToolPointer.cells`);
 * without one, its own cell.
 */
export function toolPointer(
    input: PointerInput,
    mapping: ViewMapping,
    button: ToolButton,
    last: PixelPoint | null,
): ToolPointer {
    const { clientX: x, clientY: y } = input;
    const device = mapping.clientToDevice(x, y);
    const cell = mapping.deviceToCell(device.x, device.y);
    const cells =
        last === null
            ? [cell]
            : last.x === cell.x && last.y === cell.y
              ? []
              : pointsOnLine(last, cell).slice(1);
    return {
        client: { x, y },
        device,
        position: mapping.deviceToMap(device.x, device.y),
        cell,
        cells,
        inside: mapping.contains(cell),
        button,
        modifiers: modifiersOf(input),
        time: input.timeStamp,
    };
}

export function createToolPipeline(sources: PipelineSources): ToolPipeline {
    const { session: store, status } = sources;
    const onError =
        sources.onError ?? ((error: unknown) => console.error("Tool stroke failed:", error));
    let stroke: Stroke | null = null;
    /** The feedback this pipeline put in the status bar, while it is there. */
    let shown: string | null = null;
    let cancelFeedback: (() => void) | null = null;

    const clearFeedback = () => {
        cancelFeedback?.();
        cancelFeedback = null;
        if (shown !== null && status.getState().feedback === shown) {
            status.getState().setFeedback(null);
        }
        shown = null;
    };

    const showFeedback = (message: string) => {
        clearFeedback();
        shown = message;
        status.getState().setFeedback(message);
        cancelFeedback = sources.later(clearFeedback, FEEDBACK_MS);
    };

    /** Reports `rect` of the layers the stroke wrote to `cellsChanged`. */
    const report = (current: Stroke, rect: CellRect | null) => {
        if (!rect) return;
        const written = current.transaction?.layerIds ?? [];
        try {
            sources.cellsChanged?.({
                ...touchedNothing(current.mapId),
                layerIds: written.length > 0 ? [...written] : [current.layerId],
                cellRects: [rect],
            });
        } catch (error) {
            onError(error, current.tool);
        }
    };

    /** Reports the cells written since the last report. */
    const flush = (current: Stroke) => {
        const rect = current.unreported;
        current.unreported = null;
        report(current, rect);
    };

    /**
     * Ends `ended`, which is no longer the stroke in progress: commits or aborts its cells.
     * Returns what became of them: a history entry, no change, or put back.
     */
    const close = (ended: Stroke, commit: boolean): "recorded" | "unchanged" | "aborted" => {
        const { transaction } = ended;
        ended.unreported = null;
        if (!transaction?.open) return commit ? "unchanged" : "aborted";
        const written = transaction.dirty;
        if (!commit) {
            transaction.abort();
            report(ended, written);
            return "aborted";
        }
        try {
            // The history tells the viewport about the entry it records.
            return transaction.commit(ended.tool.label) !== null ? "recorded" : "unchanged";
        } catch (error) {
            // The commit could not allocate its entry: it put the cells back itself.
            report(ended, written);
            onError(error, ended.tool);
            return "aborted";
        }
    };

    /** `ended` is no longer the stroke in progress; an open gesture ends with it. */
    const release = (ended: Stroke) => {
        if (stroke === ended) stroke = null;
        if (ended.gesture) {
            ended.gesture = false;
            sources.gesture?.(false);
        }
    };

    const cancelStroke = (): boolean => {
        const ended = stroke;
        if (!ended) return false;
        release(ended);
        try {
            ended.tool.onCancel?.(ended.context);
        } catch (error) {
            onError(error, ended.tool);
        }
        close(ended, false);
        return true;
    };

    /** Keeps `ended` as at a release: committed, then `onCommit`. */
    const keep = (ended: Stroke) => {
        release(ended);
        const outcome = close(ended, true);
        if (outcome === "aborted") return;
        try {
            ended.tool.onCommit?.(ended.context, outcome === "recorded");
        } catch (error) {
            onError(error, ended.tool);
        }
    };

    /** Runs a handler of the stroke's tool; a handler that throws cancels the stroke. */
    const run = <Result>(current: Stroke, handler: () => Result): Result | undefined => {
        try {
            return handler();
        } catch (error) {
            onError(error, current.tool);
            if (stroke === current) cancelStroke();
            return undefined;
        }
    };

    /** The pointer of a sample of `current`, which becomes its last cell. */
    const sample = (current: Stroke, input: PointerInput): ToolPointer => {
        const mapping = sources.mapping() ?? current.mapping;
        current.mapping = mapping;
        const pointer = toolPointer(input, mapping, current.button, current.last);
        current.last = pointer.cell;
        return pointer;
    };

    const finish = (current: Stroke, input: PointerInput) => {
        const pointer = sample(current, input);
        let failed = false;
        try {
            current.tool.onUp?.(current.context, pointer);
        } catch (error) {
            failed = true;
            onError(error, current.tool);
        }
        if (stroke !== current) return;
        if (failed) {
            cancelStroke();
            return;
        }
        // A gesture waits for its next press.
        if (current.gesture) {
            current.pressed = false;
            flush(current);
            return;
        }
        keep(current);
    };

    /**
     * The stroke ends with what it works on: another project or history, another active map,
     * another active layer. A change of the view (a wheel zoom during a drag) leaves it.
     */
    const stopSession = store.subscribe((state) => {
        const current = stroke;
        if (!current) return;
        const map = activeMap(state.session);
        const same =
            state.session === current.session &&
            state.history === current.context.history &&
            map?.id === current.mapId &&
            activeLayerId(state.session, map) === current.layerId;
        if (!same) cancelStroke();
    });

    /** A gesture ends when another tool becomes the active one. */
    const stopTools =
        sources.tools.subscribe?.(() => {
            if (stroke?.gesture && sources.tools.active() !== stroke.tool) cancelStroke();
        }) ?? (() => {});

    /** Closes the open gesture `current` and keeps it (Enter, a double click, its tool). */
    const closeOpenGesture = (current: Stroke) => {
        let failed = false;
        try {
            current.tool.onClose?.(current.context);
        } catch (error) {
            failed = true;
            onError(error, current.tool);
        }
        if (stroke !== current) return;
        if (failed) cancelStroke();
        // A press in progress ends with the gesture: its release finds no stroke.
        else keep(current);
    };

    /** A press of the open gesture `current`: its next `onDown`. */
    const pressGesture = (current: Stroke, input: PointerInput, button: ToolButton): boolean => {
        clearFeedback();
        current.pointerId = input.pointerId;
        current.button = button;
        current.pressed = true;
        current.last = null;
        const pointer = sample(current, input);
        run(current, () => current.tool.onDown?.(current.context, pointer));
        if (stroke === current) flush(current);
        return stroke === current;
    };

    /** Begins a stroke of the active tool at `input`; false when none begins. */
    const begin = (input: PointerInput, button: ToolButton): boolean => {
        // A new press over the canvas takes the place of the last refusal's message.
        clearFeedback();
        if (sources.navigating?.()) return false;
        const tool = sources.tools.active();
        const { session, history } = store.getState();
        const map = activeMap(session);
        const mapping = sources.mapping();
        if (!tool || !map || !mapping) return false;
        const layerId = activeLayerId(session, map);

        let transaction: Transaction | null = null;
        const paints = typeof tool.paints === "function" ? tool.paints(button) : tool.paints;
        if (paints) {
            const target = resolvePaintTarget(session);
            if (!target) return false;
            if ("refused" in target) {
                showFeedback(target.refused);
                return false;
            }
            try {
                transaction = history.begin(target);
            } catch (error) {
                onError(error, tool);
                return false;
            }
        }
        const opened = transaction;
        /** The stroke this context is of, once it is made. */
        let own: Stroke | null = null;
        const paintable = opened ? paintableTileLayers(opened.map) : [];
        const writable = new Set(paintable);
        const inMap = (x: number, y: number) =>
            opened !== null && x >= 0 && y >= 0 && x < opened.map.width && y < opened.map.height;
        // The map's tile selection as at the press clips the stroke (SPEC §4.1, Tiled's
        // `TilePainter::paintableRegion`); a selection is a value nobody changes.
        const selection =
            opened && tool.clipsToSelection !== false
                ? tileSelectionOf(session, opened.mapId)
                : null;
        const paint: PaintStroke | null = opened && {
            mapId: opened.mapId,
            layerId: opened.layerId,
            map: opened.map,
            paintableLayers: paintable,
            get(x, y, layer = opened.layerId) {
                if (!inMap(x, y) || !writable.has(layer)) return 0;
                return opened.get(x, y, layer);
            },
            set(x, y, value, layer = opened.layerId) {
                if (!opened.open || !own) return;
                // Painting is clipped to the map and the tile selection (SPEC §4.1), and to the
                // layers a stroke may write.
                if (!inMap(x, y) || !writable.has(layer)) return;
                if (selection && !maskHas(selection, x, y)) return;
                opened.set(x, y, value, layer);
                own.unreported = union(own.unreported, { x, y, width: 1, height: 1 });
            },
        };
        const context: ToolContext = {
            session,
            history,
            map,
            layerId: findLayer(map, layerId) ? layerId : null,
            button,
            options: sources.tools.options(tool),
            paint,
            feedback: showFeedback,
            openGesture() {
                if (!own || stroke !== own || own.gesture) return;
                own.gesture = true;
                sources.gesture?.(true);
            },
            closeGesture() {
                if (!own || stroke !== own || !own.gesture) return;
                closeOpenGesture(own);
            },
        };
        const current: Stroke = {
            tool,
            pointerId: input.pointerId,
            button,
            context,
            session,
            mapId: map.id,
            layerId,
            transaction,
            mapping,
            last: null,
            unreported: null,
            gesture: false,
            pressed: true,
        };
        own = current;
        stroke = current;
        const pointer = sample(current, input);
        run(current, () => tool.onDown?.(context, pointer));
        if (stroke === current) flush(current);
        return stroke === current;
    };

    return {
        get stroking() {
            return stroke !== null;
        },
        get strokeTool() {
            return stroke?.tool ?? null;
        },
        get strokePointer() {
            return stroke?.pressed ? stroke.pointerId : null;
        },
        get strokeButton() {
            return stroke?.pressed ? stroke.button : null;
        },
        get gesture() {
            return stroke?.gesture ?? false;
        },
        get hovering() {
            return stroke !== null && stroke.gesture && !stroke.pressed;
        },

        down(input) {
            const button: ToolButton | null =
                input.button === LEFT ? "primary" : input.button === RIGHT ? "secondary" : null;
            const current = stroke;
            if (current) {
                if (!button) return false;
                // A right click during a left drag aborts the stroke (SPEC §3).
                if (current.pressed && current.button === "primary" && button === "secondary") {
                    return cancelStroke();
                }
                // Between its presses, a press is the open gesture's next one.
                if (!current.gesture || current.pressed) return false;
                return pressGesture(current, input, button);
            }
            return button !== null && begin(input, button);
        },

        move(inputs) {
            const current = stroke;
            if (!current) return;
            // Between the presses of a gesture the pointer hovers: only where it is now
            // matters, so the samples of one event reach `onHover` once, as the last of them.
            if (!current.pressed) {
                const last = inputs[inputs.length - 1];
                if (!last) return;
                const mapping = sources.mapping() ?? current.mapping;
                current.mapping = mapping;
                const pointer = toolPointer(last, mapping, current.button, null);
                run(current, () => current.tool.onHover?.(current.context, pointer));
                if (stroke === current) flush(current);
                return;
            }
            for (const input of inputs) {
                if (stroke !== current) return;
                if (input.pointerId !== current.pointerId) continue;
                // Released with no `pointerup` (another button stayed down): the stroke ends.
                if ((input.buttons & PRESSED[current.button]) === 0) {
                    finish(current, input);
                    return;
                }
                // The right button joined a left drag (a chorded press reports no
                // `pointerdown`): the stroke is aborted (SPEC §3).
                if (current.button === "primary" && (input.buttons & PRESSED.secondary) !== 0) {
                    cancelStroke();
                    return;
                }
                const pointer = sample(current, input);
                run(current, () => current.tool.onMove?.(current.context, pointer));
            }
            if (stroke === current) flush(current);
        },

        up(input) {
            const current = stroke;
            if (!current?.pressed || input.pointerId !== current.pointerId) return;
            // Another button came up while the stroke's own is still held.
            if ((input.buttons & PRESSED[current.button]) !== 0) return;
            finish(current, input);
        },

        cancel: cancelStroke,

        closeGesture() {
            const current = stroke;
            if (!current?.gesture) return false;
            closeOpenGesture(current);
            return true;
        },

        key(input) {
            const current = stroke;
            if (!current?.tool.onKey || input.key === null || input.key === "Escape") return false;
            const used = run(current, () =>
                current.tool.onKey?.(current.context, {
                    type: input.type,
                    key: input.key ?? "",
                    modifiers: modifiersOf(input),
                    repeat: input.repeat,
                }),
            );
            if (stroke === current) flush(current);
            return used === true;
        },

        dispose() {
            stopSession();
            stopTools();
            cancelStroke();
            clearFeedback();
        },
    };
}
