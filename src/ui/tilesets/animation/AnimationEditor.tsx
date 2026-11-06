import { GripVertical, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { usePreference } from "../../../app/preferences/preferences";
import { useSession } from "../../../app/state/session";
import {
    animatedTile,
    applyAnimation,
    setFrameDuration,
    useFrameDuration,
} from "../../../app/tilesets/animation/animationEditor";
import type { AnimationEditorRequest } from "../../../app/tilesets/animation/animationEditor";
import {
    gridLayout,
    gridPointAt,
    shownTile,
    spanGridRect,
    tileOrigin,
} from "../../../app/tilesets/panel/tileGrid";
import type { GridLayout, GridPoint } from "../../../app/tilesets/panel/tileGrid";
import { useTilesetPanel } from "../../../app/tilesets/panel/tilesetPanel";
import {
    MAX_FRAME_MS,
    MIN_FRAME_MS,
    animationFrameAt,
    deleteFrames,
    insertFrames,
    moveFrames,
    nudgeFrames,
    setFrameDurations,
} from "../../../core/model";
import type { AnimationFrame, Tileset } from "../../../core/model";
import type { AnimationEdit } from "../../../core/tileset";
import { runCommand } from "../../commands/runCommand";
import { PixelCanvas } from "../../import/PixelCanvas";
import { Button, Dialog, Icon, IconButton, NumberField, Select } from "../../primitives";
import { useTheme } from "../../theme/theme";
import { paintTileGrid } from "../paintTileGrid";
import { readColours } from "../TilesetsPanel";
import { tilePixelsById } from "../tilePixels";
import "./animation.css";

// The Animation Editor (DESIGN §9; SPEC §6.4; TE-030), a dialog with the frame list of the
// edited tile (thumbnail, duration field, drag handle per frame), the frame duration with Apply
// for the selected frames, Delete, the looping preview at 1×–4×, and the tileset's tile grid
// to add frames from (Tiled's editor holds a tileset view; this dialog is modal, so the
// Tilesets panel cannot be reached while it is open). Tiles are added by dragging them from the
// grid into the list (dropped where the pointer is), by a double click (appended), or with Add
// from Selection (the grid's selected tiles, appended); new frames take the frame duration.
// Frames are reordered by dragging their handle, or with Alt+Up and Alt+Down; Delete or
// Backspace deletes the selected ones. Every edit is a live command of the project history; the
// app's keymap is off while the dialog is open, so the editor binds Ctrl+Z, Ctrl+Y and
// Ctrl+Shift+Z to the app's Undo and Redo.

/** The preview scales (DESIGN §9: 1×–4×). */
const PREVIEW_SCALES = ["1", "2", "3", "4"] as const;
type PreviewScale = (typeof PREVIEW_SCALES)[number];
const SCALE_OPTIONS = PREVIEW_SCALES.map((value) => ({ value, label: `${value}×` }));
/** The preview's side the default scale fits, in CSS pixels. */
const PREVIEW_FIT = 128;
/** How far a press moves before it is a drag, in CSS pixels. */
const DRAG_START = 4;

/** What is dragged into or along the frame list. */
type Payload = { kind: "frames"; indices: number[] } | { kind: "tiles"; tileIds: number[] };

interface Drag {
    pointerId: number;
    x: number;
    y: number;
    payload: Payload;
    dragging: boolean;
}

const isTextTarget = (target: EventTarget) =>
    target instanceof HTMLElement &&
    (target.isContentEditable ||
        target.tagName === "TEXTAREA" ||
        (target.tagName === "INPUT" &&
            !["button", "checkbox"].includes((target as HTMLInputElement).type)));

function defaultScale(tileset: Tileset): PreviewScale {
    const side = Math.max(tileset.tileWidth, tileset.tileHeight);
    return (
        [...PREVIEW_SCALES].reverse().find((scale) => side * Number(scale) <= PREVIEW_FIT) ?? "1"
    );
}

export function AnimationEditor({ request }: { request: AnimationEditorRequest }) {
    useSession((state) => state.revision);
    const edited = animatedTile(request);
    // The tileset or the tile went away (an undo of its import): the editor closes.
    useEffect(() => {
        if (!edited) request.answer(null);
    }, [edited, request]);
    if (!edited) return null;
    return (
        <AnimationEditorBody
            request={request}
            tileset={edited.tileset}
            frames={edited.tile.animation}
        />
    );
}

function AnimationEditorBody({
    request,
    tileset,
    frames,
}: {
    request: AnimationEditorRequest;
    tileset: Tileset;
    frames: readonly AnimationFrame[];
}) {
    const duration = useFrameDuration();
    const [chosen, setChosen] = useState<readonly number[]>([]);
    const [anchor, setAnchor] = useState<number | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [dropAt, setDropAt] = useState<number | null>(null);
    const [grid, setGrid] = useState(() => {
        const rect = request.selection;
        if (!rect) return null;
        const anchorPoint = { column: rect.column, row: rect.row };
        const focus = { column: rect.column + rect.columns - 1, row: rect.row + rect.rows - 1 };
        return { anchor: anchorPoint, focus };
    });
    const list = useRef<HTMLUListElement>(null);
    const drag = useRef<Drag | null>(null);

    // The selected frames that are still in the list (an undo may shorten it).
    const selected = chosen.filter((index) => index < frames.length);
    const selectedSet = new Set(selected);

    /** Applies `next` as one entry; a refusal shows its reason. */
    const apply = (next: readonly AnimationFrame[], edit: AnimationEdit): boolean => {
        try {
            const changed = applyAnimation(request, next, edit);
            if (changed) setMessage(null);
            return changed;
        } catch (error) {
            setMessage(error instanceof Error ? error.message : String(error));
            return false;
        }
    };

    const select = (indices: readonly number[], from: number | null = indices[0] ?? null) => {
        setChosen(indices);
        setAnchor(from);
    };

    /** Inserts frames of `tileIds` before `at`; they become the selection. */
    const addTiles = (tileIds: readonly number[], at = frames.length) => {
        if (tileIds.length === 0) return;
        const gap = Math.min(at, frames.length);
        if (apply(insertFrames(frames, gap, tileIds, duration), "add")) {
            select(tileIds.map((_, offset) => gap + offset));
        }
    };

    const moveSelection = (indices: readonly number[], at: number) => {
        const result = moveFrames(frames, indices, at);
        if (apply(result.frames, "move")) select(result.moved);
    };

    const deleteSelection = () => {
        if (selected.length === 0) return;
        if (!apply(deleteFrames(frames, selected), "delete")) return;
        select([], null);
        // The Delete button turns disabled: the list keeps the focus inside the editor, so its
        // keys (Ctrl+Z) still reach it.
        list.current?.focus({ preventScroll: true });
    };

    const setDurations = (indices: readonly number[], ms: number) => {
        if (indices.length > 0) apply(setFrameDurations(frames, indices, ms), "duration");
    };

    /** The gap of the frame list under a client point; null when the point is outside it. */
    const gapAt = (clientX: number, clientY: number): number | null => {
        const element = list.current;
        if (!element) return null;
        const box = element.getBoundingClientRect();
        const inside =
            clientX >= box.left &&
            clientX <= box.right &&
            clientY >= box.top &&
            clientY <= box.bottom;
        if (!inside) return null;
        const rows = element.querySelectorAll<HTMLElement>("[data-frame-row]");
        let gap = 0;
        rows.forEach((row) => {
            const rowBox = row.getBoundingClientRect();
            if (clientY > rowBox.top + rowBox.height / 2) gap += 1;
        });
        return gap;
    };

    const startDrag = (event: PointerEvent<HTMLElement>, payload: Payload) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            payload,
            dragging: false,
        };
    };

    /** Follows a drag; returns whether the pointer moved far enough to be dragging. */
    const followDrag = (event: PointerEvent<HTMLElement>): boolean => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return false;
        if (!current.dragging) {
            const far =
                Math.hypot(event.clientX - current.x, event.clientY - current.y) >= DRAG_START;
            if (!far) return false;
            current.dragging = true;
        }
        setDropAt(gapAt(event.clientX, event.clientY));
        return true;
    };

    /** Ends a drag: drops its payload where the pointer is. Returns whether it was dragging. */
    const endDrag = (event: PointerEvent<HTMLElement>): boolean => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return false;
        drag.current = null;
        setDropAt(null);
        if (!current.dragging) return false;
        const gap = gapAt(event.clientX, event.clientY);
        if (gap === null) return true;
        if (current.payload.kind === "tiles") addTiles(current.payload.tileIds, gap);
        else moveSelection(current.payload.indices, gap);
        return true;
    };

    const cancelDrag = () => {
        drag.current = null;
        setDropAt(null);
    };

    const onRowClick = (event: MouseEvent, index: number) => {
        if (event.shiftKey && anchor !== null) {
            const from = Math.min(anchor, index);
            const to = Math.max(anchor, index);
            setChosen(Array.from({ length: to - from + 1 }, (_, offset) => from + offset));
        } else if (event.ctrlKey || event.metaKey) {
            setChosen(
                selectedSet.has(index)
                    ? selected.filter((each) => each !== index)
                    : [...selected, index].sort((a, b) => a - b),
            );
            setAnchor(index);
        } else {
            select([index]);
        }
    };

    const onHandleDown = (event: PointerEvent<HTMLElement>, index: number) => {
        if (event.button !== 0) return;
        event.preventDefault();
        // The handle of a selected frame drags the selection; any other, its own frame.
        const indices = selectedSet.has(index) ? selected : [index];
        if (!selectedSet.has(index)) select([index]);
        startDrag(event, { kind: "frames", indices });
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (isTextTarget(event.target)) return;
        const key = event.key;
        const ctrl = event.ctrlKey || event.metaKey;
        if (ctrl && !event.altKey && (key === "z" || key === "Z" || key === "y" || key === "Y")) {
            event.preventDefault();
            if (drag.current) return;
            const redo = key.toLowerCase() === "y" || event.shiftKey;
            if (!runCommand(redo ? "edit.redo" : "edit.undo")) return;
            setMessage(null);
            // The list is replaced: no frame stays selected (Tiled resets its frame list).
            select([], null);
            return;
        }
        if (ctrl) return;
        if (event.altKey && (key === "ArrowUp" || key === "ArrowDown") && selected.length > 0) {
            event.preventDefault();
            const result = nudgeFrames(frames, selected, key === "ArrowUp" ? -1 : 1);
            if (apply(result.frames, "move")) select(result.moved, anchor);
            return;
        }
        if (event.altKey) return;
        if ((key === "Delete" || key === "Backspace") && !drag.current) {
            if (event.target instanceof HTMLElement && event.target.closest("[data-tile-picker]")) {
                return;
            }
            event.preventDefault();
            deleteSelection();
        }
    };

    const several = selected.length;

    return (
        <Dialog
            open
            title="Animation Editor"
            onOpenChange={(open) => {
                // Escape ends a drag first; then it closes.
                if (open) return;
                if (drag.current) cancelDrag();
                else request.answer(null);
            }}
            actions={
                <Button
                    variant="primary"
                    onClick={() => request.answer(null)}
                    data-animation-close=""
                >
                    Close
                </Button>
            }
        >
            <div className="animation-editor" onKeyDown={onKeyDown} data-animation-editor="">
                <p className="animation-editor__about">
                    {tileset.name} · tile {request.tileId}
                </p>
                <div className="animation-editor__body">
                    <div className="animation-editor__frames">
                        <ul
                            ref={list}
                            className="animation-editor__list"
                            aria-label="Frames"
                            tabIndex={-1}
                            data-frame-list=""
                            data-drop={dropAt ?? undefined}
                        >
                            {frames.map((frame, index) => (
                                <FrameRow
                                    key={index}
                                    tileset={tileset}
                                    frame={frame}
                                    index={index}
                                    selected={selectedSet.has(index)}
                                    dropBefore={dropAt === index}
                                    onClick={(event) => onRowClick(event, index)}
                                    onDuration={(ms) => setDurations([index], ms)}
                                    onHandleDown={(event) => onHandleDown(event, index)}
                                    onHandleMove={followDrag}
                                    onHandleUp={endDrag}
                                    onHandleCancel={cancelDrag}
                                />
                            ))}
                            {frames.length === 0 ? (
                                <li className="animation-editor__empty">
                                    No frames: drag tiles here
                                </li>
                            ) : null}
                            {dropAt !== null && dropAt === frames.length ? (
                                <li className="animation-editor__drop-end" aria-hidden="true" />
                            ) : null}
                        </ul>
                        <div className="animation-editor__controls">
                            <NumberField
                                label="Frame Duration"
                                unit="ms"
                                value={duration}
                                min={MIN_FRAME_MS}
                                max={MAX_FRAME_MS}
                                precision={0}
                                onChange={setFrameDuration}
                                className="animation-editor__duration"
                            />
                            <Button
                                disabled={several === 0}
                                onClick={() => setDurations(selected, duration)}
                                data-animation-apply=""
                            >
                                Apply
                            </Button>
                            <IconButton
                                label="Delete Frames"
                                disabled={several === 0}
                                onClick={deleteSelection}
                                data-animation-delete=""
                            >
                                <Icon icon={Trash2} />
                            </IconButton>
                        </div>
                        <p
                            className="animation-editor__message"
                            role="status"
                            data-animation-message=""
                        >
                            {message ?? ""}
                        </p>
                    </div>
                    <div className="animation-editor__side">
                        <TilePicker
                            tileset={tileset}
                            selection={grid}
                            onSelect={setGrid}
                            onAppend={(tileId) => addTiles([tileId])}
                            onAddSelection={(tileIds) => addTiles(tileIds)}
                            onDragStart={(event, tileIds) =>
                                startDrag(event, { kind: "tiles", tileIds })
                            }
                            onDragMove={followDrag}
                            onDragEnd={endDrag}
                            onDragCancel={cancelDrag}
                        />
                        <Preview tileset={tileset} frames={frames} />
                    </div>
                </div>
            </div>
        </Dialog>
    );
}

/**
 * The pixels of tile `tileId` of `tileset`, cut again when the tileset's pixels or tiles change
 * (commands replace them; an animation edit changes neither).
 */
function useTilePixels(tileset: Tileset, tileId: number | null) {
    const { pixels: sheet, tiles } = tileset;
    return useMemo(
        () =>
            tileId === null ? null : tilePixelsById({ ...tileset, pixels: sheet, tiles }, tileId),
        [tileset, sheet, tiles, tileId],
    );
}

function FrameRow({
    tileset,
    frame,
    index,
    selected,
    dropBefore,
    onClick,
    onDuration,
    onHandleDown,
    onHandleMove,
    onHandleUp,
    onHandleCancel,
}: {
    tileset: Tileset;
    frame: AnimationFrame;
    index: number;
    selected: boolean;
    dropBefore: boolean;
    onClick(event: MouseEvent): void;
    onDuration(ms: number): void;
    onHandleDown(event: PointerEvent<HTMLElement>): void;
    onHandleMove(event: PointerEvent<HTMLElement>): boolean;
    onHandleUp(event: PointerEvent<HTMLElement>): boolean;
    onHandleCancel(): void;
}) {
    const pixels = useTilePixels(tileset, frame.tile);
    return (
        <li
            className="animation-editor__row"
            data-frame-row={index}
            data-tile={frame.tile}
            data-ms={frame.ms}
            data-selected={selected ? "" : undefined}
            data-drop-before={dropBefore ? "" : undefined}
        >
            <span
                className="animation-editor__handle"
                aria-hidden="true"
                data-frame-handle={index}
                onPointerDown={onHandleDown}
                onPointerMove={onHandleMove}
                onPointerUp={onHandleUp}
                onPointerCancel={onHandleCancel}
                onLostPointerCapture={onHandleCancel}
            >
                <Icon icon={GripVertical} />
            </span>
            <button
                type="button"
                className="animation-editor__item"
                aria-pressed={selected}
                data-frame={index}
                onClick={onClick}
            >
                {pixels ? (
                    <PixelCanvas pixels={pixels} className="animation-editor__thumb" />
                ) : (
                    <span className="animation-editor__thumb" />
                )}
                <span>
                    {index + 1} · tile {frame.tile}
                </span>
            </button>
            <NumberField
                label={`Duration of frame ${index + 1}`}
                hideLabel
                unit="ms"
                value={frame.ms}
                min={MIN_FRAME_MS}
                max={MAX_FRAME_MS}
                precision={0}
                onChange={onDuration}
                className="animation-editor__ms"
            />
        </li>
    );
}

/** The grid position under a pointer event, from the grid's own box. */
function pointOf(
    event: { clientX: number; clientY: number },
    sizer: HTMLElement,
    layout: GridLayout,
) {
    const box = sizer.getBoundingClientRect();
    return gridPointAt(layout, event.clientX - box.left, event.clientY - box.top, false);
}

interface GridSelection {
    anchor: GridPoint;
    focus: GridPoint;
}

/** Arrow keys and the move they make. */
const ARROWS: Readonly<Record<string, [number, number]>> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
};

/** The tileset's tiles to add frames from: the panel's grid, painted the same way. */
function TilePicker({
    tileset,
    selection,
    onSelect,
    onAppend,
    onAddSelection,
    onDragStart,
    onDragMove,
    onDragEnd,
    onDragCancel,
}: {
    tileset: Tileset;
    selection: GridSelection | null;
    onSelect(selection: GridSelection | null): void;
    onAppend(tileId: number): void;
    onAddSelection(tileIds: number[]): void;
    onDragStart(event: PointerEvent<HTMLElement>, tileIds: number[]): void;
    onDragMove(event: PointerEvent<HTMLElement>): boolean;
    onDragEnd(event: PointerEvent<HTMLElement>): boolean;
    onDragCancel(): void;
}) {
    const zoom = useTilesetPanel((state) => state.zoom);
    const theme = useTheme();
    const checkerboard = usePreference("checkerboard");
    const scroller = useRef<HTMLDivElement>(null);
    const sizer = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    // A press inside the selection that did not drag selects only its tile when released.
    const press = useRef<GridPoint | null>(null);
    const [view, setView] = useState({ x: 0, y: 0, width: 0, height: 0 });
    const layout = gridLayout(tileset, zoom);
    const rect = selection ? spanGridRect(selection.anchor, selection.focus) : null;

    /** The tiles of the selection, row by row. */
    const selectedIds = (): number[] => {
        if (!rect) return [];
        const ids: number[] = [];
        for (let row = rect.row; row < rect.row + rect.rows; row++) {
            for (let column = rect.column; column < rect.column + rect.columns; column++) {
                const tile = shownTile(tileset, layout, { column, row }, "");
                if (tile) ids.push(tile.id);
            }
        }
        return ids;
    };

    useLayoutEffect(() => {
        const element = scroller.current;
        if (!element) return;
        const measure = () =>
            setView((current) => {
                const next = {
                    x: element.scrollLeft,
                    y: element.scrollTop,
                    width: element.clientWidth,
                    height: element.clientHeight,
                };
                const same =
                    current.x === next.x &&
                    current.y === next.y &&
                    current.width === next.width &&
                    current.height === next.height;
                return same ? current : next;
            });
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        element.addEventListener("scroll", measure, { passive: true });
        return () => {
            observer.disconnect();
            element.removeEventListener("scroll", measure);
        };
    }, []);

    const shownWidth = Math.min(view.width, layout.width);
    const shownHeight = Math.min(view.height, layout.height);

    useLayoutEffect(() => {
        const element = canvas.current;
        if (!element || shownWidth <= 0 || shownHeight <= 0) return;
        paintTileGrid(element, {
            tileset,
            layout,
            filter: "",
            selection: rect,
            view: { x: view.x, y: view.y, width: shownWidth, height: shownHeight },
            colours: readColours(element, checkerboard.colors),
            checkerSize: checkerboard.size,
            dpr: window.devicePixelRatio,
            zoom,
        });
    });
    void theme;

    const reveal = (point: GridPoint) => {
        const element = scroller.current;
        if (!element) return;
        const { x, y } = tileOrigin(layout, point);
        const right = x + layout.tileWidth;
        const bottom = y + layout.tileHeight;
        if (x < element.scrollLeft) element.scrollLeft = x - 1;
        else if (right > element.scrollLeft + element.clientWidth)
            element.scrollLeft = right + 1 - element.clientWidth;
        if (y < element.scrollTop) element.scrollTop = y - 1;
        else if (bottom > element.scrollTop + element.clientHeight)
            element.scrollTop = bottom + 1 - element.clientHeight;
    };

    const inside = (point: GridPoint) =>
        rect !== null &&
        point.column >= rect.column &&
        point.column < rect.column + rect.columns &&
        point.row >= rect.row &&
        point.row < rect.row + rect.rows;

    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || !sizer.current) return;
        const point = pointOf(event, sizer.current, layout);
        if (!point || !shownTile(tileset, layout, point, "")) return;
        event.preventDefault();
        scroller.current?.focus({ preventScroll: true });
        press.current = null;
        let next = selection;
        if (event.shiftKey && selection) {
            next = { anchor: selection.anchor, focus: point };
        } else if (inside(point) && !event.shiftKey) {
            press.current = point;
        } else {
            next = { anchor: point, focus: point };
        }
        if (next !== selection) onSelect(next);
        const ids = (() => {
            if (!next) return [];
            const span = spanGridRect(next.anchor, next.focus);
            const tiles: number[] = [];
            for (let row = span.row; row < span.row + span.rows; row++) {
                for (let column = span.column; column < span.column + span.columns; column++) {
                    const tile = shownTile(tileset, layout, { column, row }, "");
                    if (tile) tiles.push(tile.id);
                }
            }
            return tiles;
        })();
        onDragStart(event, ids);
    };
    const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
        if (onDragMove(event)) press.current = null;
    };
    const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
        const dragged = onDragEnd(event);
        const pressed = press.current;
        press.current = null;
        if (!dragged && pressed) onSelect({ anchor: pressed, focus: pressed });
    };
    const onDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
        if (!sizer.current) return;
        const point = pointOf(event, sizer.current, layout);
        const tile = point ? shownTile(tileset, layout, point, "") : null;
        if (tile) onAppend(tile.id);
    };
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.ctrlKey || event.altKey || event.metaKey) return;
        const arrow = ARROWS[event.key];
        if (arrow) {
            event.preventDefault();
            const from = selection?.focus ?? { column: 0, row: 0 };
            const focus = {
                column: Math.min(Math.max(from.column + arrow[0], 0), layout.columns - 1),
                row: Math.min(Math.max(from.row + arrow[1], 0), Math.max(0, layout.rows - 1)),
            };
            onSelect({
                anchor: event.shiftKey && selection ? selection.anchor : focus,
                focus,
            });
            reveal(focus);
        } else if (event.key === "Enter") {
            event.preventDefault();
            onAddSelection(selectedIds());
        }
    };

    const count = selectedIds().length;
    return (
        <div className="animation-editor__picker">
            <div
                ref={scroller}
                className="animation-editor__grid"
                role="group"
                aria-label={`Tiles of ${tileset.name}`}
                tabIndex={0}
                data-tile-picker=""
                data-zoom={zoom}
                onKeyDown={onKeyDown}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => {
                    press.current = null;
                    onDragCancel();
                }}
                onDoubleClick={onDoubleClick}
            >
                <div
                    ref={sizer}
                    className="animation-editor__sizer"
                    style={{ width: layout.width, height: layout.height }}
                >
                    <canvas
                        ref={canvas}
                        className="animation-editor__canvas"
                        style={{ width: shownWidth, height: shownHeight }}
                        data-picker-canvas=""
                    />
                </div>
            </div>
            <Button
                disabled={count === 0}
                onClick={() => onAddSelection(selectedIds())}
                data-animation-add=""
            >
                Add from Selection
            </Button>
        </div>
    );
}

/**
 * The looping preview: the frame `animationFrameAt` gives for the time since the list last
 * changed (Tiled restarts its preview on every change), read from `performance.now()` on each
 * animation frame, at 1×–4× the tile's size.
 */
function Preview({ tileset, frames }: { tileset: Tileset; frames: readonly AnimationFrame[] }) {
    const [scale, setScale] = useState<PreviewScale>(() => defaultScale(tileset));
    // The frame shown, for the list it was found in: a new list starts at its first frame.
    const [played, setPlayed] = useState({ frames, index: animationFrameAt(frames, 0) });
    const index = played.frames === frames ? played.index : animationFrameAt(frames, 0);
    useEffect(() => {
        if (frames.length === 0) return;
        const start = performance.now();
        let request = 0;
        const tick = () => {
            const next = animationFrameAt(frames, performance.now() - start);
            setPlayed((current) =>
                current.frames === frames && current.index === next
                    ? current
                    : { frames, index: next },
            );
            request = requestAnimationFrame(tick);
        };
        request = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(request);
    }, [frames]);
    const shown = index >= 0 && index < frames.length ? frames[index]! : null;
    const pixels = useTilePixels(tileset, shown?.tile ?? null);
    const factor = Number(scale);
    return (
        <div className="animation-editor__preview">
            <div
                className="animation-editor__stage"
                role="img"
                aria-label={shown ? `Preview: tile ${shown.tile}` : "Preview: no frames"}
                data-animation-preview=""
                data-preview-frame={shown ? index : undefined}
                data-preview-tile={shown?.tile}
                style={{
                    width: tileset.tileWidth * factor,
                    height: tileset.tileHeight * factor,
                }}
            >
                {pixels ? (
                    <PixelCanvas
                        pixels={pixels}
                        className="animation-editor__preview-canvas"
                        style={{
                            width: tileset.tileWidth * factor,
                            height: tileset.tileHeight * factor,
                        }}
                    />
                ) : (
                    <span className="animation-editor__no-preview">No frames</span>
                )}
            </div>
            <Select
                label="Preview"
                value={scale}
                onChange={setScale}
                options={SCALE_OPTIONS}
                className="animation-editor__scale"
            />
        </div>
    );
}
