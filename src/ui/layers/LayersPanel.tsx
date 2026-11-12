import {
    ChevronDown,
    ChevronRight,
    Eye,
    EyeOff,
    Folder,
    Grid2x2,
    Image,
    Lock,
    LockOpen,
    MapPin,
    Plus,
    Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { activeMap } from "../../app/layers/layers";
import {
    activateLayer,
    applyLayerRename,
    cancelLayerRename,
    collapsedGroups,
    dropLayer,
    openLayerProperties,
    setFocusedLayerRow,
    setGroupCollapsed,
    setLayerRenameText,
    setLayersPanelMounted,
    startLayerRename,
    toggleLayerFlag,
    useLayersPanel,
} from "../../app/layers/layersPanel";
import { dropPlace, dropZone, layerRows } from "../../app/layers/layerTree";
import type { DropZone, LayerRow } from "../../app/layers/layerTree";
import { useShownSession } from "../../app/state/shownSession";
import { activeLayerId } from "../../app/tools/toolSets";
import { MAX_TEXT_LENGTH } from "../../core/model";
import { runCommand } from "../commands/runCommand";
import { useCommands } from "../commands/useCommands";
import { Icon, IconButton, Toggle } from "../primitives";
import { LayerPropertiesHost } from "./LayerProperties";
import "./layers.css";

// The Layers dock section (DESIGN §8.2; TE-035; pattern of the sprite editor's
// `ui/timeline/LayerRow.tsx`): the active map's layer tree, top of the stack first, in 28 px
// rows indented 12 px per group level: disclosure triangle (groups), type icon, name, opacity
// (shown on hover, focus and below 255; it opens the layer properties popover), visibility and
// lock toggles. The active layer's row is `--bg-active` with a 2 px accent bar; a row under a
// hidden or locked group has muted text. A click makes a layer active, a double click or F2
// renames it in place, a toggle is one undo step. A drag moves the layer to where it is
// dropped, one undo step: above or below a row, or into a group (its row's middle third).
// From the keyboard the tree is one tab stop: ↑ ↓ (Home, End) move between rows, ← collapses
// a group (or goes to its group), → expands it (or goes to its top child), Enter makes the
// row's layer active.

/** How far a press moves along the tree before it is a drag, in CSS pixels. */
const DRAG_THRESHOLD = 4;
/** Indentation per group level (DESIGN §8.2), in CSS pixels. */
const INDENT = 12;

const TYPE_ICONS: Record<LayerRow["type"], LucideIcon> = {
    tile: Grid2x2,
    marker: MapPin,
    image: Image,
    group: Folder,
};

const TYPE_NAMES: Record<LayerRow["type"], string> = {
    tile: "Tile layer",
    marker: "Marker layer",
    image: "Image layer",
    group: "Group",
};

/**
 * The rows and the active layer of the map shown (the active map, followed after the frame of a
 * switch: `shownSession`); renders again only when they change.
 */
function useRows(): { mapId: string | null; rows: readonly LayerRow[]; activeId: number | null } {
    const collapsed = useLayersPanel((state) => state.collapsed);
    // The selector also reads the collapsed groups: a change of them renders the panel again
    // (`collapsed` above), and the render runs the selector again.
    const key = useShownSession((state) => {
        const { session } = state;
        const map = session.project.maps.find((each) => each.id === state.mapId);
        if (!map) return "null";
        return JSON.stringify({
            mapId: map.id,
            activeId: activeLayerId(session, map),
            rows: layerRows(map.layers, collapsedGroups(map.id)),
        });
    });
    void collapsed;
    return useMemo(() => {
        const parsed = JSON.parse(key) as {
            mapId: string;
            activeId: number;
            rows: LayerRow[];
        } | null;
        return parsed ?? { mapId: null, rows: [], activeId: null };
    }, [key]);
}

const rowSelector = (id: number) => `[data-layer-row="${id}"]`;

/** The in-place rename of a row (double click, F2): Enter or leaving applies, Escape keeps. */
function RenameField({ text, onEnd }: { text: string; onEnd(): void }) {
    return (
        <input
            className="layers-panel__rename"
            type="text"
            aria-label="Layer name"
            autoComplete="off"
            spellCheck={false}
            maxLength={MAX_TEXT_LENGTH}
            autoFocus
            data-layer-rename=""
            value={text}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setLayerRenameText(event.target.value)}
            onKeyDown={(event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    applyLayerRename();
                    onEnd();
                } else if (event.key === "Escape") {
                    event.preventDefault();
                    // Not the canvas's Escape.
                    event.stopPropagation();
                    cancelLayerRename();
                    onEnd();
                }
            }}
            onBlur={() => void applyLayerRename()}
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
        />
    );
}

/** A drag in progress: the dragged layer and where it would be dropped (null: nowhere). */
interface Drag {
    readonly id: number;
    readonly target: DropTarget | null;
}

/** Where a drag would drop: the layer and zone it is dropped on, and the row that shows it. */
interface DropTarget {
    readonly id: number;
    readonly zone: DropZone;
    /** Whether the target group's children count as shown (below it: at their top). */
    readonly expanded: boolean;
    /** The row that shows the drop line: the target's, or the last row below the tree. */
    readonly rowId: number;
}

/** A press on a control of the row (toggle, opacity, disclosure) is the control's. */
function onControl(target: EventTarget | null): boolean {
    return (
        target instanceof Element && target.closest("button, input, [data-layer-control]") !== null
    );
}

export function LayersPanel() {
    const { mapId, rows, activeId } = useRows();
    const renaming = useLayersPanel((state) => state.renaming);
    const focusedId = useLayersPanel((state) => state.focusedId);
    const tree = useRef<HTMLDivElement>(null);
    const [drag, setDrag] = useState<Drag | null>(null);
    const stop = useRef<(() => void) | null>(null);
    /** A row that must have the focus once the tree has rendered (after a rename). */
    const refocus = useRef<number | null>(null);
    const ids = rows.map((row) => row.id);
    const stopId =
        focusedId !== null && ids.includes(focusedId)
            ? focusedId
            : activeId !== null && ids.includes(activeId)
              ? activeId
              : (ids[0] ?? null);

    useEffect(() => {
        setLayersPanelMounted(true);
        return () => setLayersPanelMounted(false);
    }, []);

    // A drag that is still going when the panel goes away ends with it.
    useLayoutEffect(() => () => stop.current?.(), []);

    useLayoutEffect(() => {
        const id = refocus.current;
        if (id === null || renaming) return;
        refocus.current = null;
        tree.current?.querySelector<HTMLElement>(rowSelector(id))?.focus({ preventScroll: true });
    });

    const focusRow = (id: number) =>
        tree.current?.querySelector<HTMLElement>(rowSelector(id))?.focus();

    // Where the focus goes when the popover's opener is gone: the tree's tab stop.
    const fallback = useCallback(() => {
        tree.current?.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')?.focus();
    }, []);

    const onKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
        if (event.target !== event.currentTarget) return;
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const row = rows[index]!;
        const last = rows.length - 1;
        let target: number;
        switch (event.key) {
            case "ArrowUp":
                target = Math.max(0, index - 1);
                break;
            case "ArrowDown":
                target = Math.min(last, index + 1);
                break;
            case "Home":
                target = 0;
                break;
            case "End":
                target = last;
                break;
            case "ArrowLeft":
                event.preventDefault();
                if (row.expanded) setGroupCollapsed(row.id, true);
                else if (row.parentId !== null) focusRow(row.parentId);
                return;
            case "ArrowRight":
                event.preventDefault();
                if (row.hasChildren && !row.expanded) setGroupCollapsed(row.id, false);
                else if (row.expanded) focusRow(rows[index + 1]!.id);
                return;
            case "Enter":
                event.preventDefault();
                activateLayer(row.id);
                return;
            default:
                return;
        }
        event.preventDefault();
        focusRow(rows[target]!.id);
    };

    const onPointerDown = (event: ReactPointerEvent<HTMLElement>, id: number) => {
        if (event.button !== 0 || onControl(event.target)) return;
        const element = tree.current;
        if (!element) return;
        const { pointerId, clientY: startY } = event;
        let moved = false;
        let target: Drag["target"] = null;
        const onMove = (move: PointerEvent) => {
            if (move.pointerId !== pointerId) return;
            if (!moved && Math.abs(move.clientY - startY) < DRAG_THRESHOLD) return;
            moved = true;
            target = dropTarget(element, id, move.clientY);
            setDrag({ id, target });
        };
        const end = (up: PointerEvent) => {
            if (up.pointerId !== pointerId) return;
            const place = target;
            stop.current?.();
            if (up.type !== "pointerup") return;
            // A click makes the layer active; a drag dropped is one undo step. A cancelled
            // pointer leaves the tree as it was.
            if (!moved) activateLayer(id);
            else if (place) dropLayer(id, place.id, place.zone, place.expanded);
        };
        stop.current?.();
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
        stop.current = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
            stop.current = null;
            setDrag(null);
        };
    };

    if (mapId === null) {
        return <p className="layers-panel__empty">No map is open.</p>;
    }

    return (
        <>
            <div
                ref={tree}
                className="layers-panel"
                role="tree"
                aria-label="Layers"
                data-layers-panel=""
                // F2 and the arrows belong to the panel (DESIGN §10.1, §10.3).
                data-keymap-panel=""
                data-dragging={drag ? "" : undefined}
                onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        setFocusedLayerRow(null);
                    }
                }}
            >
                {rows.map((row, index) => {
                    const active = row.id === activeId;
                    const editing = renaming?.id === row.id;
                    const drop = drag?.target?.rowId === row.id ? drag.target.zone : undefined;
                    return (
                        <div
                            key={row.id}
                            role="treeitem"
                            className="layers-panel__row"
                            aria-level={row.depth + 1}
                            aria-expanded={row.hasChildren ? row.expanded : undefined}
                            aria-selected={active}
                            aria-label={row.name}
                            tabIndex={row.id === stopId ? 0 : -1}
                            style={{
                                paddingLeft: `calc(var(--space-4) + ${row.depth * INDENT}px)`,
                            }}
                            data-layer-row={row.id}
                            data-layer-type={row.type}
                            data-depth={row.depth}
                            data-muted={row.muted ? "" : undefined}
                            data-drop={drop}
                            data-dragged={drag?.id === row.id ? "" : undefined}
                            onPointerDown={(event) => onPointerDown(event, row.id)}
                            // A press on a control (toggle, opacity, disclosure) focuses the
                            // row, not the control: the tree keeps its keys (↑ ↓, F2) and the
                            // popover gives the focus back to the row.
                            onMouseDown={(event) => {
                                if (!onControl(event.target)) return;
                                event.preventDefault();
                                event.currentTarget.focus({ preventScroll: true });
                            }}
                            onKeyDown={(event) => onKeyDown(event, index)}
                            onFocus={(event) => {
                                if (event.target === event.currentTarget) {
                                    setFocusedLayerRow(row.id);
                                }
                            }}
                        >
                            <span
                                className="layers-panel__disclosure"
                                aria-hidden="true"
                                data-layer-control=""
                                data-layer-disclosure={row.hasChildren ? "" : undefined}
                                onClick={() => {
                                    if (row.hasChildren) setGroupCollapsed(row.id, row.expanded);
                                }}
                            >
                                {row.hasChildren ? (
                                    <Icon icon={row.expanded ? ChevronDown : ChevronRight} />
                                ) : null}
                            </span>
                            <span className="layers-panel__type" title={TYPE_NAMES[row.type]}>
                                <Icon icon={TYPE_ICONS[row.type]} />
                            </span>
                            {editing ? (
                                <RenameField
                                    text={renaming.text}
                                    onEnd={() => {
                                        refocus.current = row.id;
                                    }}
                                />
                            ) : (
                                <span
                                    className="layers-panel__name"
                                    title={row.name}
                                    data-layer-name=""
                                    onDoubleClick={() => startLayerRename(row.id)}
                                >
                                    {row.name}
                                </span>
                            )}
                            <button
                                type="button"
                                className="layers-panel__opacity"
                                tabIndex={-1}
                                aria-label={`Opacity ${row.opacity}`}
                                aria-haspopup="dialog"
                                data-layer-opacity=""
                                data-partial={row.opacity < 255 ? "" : undefined}
                                onClick={() => openLayerProperties(row.id)}
                            >
                                {row.opacity}
                            </button>
                            <Toggle
                                className="layers-panel__toggle"
                                label="Visible"
                                tabIndex={-1}
                                pressed={row.visible}
                                data-layer-visible=""
                                onPressedChange={() => toggleLayerFlag(row.id, "visible")}
                            >
                                <Icon icon={row.visible ? Eye : EyeOff} />
                            </Toggle>
                            <Toggle
                                className="layers-panel__toggle"
                                label="Locked"
                                tabIndex={-1}
                                pressed={row.locked}
                                data-layer-locked=""
                                onPressedChange={() => toggleLayerFlag(row.id, "locked")}
                            >
                                <Icon icon={row.locked ? Lock : LockOpen} />
                            </Toggle>
                        </div>
                    );
                })}
            </div>
            <LayerPropertiesHost tree={tree} fallback={fallback} />
        </>
    );
}

/**
 * Where a drag of layer `id` with the pointer at `clientY` would drop: the row under the
 * pointer and the zone of the row it is in; above the tree, above the first row; below the
 * tree, at the bottom of the map (below its bottom layer, shown on the last row). Null where
 * the drop moves nothing or is not possible.
 */
function dropTarget(tree: HTMLElement, id: number, clientY: number): DropTarget | null {
    const map = activeMap();
    const elements = [...tree.querySelectorAll<HTMLElement>("[data-layer-row]")];
    if (!map || elements.length === 0) return null;
    const collapsed = collapsedGroups(map.id);
    const valid = (target: DropTarget) =>
        dropPlace(map, id, target.id, target.zone, target.expanded) ? target : null;
    const last = elements.at(-1)!;
    if (clientY >= last.getBoundingClientRect().bottom) {
        const bottom = map.layers[0]!.id;
        const rowId = Number(last.dataset.layerRow);
        return valid({ id: bottom, zone: "below", expanded: false, rowId });
    }
    const element = elements.find((each) => clientY < each.getBoundingClientRect().bottom) ?? last;
    const box = element.getBoundingClientRect();
    const targetId = Number(element.dataset.layerRow);
    const zone = dropZone(
        Math.max(0, clientY - box.top),
        box.height,
        element.dataset.layerType === "group",
    );
    return valid({ id: targetId, zone, expanded: !collapsed.has(targetId), rowId: targetId });
}

/** The New Tile Layer (+) button, its menu of the other kinds, and Delete (DESIGN §8.2). */
export function LayersHeader() {
    const commands = useCommands();
    const enabled = (id: string) =>
        commands.find((command) => command.id === id)?.enabled() ?? false;
    const variants = ["layer.newMarker", "layer.newImage", "layer.newGroup"].flatMap((id) => {
        const command = commands.find((each) => each.id === id);
        return command ? [command] : [];
    });
    return (
        <span className="layers-header">
            <IconButton
                label="New Tile Layer"
                shortcut="Shift+N"
                disabled={!enabled("layer.newTile")}
                data-new-layer=""
                onClick={() => runCommand("layer.newTile")}
            >
                <Icon icon={Plus} />
            </IconButton>
            <DropdownMenu.Root modal={false}>
                <DropdownMenu.Trigger asChild>
                    <IconButton label="New layer of another kind" data-new-layer-menu="">
                        <Icon icon={ChevronDown} />
                    </IconButton>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                    <DropdownMenu.Content
                        className="ui-menu"
                        align="end"
                        sideOffset={4}
                        collisionPadding={8}
                    >
                        {variants.map((command) => (
                            <DropdownMenu.Item
                                key={command.id}
                                className="ui-menu__item"
                                disabled={!command.enabled()}
                                data-new-layer-kind={command.id}
                                onSelect={() => runCommand(command.id)}
                            >
                                {command.title()}
                            </DropdownMenu.Item>
                        ))}
                    </DropdownMenu.Content>
                </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <IconButton
                label="Delete Layer"
                disabled={!enabled("layer.delete")}
                data-delete-layer=""
                onClick={() => runCommand("layer.delete")}
            >
                <Icon icon={Trash2} />
            </IconButton>
        </span>
    );
}
