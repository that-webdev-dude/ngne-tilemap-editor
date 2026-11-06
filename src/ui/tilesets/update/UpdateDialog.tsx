import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { useStore } from "zustand";
import { summaryText } from "../../../app/tilesets/update/updateFromSource";
import type { UpdateTilesetRequest } from "../../../app/tilesets/update/updateFromSource";
import { choicesComplete, keyLabel } from "../../../app/tilesets/update/updateSession";
import type {
    RowChoice,
    UpdateRow,
    UpdateSession,
} from "../../../app/tilesets/update/updateSession";
import type { SourceTiles } from "../../../core/tileset";
import { PixelCanvas } from "../../import/PixelCanvas";
import { Button } from "../../primitives/Button";
import { Dialog } from "../../primitives/Dialog";
import { Popover } from "../../primitives/Popover";
import { Select } from "../../primitives/Select";
import { rowStatusText } from "./rowText";
import { sheetBacking, sheetLayout } from "./sheetBacking";
import "./update.css";

// Update Tileset from Source (DESIGN §9; SPEC §6.3; TE-028), a large dialog: the summary line,
// then a row per ambiguous and missing tile with its old picture, its usage per map and its
// choice (a candidate, Keep as is, Delete, Replace with… a tile of the source, picked from a
// grid of the source's tiles). Apply makes one history entry and closes; Cancel changes
// nothing.

/** Side of a tile in the pictures of the dialog, in CSS pixels. */
const PICTURE = 32;
type ChoiceValue = "keep" | "delete" | "replace" | `candidate:${number}`;

function valueOf(choice: RowChoice): ChoiceValue {
    return choice.kind === "candidate" ? `candidate:${choice.entry}` : choice.kind;
}

/** The size of a tile's picture: its longer side `PICTURE` CSS pixels. */
function pictureSize(source: SourceTiles): { width: number; height: number } {
    const scale = PICTURE / Math.max(source.tileWidth, source.tileHeight);
    return { width: source.tileWidth * scale, height: source.tileHeight * scale };
}

/** The tile of the source at `entry`, at the dialog's picture size. */
function EntryPicture({ source, entry }: { source: SourceTiles; entry: number }) {
    const { tileWidth, tileHeight } = source;
    const bytes = source.entries[entry]!.pixels;
    const pixels = {
        width: tileWidth,
        height: tileHeight,
        data: new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.length),
    };
    return (
        <PixelCanvas
            className="update-dialog__picture"
            style={pictureSize(source)}
            pixels={pixels}
        />
    );
}

/**
 * The source's tiles on one canvas, in the grid of `sheetLayout`, for Replace with…: a click
 * picks one; the arrow keys move the outlined tile and Enter picks it.
 */
function SourceSheet({
    source,
    chosen,
    onPick,
}: {
    source: SourceTiles;
    chosen: number | null;
    onPick(entry: number): void;
}) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const count = source.entries.length;
    const cell = pictureSize(source);
    const layout = sheetLayout(count, cell.width, cell.height);
    const { columns, pitchX, pitchY } = layout;
    const [focus, setFocus] = useState(chosen ?? 0);

    useEffect(() => {
        const element = canvas.current;
        const context = element?.getContext("2d");
        if (!element || !context) return;
        // The backing store stays within the canvas limits; the CSS size does not follow it.
        const backing = sheetBacking(layout.width, layout.height, window.devicePixelRatio || 1);
        const scale = backing.scale;
        element.width = backing.width;
        element.height = backing.height;
        context.imageSmoothingEnabled = false;
        const tile = document.createElement("canvas");
        tile.width = source.tileWidth;
        tile.height = source.tileHeight;
        const tileContext = tile.getContext("2d")!;
        source.entries.forEach((entry, index) => {
            const data = new Uint8ClampedArray(
                entry.pixels.buffer as ArrayBuffer,
                entry.pixels.byteOffset,
                entry.pixels.length,
            );
            tileContext.putImageData(
                new ImageData(data, source.tileWidth, source.tileHeight),
                0,
                0,
            );
            const x = 1 + (index % columns) * pitchX;
            const y = 1 + Math.floor(index / columns) * pitchY;
            context.drawImage(tile, x * scale, y * scale, cell.width * scale, cell.height * scale);
        });
    }, [source, columns, pitchX, pitchY, cell.width, cell.height, layout.width, layout.height]);

    const entryAt = (event: MouseEvent<HTMLCanvasElement>): number | null => {
        const box = event.currentTarget.getBoundingClientRect();
        const column = Math.floor((event.clientX - box.left - 1) / pitchX);
        const row = Math.floor((event.clientY - box.top - 1) / pitchY);
        const index = row * columns + column;
        return column >= 0 && column < columns && row >= 0 && index < count ? index : null;
    };
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const step: Record<string, number> = {
            ArrowLeft: -1,
            ArrowRight: 1,
            ArrowUp: -columns,
            ArrowDown: columns,
        };
        if (event.key in step) {
            event.preventDefault();
            setFocus((at) => Math.min(count - 1, Math.max(0, at + step[event.key]!)));
        } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onPick(focus);
        }
    };
    const outline = (index: number) => ({
        left: (index % columns) * pitchX,
        top: Math.floor(index / columns) * pitchY,
        width: cell.width + 2,
        height: cell.height + 2,
    });
    return (
        <div
            className="update-sheet"
            tabIndex={0}
            role="group"
            aria-label={`Tiles of the source; tile ${focus + 1} of ${count}, ${keyLabel(source.entries[focus]!.key)}`}
            onKeyDown={onKeyDown}
            data-update-sheet=""
            data-columns={columns}
            data-pitch-x={pitchX}
            data-pitch-y={pitchY}
        >
            <canvas
                ref={canvas}
                className="update-sheet__canvas"
                style={{ width: layout.width, height: layout.height }}
                onClick={(event) => {
                    const entry = entryAt(event);
                    if (entry !== null) onPick(entry);
                }}
            />
            {chosen !== null ? (
                <span className="update-sheet__chosen" style={outline(chosen)} />
            ) : null}
            <span className="update-sheet__focus" style={outline(focus)} />
        </div>
    );
}

/** Replace with…: the picked tile, and the popover that picks it. */
function ReplacePicker({
    session,
    row,
    entry,
    disabled,
}: {
    session: UpdateSession;
    row: UpdateRow;
    entry: number | null;
    disabled: boolean;
}) {
    const source = useStore(session.store, (state) => state.source);
    const [open, setOpen] = useState(false);
    return (
        <Popover
            label={`Replace tile ${row.tileId} with`}
            open={open && !disabled}
            onOpenChange={setOpen}
            trigger={
                <button
                    type="button"
                    className="update-dialog__replace"
                    disabled={disabled}
                    data-update-replace={row.tileId}
                >
                    {entry === null ? (
                        "Pick a tile…"
                    ) : (
                        <>
                            <EntryPicture source={source} entry={entry} />
                            <span>{keyLabel(source.entries[entry]!.key)}</span>
                        </>
                    )}
                </button>
            }
        >
            <SourceSheet
                source={source}
                chosen={entry}
                onPick={(picked) => {
                    session.choose(row.tileId, { kind: "replace", entry: picked });
                    setOpen(false);
                }}
            />
        </Popover>
    );
}

function Row({ session, row }: { session: UpdateSession; row: UpdateRow }) {
    const source = useStore(session.store, (state) => state.source);
    const choices = useStore(session.store, (state) => state.choices);
    const applying = useStore(session.store, (state) => state.applying);
    const choice = choices.get(row.tileId)!;
    /** Candidates other rows chose. */
    const taken = new Set(
        [...choices]
            .filter(([id, other]) => id !== row.tileId && other.kind === "candidate")
            .map(([, other]) => (other as { entry: number }).entry),
    );
    const options = [
        ...row.candidates.map((entry) => ({
            value: `candidate:${entry}` as ChoiceValue,
            label: `Source tile ${keyLabel(source.entries[entry]!.key)}`,
            disabled: taken.has(entry),
        })),
        { value: "keep" as ChoiceValue, label: "Keep as is" },
        { value: "delete" as ChoiceValue, label: "Delete" },
        { value: "replace" as ChoiceValue, label: "Replace with…" },
    ];
    const onChange = (value: ChoiceValue) => {
        if (value === valueOf(choice)) return;
        if (value.startsWith("candidate:")) {
            session.choose(row.tileId, { kind: "candidate", entry: Number(value.slice(10)) });
        } else if (value === "replace") {
            session.choose(row.tileId, { kind: "replace", entry: null });
        } else {
            session.choose(row.tileId, { kind: value as "keep" | "delete" });
        }
    };
    const status = rowStatusText(row);
    return (
        <li className="update-dialog__row" data-update-row={row.tileId}>
            <PixelCanvas
                className="update-dialog__picture"
                style={pictureSize(source)}
                pixels={row.picture}
            />
            <div className="update-dialog__about">
                <p className="update-dialog__tile">
                    Tile {row.tileId} <span className="update-dialog__footer">· {status}</span>
                </p>
                <ul className="update-dialog__usage" data-update-usage="">
                    {row.usage.length === 0 ? (
                        <li>Not used on any map</li>
                    ) : (
                        row.usage.map((use) => (
                            <li key={use.mapId}>
                                {use.mapName}: {use.cells} {use.cells === 1 ? "cell" : "cells"}
                            </li>
                        ))
                    )}
                </ul>
            </div>
            <div className="update-dialog__choice">
                <Select
                    label={`Tile ${row.tileId}`}
                    hideLabel
                    value={valueOf(choice)}
                    onChange={onChange}
                    options={options}
                    disabled={applying}
                    className="update-dialog__select"
                />
                {choice.kind === "replace" ? (
                    <ReplacePicker
                        session={session}
                        row={row}
                        entry={choice.entry}
                        disabled={applying}
                    />
                ) : null}
            </div>
        </li>
    );
}

export function UpdateDialog({ request }: { request: UpdateTilesetRequest }) {
    const { session } = request;
    const state = useStore(session.store);
    const { rows, summary, applying, failure, tilesetName } = state;
    const canApply = !applying && choicesComplete(state.choices);

    const confirm = async () => {
        if ((await session.confirm()) !== null) request.answer(true);
    };

    return (
        <Dialog
            open
            size="large"
            onOpenChange={(open) => {
                if (!open && !applying) request.answer(null);
            }}
            title="Update Tileset from Source"
            className="update-dialog"
            actions={
                <>
                    <div className="update-dialog__footer">
                        {failure ? (
                            <p
                                className="update-dialog__message"
                                role="alert"
                                data-update-failure=""
                            >
                                Could not update. {failure}
                            </p>
                        ) : null}
                    </div>
                    <Button disabled={applying} onClick={() => request.answer(null)}>
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        disabled={!canApply}
                        onClick={() => void confirm()}
                        data-update-apply=""
                    >
                        Apply
                    </Button>
                </>
            }
        >
            <p className="update-dialog__summary" data-update-summary="">
                {tilesetName}: {summaryText(summary)}
            </p>
            <ul className="update-dialog__rows" aria-label="Ambiguous and missing tiles">
                {rows.map((row) => (
                    <Row key={row.tileId} session={session} row={row} />
                ))}
            </ul>
        </Dialog>
    );
}
