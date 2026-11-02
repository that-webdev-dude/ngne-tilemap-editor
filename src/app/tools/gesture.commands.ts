import type { CommandSpec } from "../commands/types";
import { toolPipeline } from "./appPipeline";

// The `gesture` context of DESIGN §10.1: while a tool's gesture of several presses is open
// (shape fill, polygon and polyline markers, the terrain line), Enter closes it. Escape cancels
// it through `tool.cancel` (tools.commands.ts), as it cancels a stroke; a double click on the
// canvas closes it too (`attachToolPointer`).

export const commands: CommandSpec[] = [
    {
        id: "tool.gesture.close",
        title: "Close Gesture",
        shortcut: "Enter",
        context: "gesture",
        enabled: () => toolPipeline.gesture,
        run: () => void toolPipeline.closeGesture(),
    },
];
