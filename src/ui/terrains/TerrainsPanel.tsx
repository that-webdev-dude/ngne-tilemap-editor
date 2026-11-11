import { ChevronDown, ChevronRight, Ellipsis, Plus } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent, PointerEvent } from "react";
import { useStore } from "zustand";
import { usePreference } from "../../app/preferences/preferences";
import { historySteps } from "../../app/state/historySteps";
import { useSession } from "../../app/state/session";
import {
    TERRAIN_MENU,
    TERRAIN_SET_MENU,
    TERRAIN_SET_NEW_MENU,
    applyTerrainRename,
    cancelTerrainRename,
    clickTarget,
    clickTile,
    selectTerrain,
    setMissingOpen,
    setTerrainField,
    setTerrainHover,
    setTerrainRenameText,
    setTerrainSetType,
    startTerrainRename,
    terrainSelection,
    toggleCollapsed,
    useTerrainsPanel,
} from "../../app/terrains/terrainsPanel";
import type { TerrainSelection } from "../../app/terrains/terrainsPanel";
import {
    gridLayout,
    gridPointAt,
    shownTile,
    tileLabel,
    tileOrigin,
} from "../../app/tilesets/panel/tileGrid";
import type { GridLayout } from "../../app/tilesets/panel/tileGrid";
import { useTilesetPanel } from "../../app/tilesets/panel/tilesetPanel";
import { formatHex, parseHex } from "../../core/color";
import { MAX_TEXT_LENGTH } from "../../core/model";
import type { TerrainSet, TerrainSetType, Tileset } from "../../core/model";
import { missingCombinations, terrainAnalysis } from "../../core/terrain";
import { ColourPicker } from "../colour/ColourPicker";
import { cssColour } from "../colour/pickerMath";
import { contextMenuEntries } from "../commands/contextMenu";
import { useCommands } from "../commands/useCommands";
import { ContextMenu, Icon, IconButton, Popover, Select } from "../primitives";
import type { ContextMenuEntry } from "../primitives";
import { useTheme } from "../theme/theme";
import { readColours } from "../tilesets/TilesetsPanel";
import { paintTileGrid } from "../tilesets/paintTileGrid";
import type { GridColours } from "../tilesets/paintTileGrid";
import { useDevicePixelRatio } from "../tilesets/useDevicePixelRatio";
import { paintTerrainMarks } from "./paintTerrainMarks";
import "./terrainsPanel.css";

// The Terrains panel (SPEC §5.1, DESIGN §8.6; TE-043), the Terrains tab of the bottom panel. Left,
// a 200 px column with the terrain sets of the active tileset (the one the Tilesets panel
// shows), each expandable to its terrains: colour chip (the colour panel in a popover, applied
// when it closes), name, icon tile (a popover with the tileset's grid); a type select per set.
// Add (+) lists New Corner Set, New Edge Set and New Mixed Set; a row's menu (right click or its
// overflow button) lists the commands of the menus "terrainSet" and "terrain". A click on a name
// selects the set or terrain, a double click renames it in place. Right, the tileset's grid with
// the selected set's marks; a click on a tile assigns the selected terrain to the corner or edge
// under the pointer, a right click clears it, Shift acts on the whole tile. Under the grid, for
// corner and edge sets, "Missing combinations: n" with a disclosure listing them as diagrams.

/** How many missing combinations the disclosure lists. */
export const MISSING_LIST_LIMIT = 256;

const TYPE_OPTIONS: { value: TerrainSetType; label: string }[] = [
    { value: "corner", label: "Corner" },
    { value: "edge", label: "Edge" },
    { value: "mixed", label: "Mixed" },
];

/** A drop-down of the entries of a context menu: the overflow button of a row, or Add. */
function MenuButton({
    label,
    entries,
    icon,
    onOpen,
    ...data
}: {
    label: string;
    entries: readonly ContextMenuEntry[];
    icon: typeof Plus;
    onOpen?(): void;
    [data: `data-${string}`]: string;
}) {
    return (
        <DropdownMenu.Root modal={false} onOpenChange={(open) => open && onOpen?.()}>
            <DropdownMenu.Trigger asChild disabled={entries.length === 0}>
                <IconButton label={label} {...data}>
                    <Icon icon={icon} />
                </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
                <DropdownMenu.Content
                    className="ui-menu"
                    align="start"
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
                                data-command={entry.id}
                            >
                                {entry.label}
                            </DropdownMenu.Item>
                        ),
                    )}
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
}

/** The in-place rename of a set or terrain: Enter or leaving applies, Escape keeps the name. */
function RenameField({ text, label }: { text: string; label: string }) {
    return (
        <input
            className="terrains-panel__rename"
            type="text"
            aria-label={label}
            autoComplete="off"
            spellCheck={false}
            maxLength={MAX_TEXT_LENGTH}
            autoFocus
            data-terrain-rename=""
            value={text}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setTerrainRenameText(event.target.value)}
            onKeyDown={(event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    applyTerrainRename();
                } else if (event.key === "Escape") {
                    event.preventDefault();
                    // Not the dialog's or the canvas's Escape.
                    event.stopPropagation();
                    cancelTerrainRename();
                }
            }}
            onBlur={() => void applyTerrainRename()}
        />
    );
}

/** Tile `tileId` of `tileset` drawn at `size` CSS pixels; empty for none. */
function TileIcon({
    tileset,
    tileId,
    size,
}: {
    tileset: Tileset;
    tileId: number | null;
    size: number;
}) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const index = tileId === null ? -1 : tileset.tiles.findIndex((tile) => tile.id === tileId);
    useLayoutEffect(() => {
        const element = canvas.current;
        if (!element || index < 0) return;
        const { tileWidth: width, tileHeight: height, columns, pixels } = tileset;
        const left = (index % columns) * width;
        const top = Math.floor(index / columns) * height;
        const data = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y++) {
            const from = ((top + y) * pixels.width + left) * 4;
            data.set(pixels.data.subarray(from, from + width * 4), y * width * 4);
        }
        element.width = width;
        element.height = height;
        element.getContext("2d")?.putImageData(new ImageData(data, width, height), 0, 0);
    }, [tileset, tileset.pixels, index]);
    const scale = size / Math.max(tileset.tileWidth, tileset.tileHeight);
    return index < 0 ? (
        <span className="terrains-panel__no-icon" style={{ width: size, height: size }} />
    ) : (
        <canvas
            ref={canvas}
            className="terrains-panel__icon"
            style={{ width: tileset.tileWidth * scale, height: tileset.tileHeight * scale }}
        />
    );
}

/** The colours the grids paint with, read once per theme and checkerboard. */
function useGridColours(): (element: Element) => GridColours {
    const theme = useTheme();
    const checkerboard = usePreference("checkerboard");
    const cache = useRef<{ key: string; value: GridColours } | null>(null);
    return (element) => {
        const key = `${theme}|${JSON.stringify(checkerboard.colors)}`;
        if (cache.current?.key !== key) {
            cache.current = { key, value: readColours(element, checkerboard.colors) };
        }
        return cache.current.value;
    };
}

/** The tile under a pointer event over a grid, and where in it (0..1 across), or null. */
function tileAt(
    event: PointerEvent | MouseEvent,
    sizer: HTMLElement,
    tileset: Tileset,
    layout: GridLayout,
) {
    const box = sizer.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const point = gridPointAt(layout, x, y);
    const tile = point ? shownTile(tileset, layout, point, "") : null;
    if (!point || !tile) return null;
    const origin = tileOrigin(layout, point);
    const clamp = (value: number) => Math.min(Math.max(value, 0), 1);
    return {
        tile,
        fx: clamp((x - origin.x) / layout.tileWidth),
        fy: clamp((y - origin.y) / layout.tileHeight),
    };
}

/** The icon tile of a terrain: a popover with the tileset's grid at 1×, and None. */
function IconPicker({ tileset, set, terrain }: { tileset: Tileset; set: number; terrain: number }) {
    const [open, setOpen] = useState(false);
    const current = tileset.terrainSets[set]?.colors[terrain - 1];
    const name = current?.name ?? "";
    return (
        <Popover
            label={`Icon of ${name}`}
            open={open}
            onOpenChange={setOpen}
            className="terrains-panel__icon-popover"
            trigger={
                <button
                    type="button"
                    className="terrains-panel__icon-button"
                    aria-label={`Icon of ${name}: ${current?.tile ?? "none"}`}
                    data-terrain-icon=""
                >
                    <TileIcon tileset={tileset} tileId={current?.tile ?? null} size={16} />
                </button>
            }
        >
            {open ? (
                <IconGrid
                    tileset={tileset}
                    onPick={(tileId) => {
                        setTerrainField(set, terrain, "tile", tileId);
                        setOpen(false);
                    }}
                />
            ) : null}
        </Popover>
    );
}

function IconGrid({ tileset, onPick }: { tileset: Tileset; onPick(tileId: number | null): void }) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const sizer = useRef<HTMLDivElement>(null);
    const dpr = useDevicePixelRatio();
    const checkerboard = usePreference("checkerboard");
    const colours = useGridColours();
    const layout = gridLayout(tileset, 1);
    const count = tileset.tiles.length;
    // The tile the arrow keys outline and Enter picks, as in Replace with…'s sheet.
    const [focus, setFocus] = useState(0);
    // The whole grid at 1×; the popover scrolls past 256 × 192 (FORMAT limits it to 8192 px).
    useLayoutEffect(() => {
        const element = canvas.current;
        if (!element || layout.rows === 0) return;
        paintTileGrid(element, {
            tileset,
            layout,
            filter: "",
            selection: null,
            view: { x: 0, y: 0, width: layout.width, height: layout.height },
            colours: colours(element),
            checkerSize: checkerboard.size,
            dpr,
            zoom: 1,
        });
    });
    const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const step: Record<string, number> = {
            ArrowLeft: -1,
            ArrowRight: 1,
            ArrowUp: -layout.columns,
            ArrowDown: layout.columns,
        };
        if (event.key in step) {
            event.preventDefault();
            setFocus((at) => Math.min(count - 1, Math.max(0, at + step[event.key]!)));
        } else if ((event.key === "Enter" || event.key === " ") && count > 0) {
            event.preventDefault();
            onPick(tileset.tiles[focus]!.id);
        }
    };
    const focused = tileset.tiles[focus];
    const origin = tileOrigin(layout, {
        column: focus % layout.columns,
        row: Math.floor(focus / layout.columns),
    });
    return (
        <div className="terrains-panel__icon-picker">
            <button
                type="button"
                className="ui-button"
                onClick={() => onPick(null)}
                data-icon-none=""
            >
                None
            </button>
            <div className="terrains-panel__icon-grid">
                <div
                    ref={sizer}
                    className="terrains-panel__icon-sheet"
                    style={{ width: layout.width, height: layout.height }}
                    tabIndex={0}
                    role="group"
                    aria-label={
                        focused
                            ? `Tiles of ${tileset.name}; ${tileLabel(tileset, focused)}`
                            : `Tiles of ${tileset.name}`
                    }
                    onKeyDown={onKeyDown}
                    data-icon-grid=""
                    onClick={(event) => {
                        const hit = sizer.current && tileAt(event, sizer.current, tileset, layout);
                        if (hit) onPick(hit.tile.id);
                    }}
                >
                    <canvas
                        ref={canvas}
                        style={{ width: layout.width, height: layout.height, display: "block" }}
                    />
                    {focused ? (
                        <span
                            className="terrains-panel__icon-focus"
                            style={{
                                left: origin.x - 1,
                                top: origin.y - 1,
                                width: layout.tileWidth + 2,
                                height: layout.tileHeight + 2,
                            }}
                        />
                    ) : null}
                </div>
            </div>
        </div>
    );
}

/** A terrain's colour chip: the colour panel in a popover, applied when it closes. */
function ColourChip({
    set,
    terrain,
    colour,
    name,
}: {
    set: number;
    terrain: number;
    colour: string;
    name: string;
}) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<number | null>(null);
    const stored = parseHex(colour) ?? 0x000000ff;
    return (
        <Popover
            label={`${name} colour`}
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                if (!next && draft !== null && draft !== stored) {
                    setTerrainField(set, terrain, "color", formatHex(draft, true).toLowerCase());
                }
                setDraft(null);
            }}
            className="terrains-panel__colour-popover"
            trigger={
                <button
                    type="button"
                    className="terrains-panel__chip"
                    aria-label={`${name} colour: ${colour}`}
                    data-terrain-colour=""
                >
                    <span style={{ background: cssColour(stored) }} />
                </button>
            }
        >
            <ColourPicker value={draft ?? stored} onChange={setDraft} />
        </Popover>
    );
}

function SetList({ tileset, selection }: { tileset: Tileset; selection: TerrainSelection | null }) {
    const commands = useCommands();
    const renaming = useTerrainsPanel((state) => state.renaming);
    const collapsed = useTerrainsPanel((state) => state.collapsed[tileset.id]);
    const setEntries = contextMenuEntries(TERRAIN_SET_MENU, commands);
    const terrainEntries = contextMenuEntries(TERRAIN_MENU, commands);
    const renamingHere = (set: number, terrain: number | null) =>
        renaming?.tilesetId === tileset.id && renaming.set === set && renaming.terrain === terrain;

    if (tileset.terrainSets.length === 0) {
        return (
            <p className="terrains-panel__none" data-terrain-sets-empty="">
                No terrain sets. Add one with +.
            </p>
        );
    }
    return (
        <ul className="terrains-panel__sets" aria-label={`Terrain sets of ${tileset.name}`}>
            {tileset.terrainSets.map((set, setIndex) => {
                const open = !(collapsed?.includes(setIndex) ?? false);
                const setSelected = selection?.set === setIndex;
                return (
                    <li key={setIndex} data-terrain-set={setIndex}>
                        <ContextMenu items={setEntries} disabled={renamingHere(setIndex, null)}>
                            <div
                                className="terrains-panel__row terrains-panel__set-row"
                                data-selected={setSelected ? "" : undefined}
                                onContextMenu={() =>
                                    selectTerrain(setIndex, setSelected ? selection.terrain : 1)
                                }
                            >
                                <IconButton
                                    label={open ? `Collapse ${set.name}` : `Expand ${set.name}`}
                                    aria-expanded={open}
                                    data-terrain-set-toggle=""
                                    onClick={() => toggleCollapsed(setIndex, open)}
                                >
                                    <Icon icon={open ? ChevronDown : ChevronRight} />
                                </IconButton>
                                {renamingHere(setIndex, null) ? (
                                    <RenameField text={renaming!.text} label="Terrain set name" />
                                ) : (
                                    <button
                                        type="button"
                                        className="terrains-panel__name"
                                        aria-pressed={setSelected}
                                        title={set.name}
                                        data-terrain-set-name=""
                                        onClick={() =>
                                            selectTerrain(
                                                setIndex,
                                                setSelected ? selection.terrain : 1,
                                            )
                                        }
                                        onDoubleClick={() => startTerrainRename(setIndex, null)}
                                    >
                                        {set.name}
                                    </button>
                                )}
                                <Select
                                    label={`Type of ${set.name}`}
                                    hideLabel
                                    className="terrains-panel__type"
                                    value={set.type}
                                    options={TYPE_OPTIONS}
                                    onChange={(type) => setTerrainSetType(setIndex, type)}
                                />
                                <MenuButton
                                    label={`${set.name} menu`}
                                    icon={Ellipsis}
                                    entries={setEntries}
                                    onOpen={() =>
                                        selectTerrain(setIndex, setSelected ? selection.terrain : 1)
                                    }
                                    data-terrain-set-menu=""
                                />
                            </div>
                        </ContextMenu>
                        {open ? (
                            <ul
                                className="terrains-panel__terrains"
                                aria-label={`Terrains of ${set.name}`}
                            >
                                {set.colors.map((colour, k) => {
                                    const terrain = k + 1;
                                    const selected = setSelected && selection.terrain === terrain;
                                    return (
                                        <li key={terrain} data-terrain={`${setIndex}:${terrain}`}>
                                            <ContextMenu
                                                items={terrainEntries}
                                                disabled={renamingHere(setIndex, terrain)}
                                            >
                                                <div
                                                    className="terrains-panel__row terrains-panel__terrain-row"
                                                    data-selected={selected ? "" : undefined}
                                                    onContextMenu={() =>
                                                        selectTerrain(setIndex, terrain)
                                                    }
                                                >
                                                    <ColourChip
                                                        set={setIndex}
                                                        terrain={terrain}
                                                        colour={colour.color}
                                                        name={colour.name}
                                                    />
                                                    {renamingHere(setIndex, terrain) ? (
                                                        <RenameField
                                                            text={renaming!.text}
                                                            label="Terrain name"
                                                        />
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            className="terrains-panel__name"
                                                            aria-pressed={selected}
                                                            title={colour.name}
                                                            data-terrain-name=""
                                                            onClick={() =>
                                                                selectTerrain(setIndex, terrain)
                                                            }
                                                            onDoubleClick={() =>
                                                                startTerrainRename(
                                                                    setIndex,
                                                                    terrain,
                                                                )
                                                            }
                                                        >
                                                            {colour.name}
                                                        </button>
                                                    )}
                                                    <IconPicker
                                                        tileset={tileset}
                                                        set={setIndex}
                                                        terrain={terrain}
                                                    />
                                                    <MenuButton
                                                        label={`${colour.name} menu`}
                                                        icon={Ellipsis}
                                                        entries={terrainEntries}
                                                        onOpen={() =>
                                                            selectTerrain(setIndex, terrain)
                                                        }
                                                        data-terrain-menu=""
                                                    />
                                                </div>
                                            </ContextMenu>
                                        </li>
                                    );
                                })}
                            </ul>
                        ) : null}
                    </li>
                );
            })}
        </ul>
    );
}

function TerrainGrid({ tileset, set }: { tileset: Tileset; set: TerrainSet | null }) {
    const step = useStore(historySteps, (state) => state.step);
    const zoom = useTilesetPanel((state) => state.zoom);
    const hover = useTerrainsPanel((state) => state.hover);
    const dpr = useDevicePixelRatio();
    const theme = useTheme();
    const checkerboard = usePreference("checkerboard");
    const colours = useGridColours();
    const scroller = useRef<HTMLDivElement>(null);
    const sizer = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const [view, setView] = useState({ x: 0, y: 0, width: 0, height: 0 });
    /** The tile under the pointer and where in it, for the Shift key's hover. */
    const pointer = useRef<{ tileId: number; fx: number; fy: number } | null>(null);
    const layout = gridLayout(tileset, zoom);

    useLayoutEffect(() => {
        scroller.current?.scrollTo(0, 0);
    }, [tileset.id]);

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
        const value = colours(element);
        const shown = { x: view.x, y: view.y, width: shownWidth, height: shownHeight };
        const grid = gridLayout(tileset, zoom);
        paintTileGrid(element, {
            tileset,
            layout: grid,
            filter: "",
            selection: null,
            view: shown,
            colours: value,
            checkerSize: checkerboard.size,
            dpr,
            zoom,
        });
        const context = element.getContext("2d");
        if (context && set) {
            paintTerrainMarks(context, {
                tileset,
                set,
                layout: grid,
                view: shown,
                hover,
                accent: value.accent,
            });
        }
        // `step` stands for the terrain of the set and the tiles, which commands replace.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        tileset,
        set,
        step,
        zoom,
        hover,
        view.x,
        view.y,
        shownWidth,
        shownHeight,
        theme,
        checkerboard,
        dpr,
    ]);

    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if ((event.button !== 0 && event.button !== 2) || !sizer.current) return;
        const hit = tileAt(event, sizer.current, tileset, layout);
        if (!hit) return;
        event.preventDefault();
        clickTile(hit.tile.id, hit.fx, hit.fy, {
            erase: event.button === 2,
            wholeTile: event.shiftKey,
        });
    };
    /** Shows the target of a click at `hit`, with or without Shift; none off the tiles. */
    const showHover = (hit: { tileId: number; fx: number; fy: number } | null, shift: boolean) =>
        setTerrainHover(
            hit
                ? {
                      tilesetId: tileset.id,
                      tileId: hit.tileId,
                      target: clickTarget(hit.fx, hit.fy, { erase: false, wholeTile: shift }),
                  }
                : null,
        );
    const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
        if (!sizer.current) return;
        const hit = tileAt(event, sizer.current, tileset, layout);
        pointer.current = hit ? { tileId: hit.tile.id, fx: hit.fx, fy: hit.fy } : null;
        showHover(pointer.current, event.shiftKey);
    };
    // Shift pressed or let go over a tile changes the target without a pointer move.
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Shift" && pointer.current)
                showHover(pointer.current, event.shiftKey);
        };
        window.addEventListener("keydown", onKey);
        window.addEventListener("keyup", onKey);
        return () => {
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("keyup", onKey);
        };
    });

    return (
        <div
            ref={scroller}
            className="terrains-panel__grid"
            role="group"
            aria-label={`Terrain marks of ${tileset.name}`}
            data-terrain-grid={tileset.id}
            data-zoom={zoom}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerLeave={() => {
                pointer.current = null;
                setTerrainHover(null);
            }}
            // A right click clears an index; the page's menu does not open.
            onContextMenu={(event) => event.preventDefault()}
        >
            <div
                ref={sizer}
                className="terrains-panel__sizer"
                style={{ width: layout.width, height: layout.height }}
            >
                <canvas
                    ref={canvas}
                    className="terrains-panel__canvas"
                    style={{ width: shownWidth, height: shownHeight }}
                    data-terrain-canvas=""
                />
            </div>
        </div>
    );
}

/** One combination as a 24 px diagram: corner quadrants or edge triangles in terrain colours. */
function Combination({ set, wangId }: { set: TerrainSet; wangId: readonly number[] }) {
    const fill = (index: number) => set.colors[wangId[index]! - 1]?.color.slice(0, 7) ?? "none";
    const names = (set.type === "corner" ? [7, 1, 3, 5] : [0, 2, 4, 6])
        .map((index) => set.colors[wangId[index]! - 1]?.name ?? "")
        .join(", ");
    return (
        <li
            className="terrains-panel__combination"
            data-missing-combination={wangId.join(",")}
            title={names}
        >
            <svg width="24" height="24" viewBox="0 0 24 24" role="img" aria-label={names}>
                {set.type === "corner" ? (
                    <>
                        <rect x="0" y="0" width="12" height="12" fill={fill(7)} />
                        <rect x="12" y="0" width="12" height="12" fill={fill(1)} />
                        <rect x="12" y="12" width="12" height="12" fill={fill(3)} />
                        <rect x="0" y="12" width="12" height="12" fill={fill(5)} />
                    </>
                ) : (
                    <>
                        <polygon points="0,0 24,0 12,12" fill={fill(0)} />
                        <polygon points="24,0 24,24 12,12" fill={fill(2)} />
                        <polygon points="0,24 24,24 12,12" fill={fill(4)} />
                        <polygon points="0,0 0,24 12,12" fill={fill(6)} />
                    </>
                )}
            </svg>
        </li>
    );
}

function MissingCombinations({ tileset, set }: { tileset: Tileset; set: TerrainSet }) {
    const open = useTerrainsPanel((state) => state.missingOpen);
    const listId = useId();
    const analysis = terrainAnalysis(set, tileset.slot);
    if (analysis.missingCount === null) return null;
    const missing = open ? missingCombinations(analysis, MISSING_LIST_LIMIT) : [];
    const more = analysis.missingCount - missing.length;
    return (
        <div className="terrains-panel__missing" data-terrain-missing="">
            <button
                type="button"
                className="terrains-panel__disclosure"
                aria-expanded={open}
                aria-controls={listId}
                data-missing-toggle=""
                onClick={() => setMissingOpen(!open)}
            >
                <Icon icon={open ? ChevronDown : ChevronRight} />
                Missing combinations: <span data-missing-count="">{analysis.missingCount}</span>
            </button>
            {open ? (
                <ul
                    id={listId}
                    className="terrains-panel__combinations"
                    aria-label="Missing combinations"
                >
                    {missing.map((wangId) => (
                        <Combination key={wangId.join(",")} set={set} wangId={wangId} />
                    ))}
                    {more > 0 ? <li className="terrains-panel__more">and {more} more</li> : null}
                </ul>
            ) : null}
        </div>
    );
}

/** The Terrains tab of the bottom panel. */
export function TerrainsPanel() {
    const project = useSession((state) => state.session.project);
    // Every step of the history may change the sets, which commands replace.
    useStore(historySteps, (state) => state.step);
    const activeTilesetId = useTilesetPanel((state) => state.activeTilesetId);
    const selections = useTerrainsPanel((state) => state.selections);
    const commands = useCommands();
    // The tileset the Tilesets panel shows: its active one, else the first.
    const tileset =
        project.tilesets.find((each) => each.id === activeTilesetId) ?? project.tilesets[0] ?? null;
    const selection = terrainSelection(tileset, selections);
    const set = tileset && selection ? tileset.terrainSets[selection.set]! : null;

    if (!tileset) {
        return (
            <div className="terrains-panel" data-terrains-panel="">
                <p className="terrains-panel__empty" data-terrains-empty="">
                    No tilesets. Import one with File → Import Tileset… to add terrain sets to it.
                </p>
            </div>
        );
    }
    return (
        <div className="terrains-panel" data-terrains-panel="" data-tileset={tileset.id}>
            <div className="terrains-panel__column">
                <div className="terrains-panel__bar">
                    <span className="terrains-panel__title" title={tileset.name}>
                        {tileset.name}
                    </span>
                    <MenuButton
                        label="Add Terrain Set"
                        icon={Plus}
                        entries={contextMenuEntries(TERRAIN_SET_NEW_MENU, commands)}
                        data-terrain-set-add=""
                    />
                </div>
                <div className="terrains-panel__list">
                    <SetList tileset={tileset} selection={selection} />
                </div>
            </div>
            <div className="terrains-panel__main">
                <TerrainGrid tileset={tileset} set={set} />
                {set ? <MissingCombinations tileset={tileset} set={set} /> : null}
            </div>
        </div>
    );
}
