import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import { chordKey, normalizeChord } from "../commands/chord";
import { sessionStore } from "../state/session";
import type { SessionState } from "../state/session";
import { statusStore } from "../state/status";
import type { StatusState } from "../state/status";
import { optionValues } from "./options";
import type { ToolOptions } from "./options";
import { slotOf } from "./registry";
import type { ToolRegistry } from "./registry";
import { toolRegistry } from "./toolRegistry";
import { activeLayerKind, offersTool } from "./toolSets";
import type { RailSlot, Tool, ToolLayerKind, ToolOptionValue } from "./types";

// Which tool acts (DESIGN §6). The user selects a tool from the rail or with its key; the
// active-tool store keeps that choice per layer kind, so switching the active layer between
// kinds brings back each kind's last tool (DESIGN §6). A tool is selected only into the set of
// the active layer's kind. A key held for a temporary tool makes that tool the active one
// until it is released, and the selected tool acts again. The active tool is what the rail
// marks, the context bar shows and the pointer pipeline uses.

/** What the active-tool store holds; not persisted. */
export interface ActiveToolStoreState {
    /** The tool selected last in each kind's set; it need not be registered (yet). */
    selected: Readonly<Record<ToolLayerKind, string>>;
    /** What the user set of each tool's options, by tool id. */
    options: Readonly<Record<string, ToolOptions>>;
}

/** The tools a kind starts with: the first of its set (DESIGN §6), Hand without one. */
export const DEFAULT_TOOLS: Readonly<Record<ToolLayerKind, string>> = {
    tile: "stamp",
    marker: "markerSelect",
    none: "hand",
};

export function createActiveToolStore(): StoreApi<ActiveToolStoreState> {
    return createStore<ActiveToolStoreState>(() => ({ selected: DEFAULT_TOOLS, options: {} }));
}

export interface ToolState {
    readonly registry: ToolRegistry;
    /** The kind of the active layer, whose tool set the rail shows. */
    kind(): ToolLayerKind;
    /** The id of the tool selected for the active layer's kind. */
    selectedId(): string;
    /** That tool, or null while no tool has that id. */
    selected(): Tool | null;
    /** The id of the active tool: the tool of the key held last, or else the selected one. */
    activeId(): string;
    /** The active tool, or null while no tool has that id. */
    active(): Tool | null;
    /** Ids of the tools whose hold key is down, the latest last. */
    held(): readonly string[];
    /**
     * Selects a registered tool of the active layer's set; returns false (and changes
     * nothing) for any other id.
     */
    select(id: string): boolean;
    /** Whether the active layer's set holds the registered tool `id`. */
    offered(id: string): boolean;
    /**
     * The tool a tool's key switches to when it is pressed again while that tool is selected
     * (DESIGN §10.3): the next, after it, of the variants of its rail slot whose key is the
     * same letter (U and Shift+U; after the last, the first). Null when it has none.
     */
    nextVariant(id: string): Tool | null;
    /**
     * The tool a rail slot's button shows: the active tool when it is one of the slot's,
     * else the slot's tool selected last, else `slot.tool`.
     */
    shownInSlot(slot: RailSlot): Tool | null;
    /** Makes a registered tool of the active layer's set the active one while its key is held. */
    hold(id: string): void;
    /** The key of a held tool came up: the tool before it acts again. */
    release(id: string): void;
    /** The values of a tool's options: the defaults, with what the user set over them. */
    options(tool: Tool): Readonly<Record<string, ToolOptionValue>>;
    /** Sets one option of a tool. */
    setOption(tool: Tool, key: string, value: ToolOptionValue): void;
    /**
     * Calls `listener` when the active or the selected tool, the active layer's kind, a hold,
     * an option value or the registry changes. Returns the function that stops it.
     */
    subscribe(listener: () => void): () => void;
    /** Changes whenever `subscribe` listeners are called; a snapshot for React. */
    version(): number;
}

/** The key of a tool's chord without its modifiers ("U" for Shift+U); null without a key. */
function keyOf(tool: Tool | undefined): string | null {
    return tool?.shortcut === undefined ? null : chordKey(normalizeChord(tool.shortcut));
}

/** The tool state of a session store and a registry. The app has one: `toolState`. */
export function createToolState(
    session: StoreApi<SessionState>,
    registry: ToolRegistry,
    store: StoreApi<ActiveToolStoreState> = createActiveToolStore(),
): ToolState {
    let held: readonly string[] = [];
    let version = 0;
    const listeners = new Set<() => void>();
    const changed = () => {
        version++;
        for (const listener of [...listeners]) listener();
    };

    const kindOf = () => activeLayerKind(session.getState().session);
    const selectedId = () => store.getState().selected[kindOf()];
    const activeId = () => held[held.length - 1] ?? selectedId();
    const offered = (id: string) => {
        const tool = registry.get(id);
        return tool !== undefined && offersTool(tool, kindOf());
    };
    // Option values are made once per stored record, so React sees a stable snapshot.
    const values = new WeakMap<
        Tool,
        { stored: ToolOptions | undefined; values: Record<string, ToolOptionValue> }
    >();

    /** The tool of each rail slot selected last, by slot id. */
    const lastInSlot = new Map<string, string>();
    const remember = (id: string) => {
        const tool = registry.get(id);
        if (tool) lastInSlot.set(slotOf(tool), id);
    };
    for (const id of Object.values(store.getState().selected)) remember(id);

    store.subscribe((state, previous) => {
        if (state.selected !== previous.selected) remember(selectedId());
        changed();
    });
    let kind = kindOf();
    session.subscribe(() => {
        const next = kindOf();
        if (next === kind) return;
        kind = next;
        // A held tool the new set does not hold stops acting.
        held = held.filter(offered);
        changed();
    });
    registry.subscribe(() => {
        // A tool selected before it was registered counts once it is.
        for (const id of Object.values(store.getState().selected)) remember(id);
        changed();
    });

    return {
        registry,
        kind: kindOf,
        selectedId,
        selected: () => registry.get(selectedId()) ?? null,
        activeId,
        active: () => registry.get(activeId()) ?? null,
        held: () => held,
        offered,
        select(id) {
            if (!offered(id)) return false;
            const { selected } = store.getState();
            if (selected[kindOf()] !== id) {
                store.setState({ selected: { ...selected, [kindOf()]: id } });
            }
            return true;
        },
        nextVariant(id) {
            const tool = registry.get(id);
            const letter = keyOf(tool);
            if (!tool || letter === null) return null;
            const slot = registry.railSlots().find((entry) => entry.id === slotOf(tool));
            const group = (slot?.variants ?? []).filter((variant) => keyOf(variant) === letter);
            const index = group.indexOf(tool);
            if (index < 0 || group.length < 2) return null;
            return group[(index + 1) % group.length] ?? null;
        },
        shownInSlot(slot) {
            const active = registry.get(activeId());
            if (active && slot.variants.includes(active)) return active;
            const last = lastInSlot.get(slot.id);
            const remembered = slot.variants.find((variant) => variant.id === last);
            return remembered ?? slot.tool;
        },
        hold(id) {
            if (!offered(id)) return;
            held = [...held.filter((entry) => entry !== id), id];
            changed();
        },
        release(id) {
            if (!held.includes(id)) return;
            held = held.filter((entry) => entry !== id);
            changed();
        },
        options(tool) {
            const stored = store.getState().options[tool.id];
            const known = values.get(tool);
            if (known && known.stored === stored) return known.values;
            const next = optionValues(tool.options, stored);
            values.set(tool, { stored, values: next });
            return next;
        },
        setOption(tool, key, value) {
            const { options } = store.getState();
            store.setState({
                options: { ...options, [tool.id]: { ...options[tool.id], [key]: value } },
            });
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        version: () => version,
    };
}

/**
 * Keeps the hint of the status bar on the active tool's (DESIGN §8.7): its `hint`, or none.
 * Returns the function that stops it.
 */
export function followToolHint(state: ToolState, status: StoreApi<StatusState>): () => void {
    const show = () => {
        const hint = state.active()?.hint ?? null;
        if (status.getState().hint !== hint) status.getState().setHint(hint);
    };
    show();
    return state.subscribe(show);
}

/** The tool state of the app. */
export const toolState = createToolState(sessionStore, toolRegistry);

followToolHint(toolState, statusStore);
