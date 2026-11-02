import { normalizeChord } from "../commands/chord";
import { appCommands } from "../commands/appCommands";
import type { CommandSpec } from "../commands/types";
import { isNativeKeyChord } from "../keymap/keyClasses";
import { viewSurface } from "../view/viewNavigation";
import { toolState } from "./activeTool";
import { toolPipeline } from "./appPipeline";
import { toolRegistry } from "./toolRegistry";
import type { Tool } from "./types";

// The keys of the tools (DESIGN §10.3), made from the tool registry so that a tool's own module
// brings its key: each registered tool has a command that selects it, bound to its key in the
// `canvas` context and enabled while the active layer's tool set holds it (DESIGN §10.2: one
// letter may name a tile tool and a marker tool), and one that makes it the active tool while
// its hold key is down. Escape cancels the stroke in progress. A tool whose rail slot has a
// variant with a key of the same letter also has a command on its key that selects that
// variant while the tool is selected (U toggles rectangle and ellipse fill); the two are
// enabled in turn.
//
// A held key that controls consume natively (Space) acts only while the viewport element
// itself has the focus. No hold acts while a gesture of several presses is open: it would
// change the active tool, which cancels the gesture.

/** Whether the viewport element itself has the focus. */
function viewportFocused(): boolean {
    const surface = viewSurface();
    return surface !== null && surface.ownerDocument.activeElement === surface;
}

/** The command that selects `tool`: "tool.hand". */
export function selectCommandId(tool: Pick<Tool, "id">): string {
    return `tool.${tool.id}`;
}

/** The command of `tool`'s hold key: "tool.hand.hold". */
export function holdCommandId(tool: Pick<Tool, "id">): string {
    return `tool.${tool.id}.hold`;
}

/** The command of `tool`'s key pressed again: "tool.shapeFill.next". */
export function nextVariantCommandId(tool: Pick<Tool, "id">): string {
    return `tool.${tool.id}.next`;
}

/** Whether `tool`'s key pressed now switches its rail slot's variant. */
function switches(tool: Tool): boolean {
    return toolState.selectedId() === tool.id && toolState.nextVariant(tool.id) !== null;
}

function selectCommand(tool: Tool): CommandSpec {
    return {
        id: selectCommandId(tool),
        title: `${tool.label} Tool`,
        shortcut: tool.shortcut,
        context: "canvas",
        // Exactly this tool, while the active layer's set holds it. While its key switches
        // the variant instead, the command of that takes the key, and this one is inert.
        enabled: () => toolState.offered(tool.id) && !switches(tool),
        run: () => void toolState.select(tool.id),
    };
}

function nextVariantCommand(tool: Tool): CommandSpec[] {
    if (!tool.shortcut || toolState.nextVariant(tool.id) === null) return [];
    return [
        {
            id: nextVariantCommandId(tool),
            title: `${tool.label} Tool: Next Variant`,
            shortcut: tool.shortcut,
            context: "canvas",
            enabled: () => switches(tool),
            run() {
                const next = toolState.nextVariant(tool.id);
                if (next) toolState.select(next.id);
            },
        },
    ];
}

function holdCommand(tool: Tool): CommandSpec[] {
    const { hold } = tool;
    if (!hold) return [];
    const native = isNativeKeyChord(normalizeChord(hold.key));
    return [
        {
            id: holdCommandId(tool),
            title: `Temporary ${tool.label}`,
            shortcut: hold.key,
            context: "canvas",
            enabled: () =>
                toolState.offered(tool.id) &&
                !toolPipeline.gesture &&
                (!native || viewportFocused()) &&
                (hold.when?.(toolState.selected()) ?? true),
            run: () => toolState.hold(tool.id),
            release: () => toolState.release(tool.id),
        },
    ];
}

export const commands: CommandSpec[] = [
    ...toolRegistry
        .list()
        .flatMap((tool) => [
            selectCommand(tool),
            ...nextVariantCommand(tool),
            ...holdCommand(tool),
        ]),
    {
        id: "tool.cancel",
        title: "Cancel Stroke",
        shortcut: "Escape",
        context: "canvas",
        enabled: () => toolPipeline.stroking,
        run: () => void toolPipeline.cancel(),
    },
];

// The commands are enabled by the tool state: the active layer's kind and the selected tool.
toolState.subscribe(() => appCommands.refresh());
