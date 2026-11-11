import { useStore } from "zustand";
import type { ImportTiledMapRequest } from "../../app/tmj/importTiledMap";
import { summaryLines } from "../../app/tmj/reportText";
import { pickTmjFiles } from "../../app/tmj/tmjFiles";
import type { TmjFileRow, TmjImportSessionState } from "../../app/tmj/tmjImportSession";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";
import { Select } from "../primitives/Select";
import "../primitives/field.css";
import "../import/import.css";
import "./tmj.css";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const KIND_LABELS: Readonly<Record<TmjFileRow["kind"], string>> = {
    tileset: "Tileset",
    image: "Image",
    template: "Template",
};

/** The status line of the files list and the report pane. */
function statusOf(state: TmjImportSessionState): string {
    switch (state.phase) {
        case "reading":
            return "Reading the map…";
        case "missing": {
            const missing = state.files.filter((file) => !file.found).length;
            return `${plural(missing, "file is", "files are")} missing: add ${missing === 1 ? "it" : "them"} with Add files…`;
        }
        case "converting":
            return "Converting…";
        case "ready":
            return "";
        case "refused":
            return "";
    }
}

function FilesPane({
    state,
    onMap,
    onAdd,
}: {
    state: TmjImportSessionState;
    onMap(path: string): void;
    onAdd(): void;
}) {
    const { set, maps, map, files, importing } = state;
    return (
        <div className="import-dialog__source">
            <h3 className="import-dialog__heading">Files</h3>
            <p className="import-dialog__file" data-tmj-source="">
                {set.label}
            </p>
            {maps.length > 1 && map !== null ? (
                <Select
                    label="Map"
                    value={map}
                    onChange={onMap}
                    options={maps.map((path) => ({ value: path, label: path }))}
                />
            ) : (
                <p className="import-dialog__file" data-tmj-map="">
                    {map ?? ""}
                </p>
            )}
            <ul className="import-dialog__list tmj-dialog__files" data-tmj-files="">
                {files.map((file) => (
                    <li
                        key={file.path}
                        data-tmj-file={file.path}
                        data-tmj-status={file.found ? "found" : "missing"}
                    >
                        <span className="import-dialog__list-name" title={file.path}>
                            {file.path}
                        </span>
                        <span
                            className={
                                file.found
                                    ? "import-dialog__list-value"
                                    : "import-dialog__list-value tmj-dialog__missing"
                            }
                        >
                            {KIND_LABELS[file.kind]} · {file.found ? "Found" : "Missing"}
                        </span>
                    </li>
                ))}
            </ul>
            <div className="import-dialog__row">
                <Button disabled={importing} onClick={onAdd} data-tmj-add-files="">
                    Add files…
                </Button>
            </div>
        </div>
    );
}

function ReportPane({ state }: { state: TmjImportSessionState }) {
    const { report, refusal, phase } = state;
    const status = statusOf(state);
    return (
        <div className="import-dialog__form tmj-dialog__report" data-tmj-report="">
            <h3 className="import-dialog__heading">Report</h3>
            {status !== "" ? (
                <p className="import-dialog__summary" aria-live="polite" data-tmj-phase={phase}>
                    {status}
                </p>
            ) : null}
            {refusal !== null ? (
                <p className="import-dialog__message" role="alert" data-tmj-refusal="">
                    {refusal}
                </p>
            ) : null}
            {report ? (
                <>
                    <ul className="tmj-dialog__summary" data-tmj-summary="">
                        {summaryLines(report).map((line) => (
                            <li key={line}>{line}</li>
                        ))}
                    </ul>
                    {report.groups.length === 0 ? (
                        <p className="import-dialog__summary" data-tmj-clean="">
                            Nothing dropped or changed.
                        </p>
                    ) : (
                        <div className="tmj-dialog__groups">
                            {report.groups.map((group) => (
                                <section key={group.row} data-tmj-group={group.row}>
                                    <h4 className="tmj-dialog__group-title">
                                        {group.title}
                                        <span className="tmj-dialog__count">{group.count}</span>
                                    </h4>
                                    <ul className="tmj-dialog__entries">
                                        {group.entries.map((entry, index) => (
                                            <li key={`${entry.where}:${entry.detail}:${index}`}>
                                                <span>
                                                    {entry.detail}
                                                    {entry.count > 1 ? ` (${entry.count})` : ""}
                                                </span>
                                                <span className="tmj-dialog__where">
                                                    {entry.where}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            ))}
                        </div>
                    )}
                </>
            ) : null}
        </div>
    );
}

/**
 * Import Tiled Map (DESIGN §9; SPEC §13; TE-061), a large dialog: on the left what was picked,
 * the map (a choice when the files hold several) and the files it needs with their status
 * (found, missing) and Add files…; on the right the report: the summary, then every dropped or
 * changed item grouped by BRIEF §7 row with counts and locations, or why the map is refused.
 * Import is enabled once the report is there; it adds the map while the dialog stays open and
 * closes once it is added. Cancel adds nothing.
 */
export function ImportTiledMapDialog({ request }: { request: ImportTiledMapRequest }) {
    const { session } = request;
    const state = useStore(session.store);
    const { importing, failure } = state;
    const canImport = state.phase === "ready" && !importing;

    const confirm = async () => {
        if ((await session.confirm()) !== null) request.answer(true);
    };
    const addFiles = async () => {
        const files = await pickTmjFiles();
        if (files) await session.addFiles(files);
    };

    return (
        <Dialog
            open
            size="large"
            onOpenChange={(open) => {
                // Not while the map is being added: it would be added after all.
                if (!open && !importing) request.answer(null);
            }}
            title="Import Tiled Map"
            className="import-dialog tmj-dialog"
            actions={
                <>
                    <div className="import-dialog__status">
                        <p className="import-dialog__summary" aria-live="polite">
                            {importing ? "Importing…" : ""}
                        </p>
                        {failure ? (
                            <p className="import-dialog__message" role="alert" data-tmj-failure="">
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
                        data-tmj-confirm=""
                    >
                        Import
                    </Button>
                </>
            }
        >
            <div className="import-dialog__panes">
                <FilesPane
                    state={state}
                    onMap={(path) => session.chooseMap(path)}
                    onAdd={() => void addFiles()}
                />
                <ReportPane state={state} />
            </div>
        </Dialog>
    );
}
