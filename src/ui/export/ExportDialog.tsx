import { useEffect, useId, useState } from "react";
import type { ReactNode } from "react";
import { useStore } from "zustand";
import type { ExportDialogRequest } from "../../app/export/dialogs";
import { useSession } from "../../app/state/session";
import { EXPORT_FILE_GROUPS, exportFileGroup } from "../../core/export";
import type { ExportFileGroup, ExportPreview } from "../../core/export";
import { MAX_SLUG_LENGTH } from "../../core/model";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";
import { Toggle } from "../primitives/Toggle";
import { AtlasThumbnail } from "./AtlasThumbnail";
import "../primitives/field.css";
import "./export.css";

const GROUP_LABELS: Record<ExportFileGroup, string> = {
    tilemaps: "Tilemaps",
    tilesets: "Tilesets",
    images: "Images",
    runtime: "Runtime",
};

/** "512 B", "1.2 KB", "3.4 MB". */
export function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** One setting: its name in the label column, its controls as a named group. */
function Section({ label, children }: { label: string; children: ReactNode }) {
    const labelId = useId();
    return (
        <>
            <span className="ui-field__label export-dialog__label" id={labelId}>
                {label}
            </span>
            <div className="export-dialog__group" role="group" aria-labelledby={labelId}>
                {children}
            </div>
        </>
    );
}

/**
 * The project's export name: applied on Enter and when the field loses the focus, as an undo
 * step; a value that is no slug stays in the field with the reason below it.
 */
function ExportNameField({ value, apply }: { value: string; apply(value: string): string | null }) {
    const id = useId();
    const problemId = useId();
    const [draft, setDraft] = useState<string | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const commit = () => {
        if (draft === null) return;
        const refused = apply(draft);
        setProblem(refused);
        if (!refused) setDraft(null);
    };
    return (
        <>
            <label className="ui-field__label export-dialog__label" htmlFor={id}>
                Export name
            </label>
            <div className="export-dialog__group">
                <input
                    id={id}
                    className="export-dialog__text"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={MAX_SLUG_LENGTH}
                    aria-invalid={problem !== null || undefined}
                    aria-describedby={problem ? problemId : undefined}
                    data-export-name=""
                    value={draft ?? value}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={commit}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") {
                            event.preventDefault();
                            commit();
                        }
                    }}
                />
                {problem ? (
                    <p className="export-dialog__error" id={problemId} data-export-name-problem="">
                        {problem}
                    </p>
                ) : null}
            </div>
        </>
    );
}

/** The files of the export by group, with their sizes, and the packed tilesets. */
function FileList({ preview }: { preview: ExportPreview }) {
    const baseId = useId();
    return (
        <div className="export-dialog__files" data-export-files="">
            {EXPORT_FILE_GROUPS.map((group) => {
                const files = preview.files.filter((file) => exportFileGroup(file.kind) === group);
                if (files.length === 0) return null;
                const labelId = `${baseId}-${group}`;
                return (
                    <section key={group} className="export-dialog__file-group">
                        <h3 className="ui-field__label export-dialog__heading" id={labelId}>
                            {GROUP_LABELS[group]} ({files.length})
                        </h3>
                        <ul
                            aria-labelledby={labelId}
                            className="export-dialog__list"
                            data-export-group={group}
                        >
                            {files.map((file) => (
                                <li key={file.name} data-export-file={file.name}>
                                    <span>{file.name}</span>
                                    <span className="export-dialog__size" data-export-size="">
                                        {formatSize(file.size)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                        {group === "tilesets" && preview.atlases.length > 0 ? (
                            <div className="export-dialog__atlases">
                                {preview.atlases.map((atlas) => (
                                    <AtlasThumbnail key={atlas.name} atlas={atlas} />
                                ))}
                            </div>
                        ) : null}
                    </section>
                );
            })}
        </div>
    );
}

/**
 * The Export dialog (DESIGN §9; the sprite editor's `ExportDialog.tsx` as a pattern): the
 * destination folder, the project's export name and Export on save on the left; on the right
 * the files the export writes, made as the export makes them, grouped with their sizes, the
 * packed tilesets, or in `--danger` the message of the failure that keeps the project from
 * being exported. A change applies at once (the export name is an undo step, Export on save a
 * setting that makes the project dirty); Close keeps them, Export writes the folder.
 */
export function ExportDialog({ request }: { request: ExportDialogRequest }) {
    const current = useSession(
        (state) => state.open && state.session.project.id === request.projectId,
    );
    const exportName = useSession((state) => state.session.project.exportName);
    const exportOnSave = useSession((state) => state.session.project.exportSettings.exportOnSave);
    const destination = useStore(request.destination);
    const preview = useStore(request.preview);

    // The project left the window under the dialog: nothing is left to export.
    useEffect(() => {
        if (!current) request.answer(null);
    }, [current, request]);
    if (!current) return null;

    const shown =
        preview.status === "ready"
            ? preview.preview
            : preview.status === "making"
              ? (preview.previous ?? null)
              : null;

    return (
        <Dialog
            open
            size="large"
            onOpenChange={(open) => {
                if (!open) request.answer(null);
            }}
            title="Export"
            className="export-dialog"
            actions={
                <>
                    <Button onClick={() => request.answer(null)}>Close</Button>
                    <Button
                        variant="primary"
                        disabled={preview.status === "failed" || destination.choosing}
                        onClick={() => request.answer(true)}
                        data-export-submit=""
                    >
                        Export
                    </Button>
                </>
            }
        >
            <div className="export-dialog__columns">
                <div className="export-dialog__form">
                    <Section label="Destination">
                        {destination.mode === "folder" ? (
                            <div className="export-dialog__row">
                                <span className="export-dialog__destination" data-export-folder="">
                                    {destination.folder ?? "No folder chosen"}
                                </span>
                                <Button
                                    disabled={destination.choosing}
                                    onClick={() => request.chooseFolder()}
                                >
                                    Choose folder…
                                </Button>
                            </div>
                        ) : (
                            <span className="export-dialog__destination" data-export-folder="">
                                Download {exportName}.zip
                            </span>
                        )}
                    </Section>
                    <ExportNameField value={exportName} apply={request.setExportName} />
                    <span aria-hidden="true" />
                    <div className="export-dialog__row">
                        <Toggle
                            label="Export on save"
                            showLabel
                            pressed={exportOnSave}
                            onPressedChange={(on) => request.setExportOnSave(on)}
                            data-export-on-save=""
                        />
                    </div>
                </div>

                <div
                    className="export-dialog__result"
                    aria-live="polite"
                    aria-busy={preview.status === "making"}
                >
                    {preview.status === "failed" ? (
                        <p className="export-dialog__error" role="alert" data-export-error="">
                            {preview.error}
                        </p>
                    ) : shown ? (
                        <FileList preview={shown} />
                    ) : (
                        <p className="export-dialog__making">Making the files…</p>
                    )}
                </div>
            </div>
        </Dialog>
    );
}
