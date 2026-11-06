import { ChevronDown, X } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { useSession } from "../../app/state/session";
import {
    activateMap,
    closeMapTab,
    mapTabsStore,
    moveMapTab,
    useMapTabs,
} from "../../app/tabs/tabs";
import { Icon } from "../primitives/Icon";
import { Tooltip } from "../primitives/Tooltip";
import "./tabs.css";

// The map tabs in the centre of the menu bar (DESIGN §2, TE-031): the project's name and its
// unsaved marker, then one tab per open map of the project, the active one selected, each with
// its name and a close control. Closing a tab hides the map; it stays in the project. A press
// selects a tab and a drag along the strip reorders it; a middle click or the close control
// closes it. From the keyboard the strip is one tab stop: the arrow keys, Home and End move
// between tabs, Enter or Space selects one, Delete closes it and Ctrl+Shift+← / → move it.
// Tabs shrink to 96 px; past that the strip scrolls and an overflow menu lists every open map.

/** What the strip shows of an open map. */
interface TabInfo {
    readonly id: string;
    readonly name: string;
}

/** How far a press moves along the strip before it is a drag, in CSS pixels. */
const DRAG_THRESHOLD = 4;

/** The project's name and unsaved state; renders again only when one of them changes. */
function useProjectLabel(): { name: string; dirty: boolean } {
    const key = useSession((state) =>
        JSON.stringify([state.session.project.name, state.history.dirty]),
    );
    return useMemo(() => {
        const [name, dirty] = JSON.parse(key) as [string, boolean];
        return { name, dirty };
    }, [key]);
}

/** The tabs and the active map; renders again only when one of them changes. */
function useTabs(): { tabs: readonly TabInfo[]; activeId: string | null } {
    const open = useMapTabs((state) => state.open);
    const key = useSession((state) => {
        const { project, activeMapId } = state.session;
        const names = new Map(project.maps.map((map) => [map.id, map.name]));
        return JSON.stringify([
            activeMapId,
            open.filter((id) => names.has(id)).map((id) => [id, names.get(id)!]),
        ]);
    });
    return useMemo(() => {
        const [activeId, rows] = JSON.parse(key) as [string, [string, string][]];
        return {
            activeId: rows.some(([id]) => id === activeId) ? activeId : null,
            tabs: rows.map(([id, name]) => ({ id, name })),
        };
    }, [key]);
}

const tabSelector = (id: string) => `[data-map-tab="${CSS.escape(id)}"]`;

/** Scrolls `list` horizontally so that `tab` lies inside it. */
function reveal(list: HTMLElement, tab: Element): void {
    const outer = list.getBoundingClientRect();
    const inner = tab.getBoundingClientRect();
    if (inner.left < outer.left) list.scrollLeft -= outer.left - inner.left;
    else if (inner.right > outer.right) list.scrollLeft += inner.right - outer.right;
}

export function MapTabs() {
    const project = useProjectLabel();
    const { tabs, activeId } = useTabs();
    const list = useRef<HTMLDivElement>(null);
    const [overflowing, setOverflowing] = useState(false);
    /** The tab the keyboard is on: the active one unless arrows moved away from it. */
    const [focusId, setFocusId] = useState<string | null>(null);
    /** A tab that must have the focus once the strip has rendered (after a keyboard move). */
    const refocus = useRef<string | null>(null);
    const stop = useRef<(() => void) | null>(null);
    const order = tabs.map((tab) => tab.id).join("\n");
    /** Everything that changes the width of a tab: a rename too. */
    const widths = JSON.stringify(tabs);
    const stopId = tabs.some((tab) => tab.id === focusId) ? focusId : activeId;

    // The overflow menu shows while the tabs, shrunk to their least width, do not fit. The
    // strip and each tab are observed: a tab that grows (a longer name) is measured again.
    useLayoutEffect(() => {
        const element = list.current;
        if (!element) return;
        const measure = () => setOverflowing(element.scrollWidth > element.clientWidth + 1);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        for (const tab of element.querySelectorAll("[data-map-tab]")) observer.observe(tab);
        return () => observer.disconnect();
    }, [widths]);

    // The active tab is always in view; so is a tab the keyboard moved.
    useLayoutEffect(() => {
        const element = list.current;
        const id = refocus.current ?? activeId;
        if (!element || id === null) return;
        const tab = element.querySelector<HTMLElement>(tabSelector(id));
        if (!tab) return;
        reveal(element, tab);
        if (refocus.current !== null) {
            refocus.current = null;
            tab.focus({ preventScroll: true });
        }
    }, [activeId, order, overflowing]);

    // A drag that is still going when the strip goes away ends with it.
    useLayoutEffect(() => () => stop.current?.(), []);

    const focusTab = (id: string) => {
        const tab = list.current?.querySelector<HTMLElement>(tabSelector(id));
        if (!tab) return;
        setFocusId(id);
        tab.focus({ preventScroll: true });
        if (list.current) reveal(list.current, tab);
    };

    /**
     * Closes the focused tab (Delete). The focus goes to the tab now in its place, or the one
     * before it; with no tab left, to the viewport.
     */
    const closeFocused = (id: string) => {
        const index = tabs.findIndex((tab) => tab.id === id);
        if (!closeMapTab(id)) return;
        const { open } = mapTabsStore.getState();
        const next = open[index] ?? open[index - 1] ?? null;
        if (next) setFocusId(next);
        // Once the strip has rendered without the closed tab.
        requestAnimationFrame(() => {
            const target = next
                ? document.querySelector<HTMLElement>(tabSelector(next))
                : document.querySelector<HTMLElement>("[data-viewport-focus]");
            target?.focus({ preventScroll: true });
            if (next && target && list.current) reveal(list.current, target);
        });
    };

    const onKeyDown = (event: KeyboardEvent<HTMLElement>, id: string) => {
        const index = tabs.findIndex((tab) => tab.id === id);
        const at = (offset: number) => tabs[(index + offset + tabs.length) % tabs.length]!.id;
        const plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
        const reorder = event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey;
        let handled = true;
        if (reorder && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
            const to = index + (event.key === "ArrowLeft" ? -1 : 1);
            if (to >= 0 && to < tabs.length) {
                refocus.current = id;
                setFocusId(id);
                moveMapTab(id, to);
            }
        } else if (!plain) {
            handled = false;
        } else if (event.key === "ArrowLeft") focusTab(at(-1));
        else if (event.key === "ArrowRight") focusTab(at(1));
        else if (event.key === "Home") focusTab(tabs[0]!.id);
        else if (event.key === "End") focusTab(tabs[tabs.length - 1]!.id);
        else if (event.key === "Enter" || event.key === " ") activateMap(id);
        else if (event.key === "Delete") closeFocused(id);
        else handled = false;
        // Taken here: the keymap leaves a key whose default was prevented alone.
        if (handled) event.preventDefault();
    };

    const onPointerDown = (event: ReactPointerEvent<HTMLElement>, id: string) => {
        if (event.button !== 0) return;
        // The close control closes; it does not select the tab first.
        if ((event.target as Element).closest("[data-tab-close]")) return;
        activateMap(id);
        setFocusId(null);
        const element = list.current;
        if (!element) return;
        const { pointerId, clientX: startX } = event;
        let dragging = false;
        const onMove = (move: PointerEvent) => {
            if (move.pointerId !== pointerId) return;
            if (!dragging && Math.abs(move.clientX - startX) < DRAG_THRESHOLD) return;
            dragging = true;
            // The place among the other tabs: after every tab whose middle is left of the
            // pointer.
            const others = [...element.querySelectorAll<HTMLElement>("[data-map-tab]")]
                .filter((tab) => tab.dataset.mapTab !== id)
                .map((tab) => tab.getBoundingClientRect());
            const to = others.filter((box) => box.left + box.width / 2 < move.clientX).length;
            moveMapTab(id, to);
        };
        const end = (up: PointerEvent) => {
            if (up.pointerId === pointerId) stop.current?.();
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
        };
    };

    return (
        <div className="map-tabs" data-map-tabs="">
            <span className="map-tabs__project" data-project-name="" title={project.name}>
                <span className="map-tabs__project-name">{project.name}</span>
                {project.dirty ? (
                    <span
                        className="map-tabs__unsaved"
                        data-unsaved-marker=""
                        title="Unsaved changes"
                    >
                        <span aria-hidden="true">*</span>
                        <span className="ui-visually-hidden">Unsaved changes</span>
                    </span>
                ) : null}
            </span>
            {tabs.length > 0 ? (
                <div
                    ref={list}
                    className="map-tabs__list"
                    role="tablist"
                    aria-label="Maps"
                    onBlur={(event) => {
                        // Left for another part of the page: the tab stop is the selected tab again.
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                            setFocusId(null);
                        }
                    }}
                    onWheel={(event) => {
                        // A vertical wheel scrolls the strip sideways.
                        if (list.current && event.deltaX === 0) {
                            list.current.scrollLeft += event.deltaY;
                        }
                    }}
                >
                    {tabs.map((tab) => {
                        const active = tab.id === activeId;
                        return (
                            <div
                                key={tab.id}
                                role="tab"
                                className="map-tab"
                                aria-selected={active}
                                tabIndex={tab.id === stopId ? 0 : -1}
                                aria-keyshortcuts="Delete Control+Shift+ArrowLeft Control+Shift+ArrowRight"
                                data-map-tab={tab.id}
                                onPointerDown={(event) => onPointerDown(event, tab.id)}
                                onMouseDown={(event) => {
                                    // No autoscroll on a middle press: it closes the tab.
                                    if (event.button === 1) event.preventDefault();
                                }}
                                onAuxClick={(event) => {
                                    if (event.button !== 1) return;
                                    event.preventDefault();
                                    closeMapTab(tab.id);
                                }}
                                onKeyDown={(event) => onKeyDown(event, tab.id)}
                                onFocus={() => setFocusId(tab.id)}
                            >
                                <span className="map-tab__label">
                                    <span
                                        className="map-tab__name"
                                        data-map-name={active ? "" : undefined}
                                        title={tab.name}
                                    >
                                        {tab.name}
                                    </span>
                                </span>
                                {/* Pointer only: from the keyboard Delete closes the tab. */}
                                <span
                                    className="map-tab__close"
                                    aria-hidden="true"
                                    title={`Close ${tab.name}`}
                                    data-tab-close=""
                                    onClick={() => void closeMapTab(tab.id)}
                                >
                                    <Icon icon={X} />
                                </span>
                            </div>
                        );
                    })}
                </div>
            ) : null}
            {overflowing && tabs.length > 0 ? (
                <DropdownMenu.Root modal={false}>
                    {/* An icon-only control has the app's tooltip (SUITE §4). */}
                    <Tooltip label="All maps">
                        <DropdownMenu.Trigger asChild>
                            <button
                                type="button"
                                className="ui-icon-button map-tabs__overflow"
                                aria-label="All maps"
                                data-tabs-overflow=""
                            >
                                <Icon icon={ChevronDown} />
                            </button>
                        </DropdownMenu.Trigger>
                    </Tooltip>
                    <DropdownMenu.Portal>
                        <DropdownMenu.Content
                            className="ui-menu"
                            align="end"
                            sideOffset={4}
                            collisionPadding={8}
                            aria-label="All maps"
                            onContextMenu={(event) => event.preventDefault()}
                        >
                            <DropdownMenu.RadioGroup
                                value={activeId ?? ""}
                                onValueChange={(id) => activateMap(id)}
                            >
                                {tabs.map((tab) => (
                                    <DropdownMenu.RadioItem
                                        key={tab.id}
                                        className="ui-menu__item"
                                        value={tab.id}
                                        data-tab-item={tab.id}
                                    >
                                        <span className="map-tabs__item-name">{tab.name}</span>
                                    </DropdownMenu.RadioItem>
                                ))}
                            </DropdownMenu.RadioGroup>
                        </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                </DropdownMenu.Root>
            ) : null}
        </div>
    );
}
