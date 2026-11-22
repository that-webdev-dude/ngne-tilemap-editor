import type { CollisionEditorRequest } from "../../../app/tilesets/collision/collisionEditor";
import { commandDialog } from "@ngne/editor-ui/messages";
import { CollisionEditor } from "./CollisionEditor";

/** The Collision Editor (TE-029), shown by the dialog host. */
export const commandDialogs = [
    commandDialog<CollisionEditorRequest>("collision-editor", "Collision Editor", CollisionEditor),
];
