import type { TilesetSourceKind } from "../../../core/model";
import { tilesetFieldProblems, tilesetPropertiesCommand } from "../../../core/tileset";
import type { TilesetFields } from "../../../core/tileset";
import { commandDialogs } from "../../dialogs/dialogRequests";
import { sessionStore } from "../../state/session";
import { currentTileset, historyIdle, runTilesetCommand } from "./tilesetEdit";

// Tileset → Tileset Properties… (DESIGN §9; TE-026): name, export name, class and tile offset
// of the shown tileset, and its source read-only. As the sprite editor's Sprite Properties,
// nothing changes until OK, and OK applies every changed field as one undo step (none when
// nothing changed); the dialog only shows and asks.

/** The read-only source fields of the dialog. */
export interface TilesetSourceView {
    kind: TilesetSourceKind;
    fileName: string;
    tileWidth: number;
    tileHeight: number;
    margin: number;
    spacing: number;
}

export interface TilesetPropertiesRequest {
    kind: "tileset-properties";
    initial: TilesetFields;
    source: TilesetSourceView;
    /** Why `values` cannot be applied, by field; empty when they can. */
    problems(values: TilesetFields): Partial<Record<keyof TilesetFields, string>>;
    /** The values to apply, or null to cancel. Closes the dialog. */
    answer(values: TilesetFields | null): void;
}

/** Opens the dialog on the shown tileset and applies its answer. Resolves true on a change. */
export async function editTilesetProperties(): Promise<boolean> {
    const tileset = currentTileset();
    if (!tileset) return false;
    const { id, name, exportName, offsetX, offsetY, source } = tileset;
    const values = await commandDialogs.open<TilesetFields>((answer): TilesetPropertiesRequest => ({
        kind: "tileset-properties",
        initial: { name, exportName, class: tileset.class, offsetX, offsetY },
        source: {
            kind: source.kind,
            fileName: source.fileName,
            tileWidth: tileset.tileWidth,
            tileHeight: tileset.tileHeight,
            margin: source.margin,
            spacing: source.spacing,
        },
        problems: (values) =>
            tilesetFieldProblems(sessionStore.getState().session.project, id, values),
        answer,
    }));
    if (!values || !historyIdle()) return false;
    const { project } = sessionStore.getState().session;
    if (!project.tilesets.some((each) => each.id === id)) return false;
    const command = tilesetPropertiesCommand(project, id, values);
    return command ? runTilesetCommand(command) : false;
}
