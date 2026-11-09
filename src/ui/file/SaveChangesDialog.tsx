import type { SaveChangesRequest } from "../../app/file/dialogs";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";

/** What happens to the project, said after "“name” has unsaved changes." */
function consequence({ action, file }: SaveChangesRequest): string {
    switch (action) {
        case "new":
            return "The new project takes its place.";
        case "open":
            return `“${file ?? ""}” takes its place.`;
        case "close":
            return "Closing it loses them unless they are saved.";
    }
}

/**
 * Asked once before New Project, Open or Close Project takes an unsaved project away (SPEC
 * §10.1: one project per window; Tiled's Save / Discard / Cancel). Save saves it first, then
 * goes on; Discard goes on; Cancel, Escape and a click outside keep the project.
 */
export function SaveChangesDialog({ request }: { request: SaveChangesRequest }) {
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) request.answer(null);
            }}
            title="Save changes?"
            actions={
                <>
                    <Button onClick={() => request.answer(null)}>Cancel</Button>
                    <Button variant="danger" onClick={() => request.answer("discard")}>
                        Discard
                    </Button>
                    <Button variant="primary" onClick={() => request.answer("save")}>
                        Save
                    </Button>
                </>
            }
        >
            <p>
                “{request.project}” has unsaved changes. {consequence(request)}
            </p>
        </Dialog>
    );
}
