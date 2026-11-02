import type { LucideIcon } from "lucide-react";
import type { PixelPoint } from "../../core/raster/line";
import type { History } from "../../core/history";
import type { ProjectMap, ProjectSession } from "../../core/model";
import type { Point } from "../view/coordinates";

// The tools of the editor (SPEC §4, DESIGN §6): what a feature implements to add one. A tool is
// a `ToolSpec` exported from a module of its own named `*.tools.ts`; `toolRegistry.ts` explains
// how it is found. The pointer pipeline (`pipeline.ts`) calls the active tool's handlers with
// pointer samples in map coordinates and cells and, for a tool that paints, an open
// transaction on the active tile layer.

/**
 * The buttons a tool tells apart: left and right (SPEC §4.3: a right drag captures a stamp or
 * erases a rectangle).
 */
export type ToolButton = "primary" | "secondary";

/**
 * The layer kinds the rail offers tool sets for (DESIGN §6): a tile layer, a marker layer, and
 * everything else — an image or group layer, or no layer — which has no editing tools.
 */
export type ToolLayerKind = "tile" | "marker" | "none";

/** Modifier keys held at a pointer sample or a key event. */
export interface ToolModifiers {
    shift: boolean;
    ctrl: boolean;
    alt: boolean;
    meta: boolean;
}

/** One position of the pointer during a stroke, as a tool receives it. */
export interface ToolPointer {
    /** Client position, CSS pixels, as the pointer event reported it. */
    readonly client: Point;
    /**
     * Position in the device pixels of the viewport element, with its fraction: the space of
     * `panBy` and of the anchors of `zoomBy`.
     */
    readonly device: Point;
    /** The map position, map pixels with their fraction. */
    readonly position: Point;
    /** The cell under the pointer: `floor` of the map position, also outside the map. */
    readonly cell: PixelPoint;
    /**
     * The cells the pointer crossed since the previous sample of the stroke, in order, this
     * sample's cell last (`pointsOnLine`, SPEC §4.1): no cell of a fast drag is skipped. The
     * press's sample and a hover carry their own cell only; a sample in the cell of the one
     * before carries none.
     */
    readonly cells: readonly PixelPoint[];
    /** Whether `cell` lies inside the map. */
    readonly inside: boolean;
    /** The button that began the stroke. */
    readonly button: ToolButton;
    readonly modifiers: Readonly<ToolModifiers>;
    /** Time stamp of the event, in milliseconds. */
    readonly time: number;
}

/** A key going down or up while a stroke is in progress (`ToolSpec.onKey`). */
export interface ToolKey {
    readonly type: "down" | "up";
    /** The key as chords name it: "Shift", "Alt", "Enter", "B" (`commands/chord.ts`). */
    readonly key: string;
    /** The modifiers held after the event. */
    readonly modifiers: Readonly<ToolModifiers>;
    /** A key-down repeated by the keyboard. */
    readonly repeat: boolean;
}

/**
 * The cells of a painting stroke (SPEC §3): one transaction on the active tile layer, opened
 * by the pipeline before `onDown` and committed after `onUp` as one undo step labelled with
 * the tool's name, or aborted by Escape, a pointer cancel or a right click during the drag.
 */
export interface PaintStroke {
    readonly mapId: string;
    readonly layerId: number;
    readonly map: ProjectMap;
    /**
     * The value of a cell of the layer, 0 when empty or outside the map. `layer` reads
     * another of `paintableLayers` instead.
     */
    get(x: number, y: number, layer?: number): number;
    /**
     * Writes `value` (0 empties) to a cell of the layer. Painting is clipped to the map and
     * to its tile selection as at the press (SPEC §4.1): a cell outside them is left alone. The viewport shows the change before
     * the stroke ends. `layer` writes another of `paintableLayers` instead (the eraser's
     * all-layers mode, SPEC §4.3); any other layer is left alone.
     */
    set(x: number, y: number, value: number, layer?: number): void;
    /**
     * The tile layers of the map a tool may write besides `layerId`, as they are at the
     * pointer down: visible and unlocked, under no hidden or locked group (SPEC §4.1),
     * bottom to top, `layerId` among them.
     */
    readonly paintableLayers: readonly number[];
}

/** What a tool works with during one stroke, from its pointer down to its end. */
export interface ToolContext {
    readonly session: ProjectSession;
    readonly history: History;
    /** The active map at the pointer down. */
    readonly map: ProjectMap;
    /** The active layer of that map at the pointer down; null when it has none. */
    readonly layerId: number | null;
    /** The button that began the stroke. */
    readonly button: ToolButton;
    /** The tool's option values: each option's default, or the value the user set. */
    readonly options: Readonly<Record<string, ToolOptionValue>>;
    /** For a tool that paints (`ToolSpec.paints`): the stroke's cells; null otherwise. */
    readonly paint: PaintStroke | null;
    /** Shows transient tool feedback in the status bar (DESIGN §8.7). */
    feedback(message: string): void;
    /**
     * Makes this stroke a gesture of several presses (DESIGN §10.1, the `gesture` context):
     * it does not end at the release but takes the next presses too, each with `onDown`, its
     * moves and `onUp`, and the moves between them (`onHover`), until it is closed — Enter, or
     * a double click: `onClose`, then it is kept as at a release — or cancelled: Escape, a
     * pointer cancel during a press, a change of the active tool, map or layer (`onCancel`).
     * Called from a handler of the stroke; after the stroke ended it does nothing.
     */
    openGesture(): void;
    /**
     * Closes this stroke's open gesture as Enter does: `onClose`, then it is kept as at a
     * release. Called from a handler of the stroke; when no gesture of the stroke is open it
     * does nothing. Called from `onDown`, the press ends with the gesture: its release finds
     * no stroke.
     */
    closeGesture(): void;
}

/** What a tool's cursor depends on (`ToolSpec.cursor`). */
export interface ToolCursorState {
    /** The modifier keys held. */
    readonly modifiers: Readonly<ToolModifiers>;
    /** A stroke of this tool is in progress. */
    readonly pressed: boolean;
    /** The pointer is over a cell of the map. */
    readonly overMap: boolean;
}

export type ToolOptionValue = number | boolean | string;

interface ToolOptionBase {
    /** The option's name in the tool's options: "allLayers". */
    key: string;
    /** Label in the context bar: "All layers". */
    label: string;
}

/** A number, shown as a number field (DESIGN §7). */
export interface NumberToolOption extends ToolOptionBase {
    kind: "number";
    min: number;
    max: number;
    /** Step of the arrow keys and the grid values snap to; the default is 1. */
    step?: number;
    /** Unit shown after the value: "px", "%". */
    unit?: string;
    default: number;
}

/** On or off, shown as a toggle with its label (DESIGN §7). */
export interface ToggleToolOption extends ToolOptionBase {
    kind: "toggle";
    default: boolean;
}

/** One of a few values, shown as a segmented control, or as a select with `display`. */
export interface ChoiceToolOption extends ToolOptionBase {
    kind: "choice";
    choices: readonly { value: string; label: string }[];
    default: string;
    /** The default is "segmented". */
    display?: "segmented" | "select";
}

/**
 * One option of a tool. The context bar shows the active tool's options in the order the tool
 * lists them (DESIGN §7).
 */
export type ToolOptionSpec = NumberToolOption | ToggleToolOption | ChoiceToolOption;

/**
 * A value a tool shows in the context bar and the user does not set: its label, then its text
 * (DESIGN §7: the stamp brush's stamp size `w × h`). Shown after the tool's options.
 */
export interface ToolReadout {
    /** Stable within the tool: "size". */
    key: string;
    /** Label in the context bar: "Stamp size". */
    label: string;
    /** The text shown now. Must not throw. */
    read(): string;
    /** Calls `listener` whenever `read` may have changed; returns the unsubscribe. */
    subscribe(listener: () => void): () => void;
}

/**
 * A button of the context bar that runs a registered command (DESIGN §7: the stamp brush's
 * rotate and flip buttons). Shown after the tool's options, before its readouts; disabled
 * while the command is.
 */
export interface ToolAction {
    /** The id of the command it runs: "stamp.rotateLeft". */
    command: string;
    /** Text of a text button, or the tooltip and accessible name of an icon button. */
    label: string;
    /** Makes it an icon button. */
    icon?: LucideIcon;
}

/**
 * A key that makes a tool the active one while it is held. It acts in the `canvas` context;
 * a key that controls consume natively only while the viewport element itself has the focus
 * (`tools.commands.ts`). No tool holds one yet: Space pans through `view.panHold`.
 */
export interface ToolHold {
    /** The chord of the held key. Bound in the `canvas` context. */
    key: string;
    /**
     * Whether holding the key takes this tool now, given the tool the user selected (null
     * when that tool is not registered). The default is always.
     */
    when?(selected: Tool | null): boolean;
}

/**
 * A tool, as its module declares it. Every handler is optional. For one pointer down the
 * pipeline calls `onDown`, `onMove` for every sample (coalesced events included), and then
 * exactly one of `onUp` or `onCancel`; strokes never overlap. A gesture
 * (`ToolContext.openGesture`) repeats that for each of its presses, with `onHover` between
 * them, and ends with `onClose` or `onCancel`.
 */
export interface ToolSpec {
    /** Stable and unique: "stamp". The id of a planned rail slot takes that slot. */
    id: string;
    /** Name in the rail's tooltip, the context bar and the undo step: "Stamp Brush". */
    label: string;
    /** Rail icon; a planned slot supplies one when the tool does not. */
    icon?: LucideIcon;
    /** Key that selects the tool, bound in the `canvas` context (DESIGN §10.3): "B". */
    shortcut?: string;
    /**
     * Position in the tool rail, ascending; tools whose positions differ in the hundreds are
     * in different groups (DESIGN §6). A tool without one takes the position of the planned
     * slot of its id, or is not in the rail. For a variant (`variantOf`) it orders the
     * variants of its slot.
     */
    railOrder?: number;
    /**
     * The rail slot this tool shares as a variant (DESIGN §6): the id of the slot's own tool
     * or planned slot. The slot's button shows the variant selected last, with a corner mark;
     * holding it opens the menu of its variants, and a tool key pressed while a tool of the
     * slot is selected selects the slot's next variant.
     */
    variantOf?: string;
    /**
     * The tool's name among the variants of its rail slot in the context bar (DESIGN §7: the
     * shape fill's Rectangle / Ellipse). While a tool with one is active, the context bar shows
     * after its options a choice of the slot's variants that have one, which selects the
     * variant chosen.
     */
    variantLabel?: string;
    /**
     * The layer kinds whose tool set holds this tool (DESIGN §6); a tool without it is in
     * every set, as Hand and Zoom are. A tool without it takes the kinds of the planned slot
     * of its rail slot.
     */
    layers?: readonly ToolLayerKind[];
    /** One-line hint for the tool's modifiers, shown in the status bar while it is active. */
    hint?: string;
    /** The options the context bar shows while the tool is active. */
    options?: readonly ToolOptionSpec[];
    /** Command buttons the context bar shows after the options while the tool is active. */
    actions?: readonly ToolAction[];
    /** Values the context bar shows after the options while the tool is active. */
    readouts?: readonly ToolReadout[];
    /**
     * The tool writes cells of the active layer: the pipeline resolves the target before
     * `onDown` (SPEC §4.1: a visible, unlocked tile layer, not under a hidden or locked group)
     * and opens the stroke's transaction (`ToolContext.paint`). When the target is refused the
     * status bar says why and no handler is called. A function decides by the button that
     * began the stroke (a right drag of the stamp brush captures and paints nothing).
     */
    paints?: boolean | ((button: ToolButton) => boolean);
    /** A key that makes this tool the active one while it is held. */
    hold?: ToolHold;
    /** CSS cursor over the viewport while the tool is active; the default is "default". */
    cursor?: string | ((state: ToolCursorState) => string);
    onDown?(context: ToolContext, pointer: ToolPointer): void;
    onMove?(context: ToolContext, pointer: ToolPointer): void;
    /**
     * The button was released: the stroke ends, and a paint stroke is committed after this;
     * a gesture (`ToolContext.openGesture`) stays open for its next press.
     */
    onUp?(context: ToolContext, pointer: ToolPointer): void;
    /**
     * The pointer moved over the viewport with no button held, between the presses of this
     * tool's open gesture: once per pointer event, at the last of its coalesced samples.
     */
    onHover?(context: ToolContext, pointer: ToolPointer): void;
    /**
     * The open gesture was closed: Enter (DESIGN §10.3, `gesture`) or a double click. The
     * stroke is kept after this, as at a release: committed, then `onCommit`.
     */
    onClose?(context: ToolContext): void;
    /**
     * The stroke was cancelled (Escape, a pointer cancel, a right click during the drag, the
     * map or layer changed; for a gesture also a change of the active tool): a paint stroke's
     * cells are put back after this.
     */
    onCancel?(context: ToolContext): void;
    /**
     * A key went down or up while a stroke of this tool is in progress. Returns true when the
     * tool used it: the key's default is prevented and no shortcut acts on it. Escape is never
     * passed here; it cancels the stroke.
     */
    onKey?(context: ToolContext, key: ToolKey): boolean;
    /**
     * The stroke ended at its release (`onUp`) and was kept: for a tool that paints, after
     * its transaction was committed, `recorded` when that made a history entry and false
     * when the stroke changed nothing. Not called when the stroke was cancelled, nor when its
     * cells were put back because they could not be committed.
     */
    onCommit?(context: ToolContext, recorded: boolean): void;
}

/** A registered tool: its spec, with what its planned slot supplies. */
export interface Tool extends ToolSpec {
    /** The module that registered it; used in error messages. */
    readonly source: string;
    readonly options: readonly ToolOptionSpec[];
    /** Its position in the rail, or null when it is not in the rail. */
    readonly railOrder: number | undefined;
}

/**
 * A slot of the tool rail for a tool a later ticket implements (DESIGN §6): shown disabled
 * until a tool with the same id is registered, which then takes it over.
 */
export interface PlannedToolSpec {
    id: string;
    label: string;
    shortcut?: string;
    icon: LucideIcon;
    railOrder: number;
    /** The layer kinds whose tool set holds the slot; every kind when absent. */
    layers?: readonly ToolLayerKind[];
}

/** What a `*.tools.ts` module exports (at least one of the two). */
export interface ToolModule {
    tools?: readonly ToolSpec[];
    plannedTools?: readonly PlannedToolSpec[];
}

/** One button of the tool rail: a registered tool, or the planned slot of one. */
export interface RailSlot {
    readonly id: string;
    readonly label: string;
    readonly shortcut: string | undefined;
    readonly icon: LucideIcon | undefined;
    readonly railOrder: number;
    /**
     * The tool of the slot's id, or the first of its variants when there is none; null while
     * the slot is planned only.
     */
    readonly tool: Tool | null;
    /**
     * Every tool of the slot: the tool of its id first, then the tools that name it in
     * `variantOf`, by their `railOrder` and then their id. More than one means the button
     * switches between them.
     */
    readonly variants: readonly Tool[];
}
