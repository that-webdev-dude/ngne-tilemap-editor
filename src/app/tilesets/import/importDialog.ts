import { commandDialogs } from "../../dialogs/dialogRequests";
import type { ImportSession } from "./importSession";

// The request of the Import Tileset dialog (DESIGN §9; TE-024). The workflow opens it and
// waits; the dialog host shows what `ui/import/import.dialog.tsx` registers for its kind. The
// session behind it does the work; the dialog only shows it and asks it.

export interface ImportTilesetRequest {
    kind: "import-tileset";
    session: ImportSession;
    /** True once the tileset is added, null when cancelled. Closes the dialog. */
    answer(values: true | null): void;
}

/** Opens the dialog for `session`; resolves true once the tileset is added. */
export async function askImportTileset(session: ImportSession): Promise<boolean> {
    const answer = await commandDialogs.open<true>((answer): ImportTilesetRequest => ({
        kind: "import-tileset",
        session,
        answer,
    }));
    return answer === true;
}
