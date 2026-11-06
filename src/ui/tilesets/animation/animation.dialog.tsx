import type { AnimationEditorRequest } from "../../../app/tilesets/animation/animationEditor";
import { commandDialog } from "../../dialogs/registry";
import { AnimationEditor } from "./AnimationEditor";

/** The Animation Editor (TE-030), shown by the dialog host. */
export const commandDialogs = [
    commandDialog<AnimationEditorRequest>("animation-editor", "Animation Editor", AnimationEditor),
];
