import { useId } from "react";
import { useStore } from "zustand";
import type { ImportTilesetRequest } from "../../app/tilesets/import/importDialog";
import { gridOf } from "../../app/tilesets/import/importForm";
import { canImportState } from "../../app/tilesets/import/importSession";
import type { ImportSessionState } from "../../app/tilesets/import/importSession";
import { MAX_SOURCE_MARGIN, MAX_TEXT_LENGTH } from "../../core/model";
import type { TilesetImportWarning } from "../../core/tileset";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";
import { NumberField } from "../primitives/NumberField";
import { Select } from "../primitives/Select";
import { SourcePane } from "./SourcePane";
import "../primitives/field.css";
import "./import.css";

/** Tile sizes the fields take: above 256 is typed, then refused by the plan (SPEC §6.1). */
const TILE_SIDE = { min: 1, max: 8192 };
const GAP = { min: 0, max: MAX_SOURCE_MARGIN };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "n frames, m tiles, k animations" of a sprite's import (DESIGN §9). */
export function spriteSummary(frames: number, tiles: number, animations: number): string {
    return [
        plural(frames, "frame", "frames"),
        plural(tiles, "tile", "tiles"),
        plural(animations, "animation", "animations"),
    ].join(", ");
}

/** A labelled text field of the form: the name and the export name. */
function TextField({
    label,
    value,
    onChange,
    maxLength,
    invalid,
    disabled,
}: {
    label: string;
    value: string;
    onChange(value: string): void;
    maxLength: number;
    invalid: boolean;
    disabled: boolean;
}) {
    const id = useId();
    return (
        <span className="ui-field import-dialog__text-field">
            <label className="ui-field__label" htmlFor={id}>
                {label}
            </label>
            <input
                id={id}
                className="import-dialog__text"
                type="text"
                autoComplete="off"
                spellCheck={false}
                maxLength={maxLength}
                disabled={disabled}
                aria-invalid={invalid || undefined}
                value={value}
                onChange={(event) => onChange(event.target.value)}
            />
        </span>
    );
}

function Warnings({ warnings }: { warnings: readonly TilesetImportWarning[] }) {
    if (warnings.length === 0) return null;
    return (
        <ul className="import-dialog__warnings" data-import-warnings="">
            {warnings.map((warning, index) => (
                <li key={`${warning.code}:${warning.animation}:${index}`}>{warning.message}</li>
            ))}
        </ul>
    );
}

/** The left pane: the image with its grid, a sprite's frame and its select, or an atlas's lists. */
function SourceColumn({
    state,
    onFrame,
}: {
    state: ImportSessionState;
    onFrame(frame: number): void;
}) {
    const { source, form, pixels, loadingPixels, pixelsError } = state;
    if (source.kind === "atlas") {
        const { frames, animations } = source.outline;
        return (
            <div className="import-dialog__source">
                <p className="import-dialog__file" data-import-file="">
                    {source.fileName} · {source.png.fileName} · {source.size.width} ×{" "}
                    {source.size.height}
                </p>
                <h3 className="import-dialog__heading">
                    {plural(frames.length, "Frame", "Frames")}
                </h3>
                <ul className="import-dialog__list" data-import-frames="">
                    {frames.map((frame) => (
                        <li key={frame.id} data-import-frame={frame.id}>
                            <span className="import-dialog__list-name">{frame.id}</span>
                            <span className="import-dialog__list-value">
                                {frame.width} × {frame.height}
                            </span>
                        </li>
                    ))}
                </ul>
                <h3 className="import-dialog__heading">
                    {plural(animations.length, "Animation", "Animations")}
                </h3>
                {animations.length > 0 ? (
                    <ul className="import-dialog__list" data-import-animations="">
                        {animations.map((animation) => (
                            <li key={animation.id} data-import-animation={animation.id}>
                                <span className="import-dialog__list-name">{animation.id}</span>
                                <span className="import-dialog__list-value">
                                    {plural(animation.entries, "frame", "frames")}
                                    {animation.playback === "once" ? ", once" : ""}
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : null}
            </div>
        );
    }
    const size =
        source.kind === "image"
            ? source.size
            : source.kind === "sprite"
              ? { width: source.doc.width, height: source.doc.height }
              : null;
    const empty = loadingPixels ? "Reading…" : (pixelsError ?? "No preview");
    return (
        <div className="import-dialog__source">
            {pixels ? (
                <SourcePane pixels={pixels} grid={gridOf(form)} />
            ) : (
                <div className="import-source import-source--empty" data-import-no-preview="">
                    {empty}
                </div>
            )}
            {source.kind === "sprite" ? (
                <Select
                    label="Frame"
                    value={String(form.frame)}
                    onChange={(value) => onFrame(Number(value))}
                    options={source.doc.frames.map((frame, index) => ({
                        value: String(index),
                        label: `${index + 1} of ${source.doc.frames.length} · ${frame.durationMs} ms`,
                    }))}
                />
            ) : null}
            <p className="import-dialog__file" data-import-file="">
                {source.fileName}
                {size ? ` · ${size.width} × ${size.height}` : ""}
            </p>
        </div>
    );
}

/** The counts the form shows (DESIGN §9), or null while there are none. */
function summaryOf(state: ImportSessionState): string | null {
    const { source, plan, spriteResult, computing } = state;
    if (!plan.ok) return null;
    if (source.kind === "sprite") {
        if (computing || !spriteResult?.imported) return computing ? "Computing…" : null;
        const { tiles } = spriteResult.imported.tileset;
        const animated = tiles.filter((tile) => tile.animation.length > 0).length;
        return spriteSummary(source.doc.frames.length, tiles.length, animated);
    }
    return plural(plan.shape.tileCount, "tile", "tiles");
}

/**
 * Import Tileset (DESIGN §9; SPEC §6.1; TE-024), a large dialog: the source on the left (the
 * image with its grid, a sprite's frame chosen under it, or an atlas's frames and animations),
 * the form on the right (tile size, margin and spacing of a grid PNG or a sprite, name, export
 * name), the counts, warnings and any refusal under it. Import is disabled while the plan
 * refuses, a name cannot be taken, or a sprite's import for the grid is being made; it adds
 * the tileset while the dialog stays open and closes once it is added.
 */
export function ImportDialog({ request }: { request: ImportTilesetRequest }) {
    const { session } = request;
    const state = useStore(session.store);
    const { source, form, plan, importing, failure, spriteResult } = state;
    const canImport = canImportState(state);
    const gridded = source.kind === "image" || source.kind === "sprite";
    const summary = summaryOf(state);
    const warnings =
        source.kind === "sprite"
            ? (spriteResult?.imported?.warnings ?? [])
            : plan.ok
              ? plan.warnings
              : [];
    const problems = [
        plan.ok ? null : plan.problem,
        state.nameProblem,
        source.kind === "sprite" && plan.ok && !state.computing ? spriteResult?.error : null,
    ].filter((line): line is string => !!line);

    const nameInvalid = form.name.trim() === "" || form.name.length > MAX_TEXT_LENGTH;

    const confirm = async () => {
        if ((await session.confirm()) !== null) request.answer(true);
    };

    return (
        <Dialog
            open
            size="large"
            onOpenChange={(open) => {
                // Not while the tileset is being added: it would be added after all.
                if (!open && !importing) request.answer(null);
            }}
            title="Import Tileset"
            className="import-dialog"
            actions={
                <>
                    <div className="import-dialog__status">
                        <p
                            className="import-dialog__summary"
                            aria-live="polite"
                            data-import-status=""
                        >
                            {importing ? "Importing…" : ""}
                        </p>
                        {failure ? (
                            <p
                                className="import-dialog__message"
                                role="alert"
                                data-import-failure=""
                            >
                                Could not import. {failure}
                            </p>
                        ) : null}
                    </div>
                    <Button disabled={importing} onClick={() => request.answer(null)}>
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        disabled={!canImport}
                        onClick={() => void confirm()}
                        data-import-confirm=""
                    >
                        Import
                    </Button>
                </>
            }
        >
            <div className="import-dialog__panes">
                <SourceColumn state={state} onFrame={(frame) => session.change({ frame })} />
                <div className="import-dialog__form">
                    {gridded ? (
                        <>
                            <div className="import-dialog__row">
                                <NumberField
                                    label="Tile width"
                                    value={form.tileWidth}
                                    onChange={(tileWidth) => session.change({ tileWidth })}
                                    unit="px"
                                    disabled={importing}
                                    {...TILE_SIDE}
                                />
                                <NumberField
                                    label="Tile height"
                                    value={form.tileHeight}
                                    onChange={(tileHeight) => session.change({ tileHeight })}
                                    unit="px"
                                    disabled={importing}
                                    {...TILE_SIDE}
                                />
                            </div>
                            <div className="import-dialog__row">
                                <NumberField
                                    label="Margin"
                                    value={form.margin}
                                    onChange={(margin) => session.change({ margin })}
                                    unit="px"
                                    disabled={importing}
                                    {...GAP}
                                />
                                <NumberField
                                    label="Spacing"
                                    value={form.spacing}
                                    onChange={(spacing) => session.change({ spacing })}
                                    unit="px"
                                    disabled={importing}
                                    {...GAP}
                                />
                            </div>
                        </>
                    ) : null}
                    <TextField
                        label="Name"
                        value={form.name}
                        onChange={(name) => session.change({ name })}
                        maxLength={MAX_TEXT_LENGTH}
                        invalid={nameInvalid}
                        disabled={importing}
                    />
                    <TextField
                        label="Export name"
                        value={form.exportName}
                        onChange={(exportName) => session.change({ exportName })}
                        maxLength={64}
                        invalid={state.nameProblem !== null && !nameInvalid}
                        disabled={importing}
                    />
                    <p className="import-dialog__count" aria-live="polite" data-import-summary="">
                        {summary ?? ""}
                    </p>
                    <Warnings warnings={warnings} />
                    {problems.length > 0 ? (
                        <div role="alert" className="import-dialog__problems">
                            {problems.map((line) => (
                                <p
                                    key={line}
                                    className="import-dialog__message"
                                    data-import-problem=""
                                >
                                    {line}
                                </p>
                            ))}
                        </div>
                    ) : null}
                </div>
            </div>
        </Dialog>
    );
}
