import type {
    ContextBarContent as PackageContextBarContent,
    DockPanel as PackageDockPanel,
} from "@ngne/editor-ui/shell";
import type { ComponentType } from "react";

// The entries of the package's registries this editor's `*.dock.tsx` and `*.contextbar.tsx`
// modules export, with React components as their content (@ngne/editor-ui SPEC §1.3).

/** A section of the right dock: `dockPanel` of a `*.dock.tsx` module. */
export type DockPanel = PackageDockPanel<ComponentType>;

/** Content that takes the context bar's options' place: `contextBarContent` of a `*.contextbar.tsx` module. */
export type ContextBarContent = PackageContextBarContent<ComponentType>;
