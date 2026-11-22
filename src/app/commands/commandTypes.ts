import type {
    Command as PackageCommand,
    CommandModule as PackageCommandModule,
    CommandSpec as PackageCommandSpec,
    ContextMenuPlacement,
    KeyContext as PackageKeyContext,
    PlannedCommandSpec as PackagePlannedCommandSpec,
} from "@ngne/editor-ui/commands";

// This editor's menus and key contexts (DESIGN §5, §10.1), which `src/app/editorUi.ts` passes to
// `createEditorUi`, and the package's command types bound to them. A feature registers its
// commands from a module named `*.commands.ts` (or `.tsx`) anywhere under `src`, which exports
// `commands` (`CommandSpec`) and `plannedCommands` (`PlannedCommandSpec`); `editorUi.ts` finds
// the module with a glob import, so no shared file is edited (RULES 6):
//
//     // src/app/layers/layers.commands.ts
//     export const commands: CommandSpec[] = [
//         { id: "layer.newTile", title: "New Tile Layer", shortcut: "Shift+N", run: newLayer },
//     ];

/** The menus of the menu bar, in order (DESIGN §5); the package's Help menu ends it. */
export const MENU_BAR = [
    "File",
    "Edit",
    "Map",
    "Layer",
    "Tileset",
    "Select",
    "View",
    "Help",
] as const;
export type MenuBarMenu = (typeof MENU_BAR)[number];

/**
 * This editor's key contexts of DESIGN §10.1, highest priority first; the package puts them
 * between its `text` and its `canvas` and `global`.
 */
export const EDITOR_CONTEXTS = ["gesture", "markers", "panel"] as const;
export type EditorContext = (typeof EDITOR_CONTEXTS)[number];

/** The contexts that follow editor state instead of focus (`keymap/contextState.ts`). */
export const STATE_CONTEXTS = ["gesture", "markers"] as const satisfies readonly EditorContext[];

/** Every key context, highest priority first. */
export const KEY_CONTEXTS = ["text", ...EDITOR_CONTEXTS, "canvas", "global"] as const;
export type KeyContext = PackageKeyContext<EditorContext>;

/**
 * The `panel` context applies inside the bottom panel (`data-region="bottom-panel"`: the
 * Tilesets and Terrains panels) and inside any element marked `data-keymap-panel` (the Layers
 * tree in the dock). It is also the panel selector of the package's return-focus rule.
 */
export const PANEL_ATTRIBUTE = "data-keymap-panel";
export const PANEL_SELECTOR = `[data-region="bottom-panel"], [${PANEL_ATTRIBUTE}]`;

export type CommandSpec = PackageCommandSpec<MenuBarMenu, EditorContext>;
export type PlannedCommandSpec = PackagePlannedCommandSpec<MenuBarMenu>;
export type CommandModule = PackageCommandModule<MenuBarMenu, EditorContext>;
export type Command = PackageCommand<MenuBarMenu, EditorContext>;
export type { ContextMenuPlacement };
export { DEFAULT_MENU_ORDER } from "@ngne/editor-ui/commands";
