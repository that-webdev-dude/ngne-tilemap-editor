import { transformStamp } from "../../../core/cells";
import type { StampTransform } from "../../../core/cells";
import { appCommands } from "../../commands/appCommands";
import type { CommandSpec } from "../../commands/types";
import { toolState } from "../activeTool";
import { currentStamp, currentStampStore, setCurrentStamp } from "./currentStamp";

// The stamp transforms (SPEC §4.2, §2.3): flip and rotate the current stamp as a whole, in the
// Tileset menu (DESIGN §5), on R, Shift+R, F, Shift+F with a tile layer active (DESIGN §10.3)
// and on the context bar of the tools that paint the stamp (`STAMP_TRANSFORM_ACTIONS`). They
// change the stamp only: no history entry, the map as it was. Their menu items are planned in
// `commands/planned.commands.ts`.

function transformCommand(
    id: string,
    title: string,
    shortcut: string,
    transform: StampTransform,
): CommandSpec {
    return {
        id,
        title,
        shortcut,
        context: "canvas",
        enabled: () => currentStamp() !== null && toolState.kind() === "tile",
        run() {
            const stamp = currentStamp();
            if (stamp) setCurrentStamp(transformStamp(stamp, transform));
        },
    };
}

export const commands: CommandSpec[] = [
    transformCommand("stamp.flipHorizontal", "Flip Stamp Horizontally", "F", "flipH"),
    transformCommand("stamp.flipVertical", "Flip Stamp Vertically", "Shift+F", "flipV"),
    transformCommand("stamp.rotateRight", "Rotate Stamp Right", "R", "rotateRight"),
    transformCommand("stamp.rotateLeft", "Rotate Stamp Left", "Shift+R", "rotateLeft"),
];

// The commands are enabled by the current stamp.
currentStampStore.subscribe(() => appCommands.refresh());
