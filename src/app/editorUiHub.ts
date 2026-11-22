import type { EditorUi } from "@ngne/editor-ui";
import type { CommandRegistry } from "@ngne/editor-ui/commands";
import type { StatusFieldInput } from "../ui/status/statusInput";
import type { EditorContext, MenuBarMenu } from "./commands/commandTypes";
import type { OverlayFrame } from "./overlay/types";
import type { ToolSpec } from "./tools/types";

// The app's handle on its editor UI instance (`editorUi.ts`) for the modules that instance
// discovers: the command, tool, dialog, dock, context-bar, overlay and status modules are
// evaluated while `editorUi.ts` builds the instance, so none of them can import it. They, and
// the modules they import, reach the instance through this module at call time instead.
// `editorUi.ts` attaches it once built.

/** This editor's instance of `@ngne/editor-ui`, with its menus, contexts, tools and inputs. */
export type TilemapEditorUi = EditorUi<
    MenuBarMenu,
    EditorContext,
    ToolSpec,
    OverlayFrame,
    StatusFieldInput
>;

let attached: TilemapEditorUi | null = null;

/** Called once by `editorUi.ts` with the instance it built. */
export function attachEditorUi(editorUi: TilemapEditorUi): void {
    attached = editorUi;
}

/** The instance; throws while `editorUi.ts` has not built it yet. */
export function editorUiInstance(): TilemapEditorUi {
    if (!attached)
        throw new Error("The editor UI instance is not built yet (src/app/editorUi.ts).");
    return attached;
}

type AppCommandRegistry = CommandRegistry<MenuBarMenu, EditorContext>;

/**
 * The instance's command registry, for the modules that cannot import `editorUi.ts`. Before
 * the instance is built there are no commands: `get` finds none, `list` is empty and
 * `refresh` does nothing.
 */
export const appCommands: Pick<
    AppCommandRegistry,
    "get" | "list" | "refresh" | "register" | "subscribe" | "version"
> = {
    get: (id) => attached?.commands.get(id),
    list: () => attached?.commands.list() ?? [],
    refresh: () => attached?.commands.refresh(),
    register: (spec, source) => editorUiInstance().commands.register(spec, source),
    subscribe: (listener) => editorUiInstance().commands.subscribe(listener),
    version: () => attached?.commands.version() ?? 0,
};
