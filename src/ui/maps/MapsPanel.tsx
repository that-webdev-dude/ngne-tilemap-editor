import { Ellipsis, Plus } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import {
    MAP_MENU,
    applyMapRename,
    cancelMapRename,
    reorderMap,
    setFocusedMapRow,
    setMapRenameText,
    startMapRename,
    useMapsPanel,
} from "../../app/maps/mapsPanel";
import { useSession } from "../../app/state/session";
import { activateMap, useMapTabs } from "../../app/tabs/tabs";
import { MAX_TEXT_LENGTH } from "../../core/model";
import { contextMenuEntries } from "../commands/contextMenu";
import { runCommand } from "../commands/runCommand";
import { useCommands } from "../commands/useCommands";
import { ContextMenu, Icon, IconButton } from "../primitives";
import type { ContextMenuEntry } from "../primitives";
import "./maps.css";

// The Maps dock section (DESIGN §8.1; TE-032): one row per map of the project in list order,
// with its name, a dot while it has a tab, and its size in cells. A click opens the map (or
// selects its tab); a double click or F2 renames it in place; a drag along the list moves it to
// another place of the map list, one undo step when it is dropped, and opens nothing. The row
// menu (right click, the Menu key, or the overflow button) lists Map Properties…, Duplicate and
// Delete for the row's map, which opening it shows. From the keyboard the list is one tab stop:
// the arrow keys, Home and End move between rows, Enter or Space opens the row's map.

/** What a row shows of a map. */
interface Row {
    readonly id: string;
    readonly name: string;
    readonly width: number;
    readonly height: number;
}

/** How far a press moves along the list before it is a drag, in CSS pixels. */
const DRAG_THRESHOLD = 4;

/** The rows and the active map; renders again only when one of them changes. */
function useRows(): { rows: readonly Row[]; activeId: string } {
    const key = useSession((state) => {
        const { project, activeMapId } = state.session;
        return JSON.stringify([
            activeMapId,
            project.maps.map((map) => [map.id, map.name, map.width, map.height]),
        ]);
    });
    return useMemo(() => {
        const [activeId, rows] = JSON.parse(key) as [string, [string, string, number, number][]];
        return {
            activeId,
            rows: rows.map(([id, name, width, height]) => ({ id, name, width, height })),
        };
    }, [key]);
}

const rowSelector = (id: string) => `[data-map-row="${CSS.escape(id)}"]`;

/** The in-place rename of a row (double click, F2): Enter or leaving applies, Escape keeps. */
function RenameField({ text, onEnd }: { text: string; onEnd(): void }) {
    return (
        <input
            className="maps-panel__rename"
            type="text"
            aria-label="Map name"
            autoComplete="off"
            spellCheck={false}
            maxLength={MAX_TEXT_LENGTH}
            autoFocus
            data-map-rename=""
            value={text}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setMapRenameText(event.target.value)}
            onKeyDown={(event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    applyMapRename();
                    onEnd();
                } else if (event.key === "Escape") {
                    event.preventDefault();
                    // Not the dialog's or the canvas's Escape.
                    event.stopPropagation();
                    cancelMapRename();
                    onEnd();
                }
            }}
            onBlur={() => void applyMapRename()}
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
        />
    );
}

/**
 * The overflow button of a row: the row menu for the pointer. It is no control of its own (an
 * option holds none), as a map tab's close control: the keyboard opens the same menu with the
 * Menu key on the row.
 */
function RowMenuButton({ id, entries }: { id: string; entries: readonly ContextMenuEntry[] }) {
    return (
        <DropdownMenu.Root
            modal={false}
            // The menu acts on the active map: the row's own.
            onOpenChange={(open) => {
                if (open) activateMap(id);
            }}
        >
            <DropdownMenu.Trigger asChild disabled={entries.length === 0}>
                <span
                    className="ui-icon-button maps-panel__menu-button"
                    aria-hidden="true"
                    title="Map menu"
                    data-map-row-menu=""
                    onPointerDown={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                >
                    <Icon icon={Ellipsis} />
                </span>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
                <DropdownMenu.Content
                    className="ui-menu"
                    align="end"
                    sideOffset={4}
                    collisionPadding={8}
                >
                    {entries.map((entry) =>
                        entry.type === "separator" ? (
                            <DropdownMenu.Separator key={entry.id} className="ui-menu__separator" />
                        ) : (
                            <DropdownMenu.Item
                                key={entry.id}
                                className="ui-menu__item"
                                disabled={entry.disabled}
                                onSelect={entry.onSelect}
                            >
                                {entry.label}
                                {entry.shortcut ? (
                                    <span className="ui-menu__shortcut">{entry.shortcut}</span>
                                ) : null}
                            </DropdownMenu.Item>
                        ),
                    )}
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
}

/** A drag in progress: the dragged map and the place it would take. */
interface Drag {
    readonly id: string;
    readonly to: number;
}

export function MapsPanel() {
    const { rows, activeId } = useRows();
    const open = useMapTabs((state) => state.open);
    const renaming = useMapsPanel((state) => state.renaming);
    const focusedId = useMapsPanel((state) => state.focusedId);
    const commands = useCommands();
    const entries = contextMenuEntries(MAP_MENU, commands);
    const list = useRef<HTMLDivElement>(null);
    const [drag, setDrag] = useState<Drag | null>(null);
    const stop = useRef<(() => void) | null>(null);
    /** A row that must have the focus once the list has rendered (after a rename). */
    const refocus = useRef<string | null>(null);
    const ids = rows.map((row) => row.id);
    const stopId = ids.includes(focusedId ?? "")
        ? focusedId
        : ids.includes(activeId)
          ? activeId
          : (ids[0] ?? null);

    // A drag that is still going when the panel goes away ends with it.
    useLayoutEffect(() => () => stop.current?.(), []);

    useLayoutEffect(() => {
        const id = refocus.current;
        if (id === null || renaming) return;
        refocus.current = null;
        list.current?.querySelector<HTMLElement>(rowSelector(id))?.focus({ preventScroll: true });
    });

    const focusRow = (id: string) =>
        list.current?.querySelector<HTMLElement>(rowSelector(id))?.focus();

    const onKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
        if (event.target !== event.currentTarget) return;
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const last = rows.length - 1;
        const target =
            event.key === "ArrowUp"
                ? Math.max(0, index - 1)
                : event.key === "ArrowDown"
                  ? Math.min(last, index + 1)
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? last
                      : null;
        if (target !== null) {
            event.preventDefault();
            focusRow(rows[target]!.id);
        } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            activateMap(rows[index]!.id);
        }
    };

    const onPointerDown = (event: ReactPointerEvent<HTMLElement>, id: string) => {
        if (event.button !== 0) return;
        const element = list.current;
        if (!element) return;
        const { pointerId, clientY: startY } = event;
        let to: number | null = null;
        const onMove = (move: PointerEvent) => {
            if (move.pointerId !== pointerId) return;
            if (to === null && Math.abs(move.clientY - startY) < DRAG_THRESHOLD) return;
            // The place among the other rows: after every row whose middle is above the pointer.
            const others = [...element.querySelectorAll<HTMLElement>("[data-map-row]")]
                .filter((row) => row.dataset.mapRow !== id)
                .map((row) => row.getBoundingClientRect());
            to = others.filter((box) => box.top + box.height / 2 < move.clientY).length;
            setDrag({ id, to });
        };
        const end = (up: PointerEvent) => {
            if (up.pointerId !== pointerId) return;
            const place = to;
            stop.current?.();
            if (up.type !== "pointerup") return;
            // A click opens the map; a drag dropped is one undo step and opens nothing. A
            // cancelled pointer leaves the list as it was.
            if (place === null) activateMap(id);
            else reorderMap(id, place);
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

    /** Where the drop line sits: before the row at this index of the list without the dragged row. */
    const dropBefore = (() => {
        if (!drag) return null;
        const others = ids.filter((id) => id !== drag.id);
        return others[drag.to] ?? "end";
    })();

    return (
        <div
            ref={list}
            className="maps-panel"
            role="listbox"
            aria-label="Maps"
            data-maps-panel=""
            // F2 and the arrows belong to the panel (DESIGN §10.1, §10.3).
            data-keymap-panel=""
            data-dragging={drag ? "" : undefined}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setFocusedMapRow(null);
                }
            }}
        >
            {rows.map((row, index) => {
                const active = row.id === activeId;
                const tabbed = open.includes(row.id);
                const editing = renaming?.id === row.id;
                return (
                    <ContextMenu
                        key={row.id}
                        items={entries}
                        disabled={entries.length === 0 || editing}
                    >
                        <div
                            role="option"
                            className="maps-panel__row"
                            aria-selected={active}
                            tabIndex={row.id === stopId ? 0 : -1}
                            data-map-row={row.id}
                            data-drop-before={dropBefore === row.id ? "" : undefined}
                            data-drop-after={
                                dropBefore === "end" && index === rows.length - 1 ? "" : undefined
                            }
                            data-dragged={drag?.id === row.id ? "" : undefined}
                            onPointerDown={(event) => onPointerDown(event, row.id)}
                            onDoubleClick={() => startMapRename(row.id)}
                            // The menu acts on the active map: the row's own.
                            onContextMenu={() => activateMap(row.id)}
                            onKeyDown={(event) => onKeyDown(event, index)}
                            onFocus={() => setFocusedMapRow(row.id)}
                        >
                            {editing ? (
                                <RenameField
                                    text={renaming.text}
                                    onEnd={() => {
                                        refocus.current = row.id;
                                    }}
                                />
                            ) : (
                                <span className="maps-panel__name" title={row.name}>
                                    {row.name}
                                </span>
                            )}
                            <span
                                className="maps-panel__dot"
                                data-open-tab={tabbed ? "" : undefined}
                                title={tabbed ? "Open in a tab" : undefined}
                            >
                                {tabbed ? <span className="ui-visually-hidden">Open</span> : null}
                            </span>
                            <span className="maps-panel__size" data-map-size="">
                                {row.width} × {row.height}
                            </span>
                            <RowMenuButton id={row.id} entries={entries} />
                        </div>
                    </ContextMenu>
                );
            })}
        </div>
    );
}

/** The header's New Map (+) button (DESIGN §8.1). */
export function NewMapButton() {
    const commands = useCommands();
    const enabled = commands.find((command) => command.id === "file.newMap")?.enabled() ?? false;
    return (
        <IconButton
            label="New Map…"
            shortcut="Ctrl+Alt+M"
            disabled={!enabled}
            data-new-map=""
            onClick={() => runCommand("file.newMap")}
        >
            <Icon icon={Plus} />
        </IconButton>
    );
}
