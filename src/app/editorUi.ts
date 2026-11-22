// Declares `import.meta.glob` and the build facts wherever this module is compiled.
import type {} from "../import-meta";
import { createEditorUi } from "@ngne/editor-ui";
import type { AppInfo, EditorUiModules } from "@ngne/editor-ui";
import { setKeyContext } from "@ngne/editor-ui/commands";
import { PreferencesDialog } from "../ui/preferences/PreferencesDialog";
import type { StatusFieldInput } from "../ui/status/statusInput";
import { STAMP_PREVIEW_SIZE } from "../ui/tools/StampPreview";
import { EDITOR_CONTEXTS, MENU_BAR, PANEL_SELECTOR, STATE_CONTEXTS } from "./commands/commandTypes";
import type { Command, EditorContext, MenuBarMenu } from "./commands/commandTypes";
import { attachEditorUi } from "./editorUiHub";
import type { TilemapEditorUi } from "./editorUiHub";
import { keyContextStore } from "./keymap/contextState";
import type { OverlayFrame } from "./overlay/types";
import { projectOpen, sessionStore } from "./state/session";
import { withoutToolKeys } from "./tools/toolKeys";
import type { ToolModule, ToolSpec } from "./tools/types";

// The editor UI instance of the app (@ngne/editor-ui SPEC §5): identity, menus, key contexts,
// the bottom panel, the stamp preview's rail footer, the "no project open" gate and the module
// maps of the registries. Each registry's modules are found by one `import.meta.glob` line, so
// a feature joins as a new file with the registry's suffix (RULES 6). The modules it finds are
// evaluated while this module loads: they reach the instance through `editorUiHub.ts`.

type Modules = EditorUiModules<
    MenuBarMenu,
    EditorContext,
    ToolSpec,
    OverlayFrame,
    StatusFieldInput
>;

/** One module of a registry's map. */
type ModuleOf<Name extends keyof Modules> = Modules[Name][string];

/** The repository the About dialog links. */
const REPOSITORY_URL = "https://github.com/that-webdev-dude/ngne-tilemap-editor";

/** The build facts the About dialog shows (vite.config.ts, `appInfoDefines`). */
const appInfo: AppInfo = {
    packageName: import.meta.env.APP_PACKAGE,
    version: import.meta.env.APP_VERSION,
    licence: import.meta.env.APP_LICENSE,
    engine: {
        packageName: import.meta.env.ENGINE_PACKAGE,
        version: import.meta.env.ENGINE_VERSION,
    },
    repositoryUrl: REPOSITORY_URL,
    changelogUrl: `${REPOSITORY_URL}/blob/main/CHANGELOG.md`,
};

/**
 * The commands that act while no project is open (the empty state, TE-047): those that open
 * or create one, and Preferences. Every other command of the app is disabled until a project
 * opens, whatever its own `enabled` says: it acts on a project. The package's commands
 * (command palette, shortcut sheet, About, regions, bottom panel, licences) are outside the
 * gate.
 */
const WITHOUT_PROJECT =
    /^(file\.(newProject|open|openRecent\..+|clearRecent|importTiledMap)|edit\.preferences)$/;

export const editorUi: TilemapEditorUi = createEditorUi<
    MenuBarMenu,
    EditorContext,
    ToolSpec,
    OverlayFrame,
    StatusFieldInput
>({
    id: "ngne-tilemap-editor",
    productName: "NGNE Tilemap Editor",
    about: appInfo,
    menus: MENU_BAR,
    keyContexts: {
        order: EDITOR_CONTEXTS,
        state: STATE_CONTEXTS,
        focus: { panel: PANEL_SELECTOR },
    },
    bottomRegion: { id: "bottom-panel", label: "Bottom Panel" },
    railFooterHeight: STAMP_PREVIEW_SIZE,
    modules: {
        commands: import.meta.glob<ModuleOf<"commands">>("../**/*.commands.{ts,tsx}", {
            eager: true,
        }),
        dialogs: import.meta.glob<ModuleOf<"dialogs">>("../ui/**/*.dialog.tsx", { eager: true }),
        dock: import.meta.glob<ModuleOf<"dock">>("../ui/**/*.dock.tsx", { eager: true }),
        contextBars: import.meta.glob<ModuleOf<"contextBars">>("../ui/**/*.contextbar.tsx", {
            eager: true,
        }),
        // Without their keys, which the package's registry would refuse where the tool sets of
        // the layer kinds share them (`tools/toolKeys.ts`).
        tools: withoutToolKeys(
            import.meta.glob<ToolModule>("../**/*.tools.{ts,tsx}", { eager: true }),
        ),
        overlays: import.meta.glob<ModuleOf<"overlays">>("../**/*.overlay.{ts,tsx}", {
            eager: true,
        }),
        statusFields: import.meta.glob<ModuleOf<"statusFields">>("../**/*.status.{ts,tsx}", {
            eager: true,
        }),
    },
    // `enabled` and `title` functions read these stores; an open menu follows their changes. A
    // feature whose commands depend on a store of its own calls `appCommands.refresh()`.
    refreshOn: [sessionStore, keyContextStore],
    commandGate: (command: Command) => WITHOUT_PROJECT.test(command.id) || projectOpen(),
    surfaces: { preferences: PreferencesDialog },
});

attachEditorUi(editorUi);

// The state contexts follow the app's store (`keymap/contextState.ts`), which the features
// that own the state switch without importing this module.
function followKeyContexts(): void {
    const state = keyContextStore.getState();
    for (const context of STATE_CONTEXTS) setKeyContext(editorUi, context, state[context]);
}
followKeyContexts();
keyContextStore.subscribe(followKeyContexts);

/** The instance's command registry. */
export const appCommands = editorUi.commands;

/** The instance's overlay layers, in drawing order. */
export const overlayLayers = editorUi.overlayLayers;

/** The instance's status fields, left to right. */
export const statusFields = editorUi.statusFields;
