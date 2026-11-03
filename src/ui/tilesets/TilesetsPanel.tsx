import { Ellipsis, Plus } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { usePreference } from "../../app/preferences/preferences";
import { useSession } from "../../app/state/session";
import { installTilesetDrop } from "../../app/tilesets/import/tilesetDrop";
import {
    PANEL_ZOOMS,
    gridLayout,
    gridPointAt,
    shownTile,
    tileIndex,
    tileLabel,
    tileOrigin,
} from "../../app/tilesets/panel/tileGrid";
import type { GridLayout, GridPoint, PanelZoom } from "../../app/tilesets/panel/tileGrid";
import {
    selectionRect,
    shownTileset,
    tilesetPanel,
    tilesetPanelStore,
    useTilesetPanel,
} from "../../app/tilesets/panel/tilesetPanel";
import type { Tileset } from "../../core/model";
import { contextMenuEntries } from "../commands/contextMenu";
import { runCommand } from "../commands/runCommand";
import { useCommands } from "../commands/useCommands";
import { ContextMenu, Icon, IconButton, Select } from "../primitives";
import { useTheme } from "../theme/theme";
import { paintTileGrid } from "./paintTileGrid";
import type { GridColours } from "./paintTileGrid";
import "./tilesetsPanel.css";

// The Tilesets panel (SPEC §6.2, DESIGN §8.5): tabs per tileset with New Tileset (+), the class
// filter and the zoom on the right, and the tile grid. A click or a drag over the grid selects
// a rectangle of tiles, which is the current stamp at every change (Tiled's `TilesetDock`);
// from the keyboard the grid is one tab stop, arrows move the selection, Shift extends it and
// Enter makes the stamp. The tile
// menu (Menu key, right click, overflow button) lists the commands registered for the context
// menu "tile" (`contextMenus: [{ menu: "tile" }]`): the tile editors (TE-029, TE-030) and
// Properties (TE-040) add to it. Files dropped on the panel are imported as tilesets.

/** The context menu the tile menu lists (`CommandSpec.contextMenus`). */
export const TILE_MENU = "tile";

const ZOOM_OPTIONS = PANEL_ZOOMS.map((zoom) => ({ value: String(zoom), label: `${zoom}×` }));

function hex(value: number): string {
    return `#${value.toString(16).padStart(6, "0")}`;
}

/** The grid's colours: the theme's tokens, the checkerboard as the viewport's preference. */
function readColours(element: Element, checker: "theme" | { a: number; b: number }): GridColours {
    const style = getComputedStyle(element);
    const token = (name: string) => style.getPropertyValue(name).trim();
    return {
        border: token("--border"),
        accent: token("--accent"),
        text: token("--text"),
        textMuted: token("--text-muted"),
        panel: token("--bg-panel"),
        checkA: checker === "theme" ? token("--check-a") : hex(checker.a),
        checkB: checker === "theme" ? token("--check-b") : hex(checker.b),
    };
}

/** Arrow keys and the move they make. */
const ARROWS: Readonly<Record<string, [number, number]>> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
};

function TilesetTabs({ tilesets, shown }: { tilesets: readonly Tileset[]; shown: Tileset | null }) {
    const list = useRef<HTMLDivElement>(null);
    const focusTab = (id: string) =>
        list.current?.querySelector<HTMLElement>(`[data-tileset-tab="${CSS.escape(id)}"]`)?.focus();
    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        const target =
            event.key === "ArrowLeft"
                ? index - 1
                : event.key === "ArrowRight"
                  ? index + 1
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? tilesets.length - 1
                      : null;
        if (target === null) return;
        event.preventDefault();
        const next = tilesets[(target + tilesets.length) % tilesets.length];
        if (!next) return;
        tilesetPanel.showTileset(next.id);
        focusTab(next.id);
    };
    return (
        <div ref={list} className="tilesets-panel__tabs" role="tablist" aria-label="Tilesets">
            {tilesets.map((tileset, index) => {
                const selected = tileset === shown;
                return (
                    <button
                        key={tileset.id}
                        type="button"
                        role="tab"
                        className="tilesets-panel__tab"
                        aria-selected={selected}
                        tabIndex={selected ? 0 : -1}
                        data-tileset-tab={tileset.id}
                        onClick={() => tilesetPanel.showTileset(tileset.id)}
                        onKeyDown={(event) => onKeyDown(event, index)}
                    >
                        {tileset.name}
                    </button>
                );
            })}
        </div>
    );
}

function TileMenuButton({ enabled }: { enabled: boolean }) {
    const commands = useCommands();
    const entries = contextMenuEntries(TILE_MENU, commands);
    return (
        <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger asChild disabled={!enabled || entries.length === 0}>
                <IconButton label="Tile menu" data-tile-menu-button="">
                    <Icon icon={Ellipsis} />
                </IconButton>
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

/** The grid position under a pointer event, from the grid's own box. */
function pointOf(event: PointerEvent, sizer: HTMLElement, layout: GridLayout, clamp: boolean) {
    const box = sizer.getBoundingClientRect();
    return gridPointAt(layout, event.clientX - box.left, event.clientY - box.top, clamp);
}

/** Where `tileset`'s selection ends (its focus), inside the grid; null without a selection. */
function selectionEnd(tileset: Tileset): GridPoint | null {
    const state = tilesetPanelStore.getState();
    const selection = state.selections[tileset.id];
    if (!selection || !selectionRect(tileset, state)) return null;
    const layout = gridLayout(tileset, 1);
    return {
        column: Math.min(selection.focus.column, layout.columns - 1),
        row: Math.min(selection.focus.row, layout.rows - 1),
    };
}

function TileGrid({ tileset }: { tileset: Tileset }) {
    const revision = useSession((state) => state.revision);
    const panel = useTilesetPanel((state) => state);
    const { zoom, filter } = panel;
    const theme = useTheme();
    const checkerboard = usePreference("checkerboard");
    const commands = useCommands();
    const scroller = useRef<HTMLDivElement>(null);
    const sizer = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const drag = useRef<{ pointerId: number } | null>(null);
    const [view, setView] = useState({ x: 0, y: 0, width: 0, height: 0 });

    // Another tileset shown: the same grid element, so it keeps the focus (`[`, `]`), shows
    // the new grid from its start and ends a drag of the one before.
    useLayoutEffect(() => {
        drag.current = null;
        scroller.current?.scrollTo(0, 0);
    }, [tileset.id]);
    const describedBy = useId();

    const layout = gridLayout(tileset, zoom);
    const selection = selectionRect(tileset, panel);
    const entries = contextMenuEntries(TILE_MENU, commands);

    // The part of the grid in view follows scrolling and the panel's size.
    useLayoutEffect(() => {
        const element = scroller.current;
        if (!element) return;
        const measure = () =>
            setView((current) => {
                const next = {
                    x: element.scrollLeft,
                    y: element.scrollTop,
                    width: element.clientWidth,
                    height: element.clientHeight,
                };
                const same =
                    current.x === next.x &&
                    current.y === next.y &&
                    current.width === next.width &&
                    current.height === next.height;
                return same ? current : next;
            });
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        element.addEventListener("scroll", measure, { passive: true });
        return () => {
            observer.disconnect();
            element.removeEventListener("scroll", measure);
        };
    }, []);

    const shownWidth = Math.min(view.width, layout.width);
    const shownHeight = Math.min(view.height, layout.height);

    useLayoutEffect(() => {
        const element = canvas.current;
        if (!element || shownWidth <= 0 || shownHeight <= 0) return;
        paintTileGrid(element, {
            tileset,
            layout,
            filter,
            selection,
            view: { x: view.x, y: view.y, width: shownWidth, height: shownHeight },
            colours: readColours(element, checkerboard.colors),
            checkerSize: checkerboard.size,
            dpr: window.devicePixelRatio,
            zoom,
        });
    });
    // `revision` and `theme` change what is painted without being read above.
    void revision;
    void theme;

    /** Scrolls the grid so the tile at the selection's end is in view. */
    const reveal = () => {
        const element = scroller.current;
        const end = selectionEnd(tileset);
        if (!element || !end) return;
        const { x, y } = tileOrigin(layout, end);
        const right = x + layout.tileWidth;
        const bottom = y + layout.tileHeight;
        if (x < element.scrollLeft) element.scrollLeft = x - 1;
        else if (right > element.scrollLeft + element.clientWidth)
            element.scrollLeft = right + 1 - element.clientWidth;
        if (y < element.scrollTop) element.scrollTop = y - 1;
        else if (bottom > element.scrollTop + element.clientHeight)
            element.scrollTop = bottom + 1 - element.clientHeight;
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.ctrlKey || event.altKey || event.metaKey) return;
        const arrow = ARROWS[event.key];
        if (arrow) {
            event.preventDefault();
            tilesetPanel.moveSelection(arrow[0], arrow[1], event.shiftKey);
            reveal();
        } else if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            tilesetPanel.makeStamp();
        }
    };

    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || !sizer.current) return;
        const point = pointOf(event, sizer.current, layout, false);
        if (!point || !shownTile(tileset, layout, point, filter)) return;
        event.preventDefault();
        scroller.current?.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId };
        tilesetPanel.select(tileset.id, point, point);
        tilesetPanel.makeStamp();
    };
    const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
        if (!sizer.current) return;
        if (drag.current?.pointerId === event.pointerId) {
            const point = pointOf(event, sizer.current, layout, true);
            const selection = tilesetPanelStore.getState().selections[tileset.id];
            const moved =
                point &&
                selection &&
                (point.column !== selection.focus.column || point.row !== selection.focus.row);
            if (moved) {
                tilesetPanel.select(tileset.id, selection.anchor, point);
                tilesetPanel.makeStamp();
            }
        }
        const point = pointOf(event, sizer.current, layout, false);
        const tile = point ? shownTile(tileset, layout, point, filter) : null;
        tilesetPanel.setHovered(
            tile && point ? { tilesetId: tileset.id, index: tileIndex(layout, point) } : null,
        );
    };
    const endDrag = (event: PointerEvent<HTMLDivElement>) => {
        if (drag.current?.pointerId === event.pointerId) drag.current = null;
    };

    const end = selectionEnd(tileset);
    const endTile = end ? shownTile(tileset, layout, end, filter) : null;
    const described = selection
        ? selection.columns * selection.rows > 1
            ? `${selection.columns} × ${selection.rows} tiles selected`
            : endTile
              ? `${tileLabel(tileset, endTile)} selected`
              : "No tile selected"
        : "No tile selected";

    return (
        <ContextMenu items={entries} disabled={entries.length === 0 || !selection}>
            <div
                ref={scroller}
                className="tilesets-panel__grid"
                role="group"
                aria-label={`Tiles of ${tileset.name}`}
                aria-describedby={describedBy}
                tabIndex={0}
                data-tile-grid={tileset.id}
                data-zoom={zoom}
                onKeyDown={onKeyDown}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onLostPointerCapture={endDrag}
                onPointerLeave={() => tilesetPanel.setHovered(null)}
                onDoubleClick={() => runCommand("tileset.editCollision")}
            >
                <div
                    ref={sizer}
                    className="tilesets-panel__sizer"
                    style={{ width: layout.width, height: layout.height }}
                >
                    <canvas
                        ref={canvas}
                        className="tilesets-panel__canvas"
                        style={{ width: shownWidth, height: shownHeight }}
                        data-tile-canvas=""
                    />
                </div>
                <span id={describedBy} className="ui-visually-hidden" aria-live="polite">
                    {described}
                </span>
            </div>
        </ContextMenu>
    );
}

/** The Tilesets tab of the bottom panel. */
export function TilesetsPanel() {
    const { session } = useSession((state) => state);
    const panel = useTilesetPanel((state) => state);
    const root = useRef<HTMLDivElement>(null);
    const filterId = useId();
    const { tilesets } = session.project;
    const shown = shownTileset(session.project, panel);

    useEffect(() => {
        const element = root.current;
        return element ? installTilesetDrop({ target: element, files: "all" }) : undefined;
    }, []);

    return (
        <div ref={root} className="tilesets-panel" data-tilesets-panel="">
            <div className="tilesets-panel__bar">
                <TilesetTabs tilesets={tilesets} shown={shown} />
                <IconButton
                    label="New Tileset"
                    data-new-tileset=""
                    onClick={() => runCommand("file.importTileset")}
                >
                    <Icon icon={Plus} />
                </IconButton>
                <span className="tilesets-panel__spacer" />
                <span className="ui-field">
                    <label className="ui-field__label" htmlFor={filterId}>
                        Filter
                    </label>
                    <input
                        id={filterId}
                        className="tilesets-panel__filter"
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="Class"
                        aria-label="Filter by tile class"
                        value={panel.filter}
                        onChange={(event) => tilesetPanel.setFilter(event.target.value)}
                    />
                </span>
                <Select
                    label="Zoom"
                    value={String(panel.zoom)}
                    options={ZOOM_OPTIONS}
                    onChange={(value) => tilesetPanel.setZoom(Number(value) as PanelZoom)}
                />
                <TileMenuButton enabled={shown !== null && selectionRect(shown, panel) !== null} />
            </div>
            {shown ? (
                <TileGrid tileset={shown} />
            ) : (
                <p className="tilesets-panel__empty" data-tilesets-empty="">
                    No tilesets. Import one with File → Import Tileset… or drop a PNG, an .ngsprite
                    or an atlas here.
                </p>
            )}
        </div>
    );
}
