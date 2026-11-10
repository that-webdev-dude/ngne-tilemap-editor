import type { ExportOverwriteRequest } from "../../app/export/dialogs";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";
import "./export.css";

/**
 * Asked before a project's export first writes into a folder that is not the project's (SPEC
 * §10.2): the folder holds another project's marker, which names that project, or files of the
 * export's names without a marker. It names the files the export would replace. Cancel, Escape
 * and a click outside write nothing.
 */
export function ExportOverwriteDialog({ request }: { request: ExportOverwriteRequest }) {
    const count = request.files.length;
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) request.answer(null);
            }}
            title="Replace files?"
            actions={
                <>
                    <Button onClick={() => request.answer(null)}>Cancel</Button>
                    <Button variant="danger" onClick={() => request.answer(true)}>
                        Replace
                    </Button>
                </>
            }
        >
            <p data-overwrite-owner="">
                {request.owner === null
                    ? `The folder “${request.folder}” holds files of this export, and no project's marker.`
                    : `The folder “${request.folder}” holds the export of “${request.owner}”.`}
            </p>
            <p>
                Exporting “{request.project}” replaces{" "}
                {count === 1 ? "this file" : `these ${count} files`}:
            </p>
            <ul className="export-overwrite__files" data-overwrite-files="">
                {request.files.map((name) => (
                    <li key={name}>{name}</li>
                ))}
            </ul>
        </Dialog>
    );
}
