import { describe, expect, it } from "vitest";
import { createCommandRegistry } from "../../src/app/commands/registry";
import type { CommandRegistry } from "../../src/app/commands/registry";
import { KEY_CONTEXTS, MENU_BAR } from "../../src/app/commands/types";
import type { CommandSpec, KeyContext } from "../../src/app/commands/types";
import {
    isTextField,
    nativeKeysOf,
    OVERLAY_SELECTOR,
    PANEL_SELECTOR,
    readKeyEnvironment,
    VIEWPORT_FOCUS_ATTRIBUTE,
} from "../../src/app/keymap/environment";
import type { FocusedElement, KeymapDocument } from "../../src/app/keymap/environment";
import { installKeymap } from "../../src/app/keymap/install";
import { applicableContexts, resolveKey } from "../../src/app/keymap/resolve";
import type { KeyEnvironment } from "../../src/app/keymap/resolve";

// TE-007: the keymap contexts of DESIGN §10.1, their resolution and the keyboard listener.
// Adapted from the sprite editor's se-007-keymap.test.ts: `markers` and `panel` take the
// place of `floating` and `timeline`.

/** Focus on the viewport, nothing open, no gesture and no marker selection. */
const VIEWPORT: KeyEnvironment = {
    overlayOpen: false,
    focus: "viewport",
    inPanel: false,
    nativeKeys: new Set(),
    typeahead: false,
    gesture: false,
    markers: false,
};
const TEXT: KeyEnvironment = { ...VIEWPORT, focus: "text" };
const BODY: KeyEnvironment = { ...VIEWPORT, focus: "none", nativeKeys: new Set(["Tab"]) };
const BUTTON: KeyEnvironment = {
    ...VIEWPORT,
    focus: "control",
    nativeKeys: new Set(["Enter", "Space", "Tab"]),
};
const SLIDER: KeyEnvironment = {
    ...VIEWPORT,
    focus: "control",
    nativeKeys: new Set([
        "Enter",
        "Space",
        "Tab",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
    ]),
};
const SELECT: KeyEnvironment = { ...SLIDER, typeahead: true };
/** Focus on a tile of the Tilesets panel: a focusable element without keys of its own. */
const PANEL_CELL: KeyEnvironment = {
    ...VIEWPORT,
    focus: "control",
    inPanel: true,
    nativeKeys: new Set(["Tab"]),
};

interface Fixture {
    registry: CommandRegistry;
    calls: string[];
    /** Adds a command whose run is recorded under its id. */
    add(id: string, shortcut: string | string[], context?: KeyContext | KeyContext[]): void;
    /** Ids of disabled commands. */
    disabled: Set<string>;
}

function fixture(): Fixture {
    const registry = createCommandRegistry();
    const calls: string[] = [];
    const disabled = new Set<string>();
    return {
        registry,
        calls,
        disabled,
        add(id, shortcut, context) {
            const spec: CommandSpec = {
                id,
                title: id,
                shortcut,
                context,
                enabled: () => !disabled.has(id),
                run: () => void calls.push(id),
            };
            registry.register(spec);
        },
    };
}

/** The id the chord resolves to, or the action when it resolves to no command. */
function resolved(registry: CommandRegistry, chord: string, environment: KeyEnvironment): string {
    const resolution = resolveKey(registry, chord, environment);
    return resolution.action === "run"
        ? `${resolution.context}:${resolution.command.id}`
        : resolution.action;
}

describe("applicable contexts (DESIGN §10.1)", () => {
    it("lists the contexts in the priority order of DESIGN §10.1", () => {
        expect(KEY_CONTEXTS).toEqual(["text", "gesture", "markers", "panel", "canvas", "global"]);
        expect(applicableContexts({ ...PANEL_CELL, gesture: true, markers: true })).toEqual([
            "gesture",
            "markers",
            "panel",
            "canvas",
            "global",
        ]);
    });

    it("names the menus of DESIGN §5 in order", () => {
        expect(MENU_BAR).toEqual(["File", "Edit", "Map", "Layer", "Tileset", "Select", "View"]);
    });

    it("applies canvas and global in the normal state", () => {
        expect(applicableContexts(VIEWPORT)).toEqual(["canvas", "global"]);
        expect(applicableContexts(BUTTON)).toEqual(["canvas", "global"]);
        expect(applicableContexts(BODY)).toEqual(["canvas", "global"]);
    });

    it("adds panel, markers and gesture when their conditions hold", () => {
        expect(applicableContexts(PANEL_CELL)).toEqual(["panel", "canvas", "global"]);
        expect(applicableContexts({ ...VIEWPORT, markers: true })).toEqual([
            "markers",
            "canvas",
            "global",
        ]);
        expect(applicableContexts({ ...VIEWPORT, gesture: true })).toEqual([
            "gesture",
            "canvas",
            "global",
        ]);
    });

    it("applies only text while a text field has focus", () => {
        expect(applicableContexts({ ...TEXT, inPanel: true, markers: true })).toEqual(["text"]);
    });

    it("applies none while a menu, dialog or popover is open", () => {
        expect(applicableContexts({ ...VIEWPORT, overlayOpen: true })).toEqual([]);
        expect(applicableContexts({ ...TEXT, overlayOpen: true })).toEqual([]);
    });
});

describe("keymap resolution follows context priority", () => {
    it("resolves a key in the first context that applies and binds it", () => {
        const { registry, add } = fixture();
        add("clear-selection", "Escape", ["canvas", "panel"]);
        add("deselect-markers", "Escape", "markers");
        add("cancel-gesture", "Escape", "gesture");

        expect(resolved(registry, "Escape", VIEWPORT)).toBe("canvas:clear-selection");
        expect(resolved(registry, "Escape", PANEL_CELL)).toBe("panel:clear-selection");
        expect(resolved(registry, "Escape", { ...VIEWPORT, markers: true })).toBe(
            "markers:deselect-markers",
        );
        expect(resolved(registry, "Escape", { ...PANEL_CELL, markers: true })).toBe(
            "markers:deselect-markers",
        );
        expect(resolved(registry, "Escape", { ...VIEWPORT, markers: true, gesture: true })).toBe(
            "gesture:cancel-gesture",
        );
    });

    it("orders every pair of contexts: the higher one wins", () => {
        const environments: Record<Exclude<KeyContext, "text">, Partial<KeyEnvironment>> = {
            gesture: { gesture: true },
            markers: { markers: true },
            panel: { inPanel: true },
            canvas: {},
            global: {},
        };
        const order = KEY_CONTEXTS.filter((context) => context !== "text");
        for (const [index, higher] of order.entries()) {
            for (const lower of order.slice(index + 1)) {
                const { registry, add } = fixture();
                add("lower", "Ctrl+J", lower);
                add("higher", "Ctrl+J", higher);
                const environment = {
                    ...VIEWPORT,
                    ...environments[higher],
                    ...environments[lower],
                };
                expect(resolved(registry, "Ctrl+J", environment), `${higher} over ${lower}`).toBe(
                    `${higher}:higher`,
                );
            }
        }
    });

    it("falls back to canvas and global for keys a higher context does not bind", () => {
        const { registry, add } = fixture();
        add("rename", "F2", "panel");
        add("stamp", "B", "canvas");
        add("save", "Ctrl+S", ["global", "text"]);
        expect(resolved(registry, "F2", PANEL_CELL)).toBe("panel:rename");
        expect(resolved(registry, "B", PANEL_CELL)).toBe("canvas:stamp");
        expect(resolved(registry, "Ctrl+S", PANEL_CELL)).toBe("global:save");
        expect(resolved(registry, "B", { ...VIEWPORT, markers: true })).toBe("canvas:stamp");
    });

    it("does not try a lower context when the winning binding is disabled", () => {
        const { registry, add, disabled } = fixture();
        add("nudge", "ArrowLeft", "markers");
        add("select-layer", "ArrowLeft", "canvas");
        disabled.add("nudge");
        const resolution = resolveKey(registry, "ArrowLeft", { ...VIEWPORT, markers: true });
        expect(resolution).toMatchObject({ action: "run", context: "markers" });
        expect(resolution.action === "run" && resolution.command.enabled()).toBe(false);
        expect(resolved(registry, "ArrowLeft", VIEWPORT)).toBe("canvas:select-layer");
    });

    it("picks the enabled command among several that share a chord in one context", () => {
        const { registry, add, disabled } = fixture();
        add("rectangle-fill", "U", "canvas");
        add("rectangle-marker", "U", "canvas");
        disabled.add("rectangle-fill");
        expect(resolved(registry, "U", VIEWPORT)).toBe("canvas:rectangle-marker");
        disabled.delete("rectangle-fill");
        disabled.add("rectangle-marker");
        expect(resolved(registry, "U", VIEWPORT)).toBe("canvas:rectangle-fill");
    });

    it("passes a key nothing binds", () => {
        const { registry } = fixture();
        for (const chord of ["B", "Ctrl+S", "F5", "Tab", "Alt"]) {
            expect(resolved(registry, chord, VIEWPORT), chord).toBe("pass");
        }
    });
});

describe("text context: † chords act while a text field has focus (DESIGN §10.3)", () => {
    const setup = () => {
        const value = fixture();
        value.add("stamp", "B", "canvas");
        value.add("zoom-tool", "Z", "canvas");
        value.add("new-tile-layer", "Shift+N", "global");
        value.add("undo", "Ctrl+Z", "global");
        value.add("redo", ["Ctrl+Y", "Ctrl+Shift+Z"], "global");
        value.add("select-all", "Ctrl+A", "global");
        value.add("select-none", "Ctrl+D", "global");
        value.add("grid", "Ctrl+G", "global");
        value.add("delete", "Delete", "global");
        value.add("finish", "Enter", "gesture");
        value.add("save", "Ctrl+S", ["global", "text"]);
        value.add("save-as", "Ctrl+Shift+S", ["global", "text"]);
        value.add("open", "Ctrl+O", ["global", "text"]);
        value.add("new-project", "Ctrl+Alt+N", ["global", "text"]);
        value.add("new-map", "Ctrl+Alt+M", ["global", "text"]);
        value.add("close-map", "Alt+W", ["global", "text"]);
        value.add("export", "Ctrl+E", ["global", "text"]);
        value.add("export-again", "Ctrl+Shift+X", ["global", "text"]);
        value.add("palette", "Ctrl+K", ["global", "text"]);
        value.add("next-region", "F6", ["global", "text"]);
        value.add("previous-region", "Shift+F6", ["global", "text"]);
        return value;
    };

    it("leaves typing to the field", () => {
        const { registry } = setup();
        for (const chord of [
            "B",
            "Z",
            "Shift+N",
            "Enter",
            "Delete",
            "Escape",
            "Tab",
            "ArrowLeft",
        ]) {
            expect(resolved(registry, chord, TEXT), chord).toBe("pass");
        }
    });

    it("leaves Ctrl+Z/Y/A and Ctrl+Shift+Z to the field", () => {
        const { registry } = setup();
        for (const chord of ["Ctrl+Z", "Ctrl+Y", "Ctrl+Shift+Z", "Ctrl+A"]) {
            expect(resolved(registry, chord, TEXT), chord).toBe("pass");
        }
    });

    it("still runs every chord marked † in DESIGN §10.3", () => {
        const { registry } = setup();
        const marked: [chord: string, id: string][] = [
            ["Ctrl+S", "save"],
            ["Ctrl+Shift+S", "save-as"],
            ["Ctrl+O", "open"],
            ["Ctrl+Alt+N", "new-project"],
            ["Ctrl+Alt+M", "new-map"],
            ["Alt+W", "close-map"],
            ["Ctrl+E", "export"],
            ["Ctrl+Shift+X", "export-again"],
            ["Ctrl+K", "palette"],
            ["F6", "next-region"],
            ["Shift+F6", "previous-region"],
        ];
        for (const [chord, id] of marked) {
            expect(resolved(registry, chord, TEXT), chord).toBe(`text:${id}`);
            // The same chord acts everywhere else too.
            expect(resolved(registry, chord, VIEWPORT), chord).toBe(`global:${id}`);
            expect(resolved(registry, chord, PANEL_CELL), chord).toBe(`global:${id}`);
        }
    });

    it("suppresses the browser default of other bound Ctrl/Alt/F-key chords", () => {
        const { registry } = setup();
        for (const chord of ["Ctrl+D", "Ctrl+G"]) {
            expect(resolved(registry, chord, TEXT), chord).toBe("suppress");
        }
        // Not bound by anything: the browser keeps it.
        expect(resolved(registry, "Ctrl+P", TEXT)).toBe("pass");
        expect(resolved(registry, "F5", TEXT)).toBe("pass");
    });

    it("rejects a text binding that would take a key from the field", () => {
        const registry = createCommandRegistry();
        const bind = (shortcut: string) =>
            registry.register({ id: shortcut, title: "x", shortcut, context: "text", run() {} });
        for (const chord of [
            "B",
            "Enter",
            "Shift+N",
            "Delete",
            "Ctrl+Z",
            "Ctrl+V",
            "Ctrl+Shift+Z",
        ]) {
            expect(() => bind(chord), chord).toThrow(/in the text context/);
        }
        expect(() => bind("Ctrl+S")).not.toThrow();
        expect(() => bind("F6")).not.toThrow();
    });
});

describe("keys a focused control consumes natively", () => {
    const setup = () => {
        const value = fixture();
        value.add("finish", "Enter", ["canvas", "gesture"]);
        value.add("hand", "Space", "canvas");
        value.add("toggle-panel", "Tab", "canvas");
        value.add("cancel", "Escape", "canvas");
        value.add("layer-above", "ArrowUp", "canvas");
        value.add("stamp", "B", "canvas");
        value.add("zoom-1", "1", "canvas");
        value.add("save", "Ctrl+S", "global");
        value.add("rename", "F2", "panel");
        value.add("previous-tileset", "[", ["canvas", "panel"]);
        value.add("nudge", "ArrowRight", "markers");
        value.add("deselect-markers", "Escape", "markers");
        return value;
    };

    it("runs the canvas bindings of native keys only while the viewport itself is focused", () => {
        const { registry } = setup();
        const bindings: [chord: string, id: string][] = [
            ["Enter", "finish"],
            ["Space", "hand"],
            ["Tab", "toggle-panel"],
            ["Escape", "cancel"],
            ["ArrowUp", "layer-above"],
        ];
        for (const [chord, id] of bindings) {
            expect(resolved(registry, chord, VIEWPORT), chord).toBe(`canvas:${id}`);
            expect(resolved(registry, chord, BUTTON), chord).toBe("pass");
            expect(resolved(registry, chord, SLIDER), chord).toBe("pass");
            expect(resolved(registry, chord, BODY), chord).toBe("pass");
        }
    });

    it("runs letter, digit and modified chords throughout the canvas context", () => {
        const { registry } = setup();
        for (const environment of [VIEWPORT, BUTTON, SLIDER, BODY, PANEL_CELL]) {
            expect(resolved(registry, "B", environment)).toBe("canvas:stamp");
            expect(resolved(registry, "1", environment)).toBe("canvas:zoom-1");
            expect(resolved(registry, "Ctrl+S", environment)).toBe("global:save");
        }
    });

    it("gives a select its typeahead characters and still runs modified chords", () => {
        const { registry } = setup();
        expect(resolved(registry, "B", SELECT)).toBe("pass");
        expect(resolved(registry, "1", SELECT)).toBe("pass");
        expect(resolved(registry, "Ctrl+S", SELECT)).toBe("global:save");
    });

    it("in a panel a focused tile takes F2 and [, a tab strip keeps its arrows", () => {
        const { registry } = setup();
        expect(resolved(registry, "F2", PANEL_CELL)).toBe("panel:rename");
        expect(resolved(registry, "[", PANEL_CELL)).toBe("panel:previous-tileset");
        expect(resolved(registry, "[", VIEWPORT)).toBe("canvas:previous-tileset");
        // The tab strip of the bottom panel: arrows are its own.
        expect(resolved(registry, "ArrowUp", { ...SLIDER, inPanel: true })).toBe("pass");
        // Tab is never the panel's: it moves focus.
        expect(resolved(registry, "Tab", PANEL_CELL)).toBe("pass");
    });

    it("lets a focused control keep its keys while markers are selected", () => {
        const { registry } = setup();
        const markers = { markers: true };
        expect(resolved(registry, "Enter", { ...BUTTON, ...markers })).toBe("pass");
        expect(resolved(registry, "ArrowRight", { ...SLIDER, ...markers })).toBe("pass");
        expect(resolved(registry, "ArrowRight", { ...BUTTON, ...markers })).toBe("markers:nudge");
        expect(resolved(registry, "Escape", { ...BUTTON, ...markers })).toBe(
            "markers:deselect-markers",
        );
        expect(resolved(registry, "ArrowRight", { ...VIEWPORT, ...markers })).toBe("markers:nudge");
    });
});

describe("open menu, dialog or popover", () => {
    it("runs nothing and suppresses the default of bound Ctrl/Alt/F-key chords", () => {
        const { registry, add } = fixture();
        add("stamp", "B", "canvas");
        add("save", "Ctrl+S", ["global", "text"]);
        add("grid", "Ctrl+G", "global");
        add("undo", "Ctrl+Z", "global");
        add("finish", "Enter", "canvas");
        const open = { ...VIEWPORT, overlayOpen: true };
        expect(resolved(registry, "Ctrl+S", open)).toBe("suppress");
        expect(resolved(registry, "Ctrl+G", open)).toBe("suppress");
        expect(resolved(registry, "Ctrl+Z", open)).toBe("suppress");
        expect(resolved(registry, "B", open)).toBe("pass");
        expect(resolved(registry, "Enter", open)).toBe("pass");
        // A text field inside a dialog keeps its own undo.
        expect(resolved(registry, "Ctrl+Z", { ...TEXT, overlayOpen: true })).toBe("pass");
        expect(resolved(registry, "Ctrl+S", { ...TEXT, overlayOpen: true })).toBe("suppress");
    });
});

// --- Reading the environment from the page -------------------------------------------------

function element(
    tagName: string,
    attributes: Record<string, string> = {},
    inside: string[] = [],
): FocusedElement {
    return {
        tagName: tagName.toUpperCase(),
        isContentEditable: attributes.contenteditable === "true",
        getAttribute: (name) => attributes[name] ?? null,
        hasAttribute: (name) => name in attributes,
        closest: (selector) => (inside.includes(selector) ? {} : null),
    };
}

function page(active: FocusedElement | null, open: string[] = []): KeymapDocument {
    return {
        activeElement: active,
        querySelector: (selector) => (open.includes(selector) ? {} : null),
    };
}

const IDLE = { gesture: false, markers: false };

describe("reading the environment from the page", () => {
    it("recognises text and number fields", () => {
        for (const field of [
            element("input"),
            element("input", { type: "text", role: "spinbutton" }),
            element("input", { type: "number" }),
            element("input", { type: "search" }),
            element("textarea"),
            element("div", { contenteditable: "true" }),
            element("div", { role: "textbox" }),
        ]) {
            expect(isTextField(field)).toBe(true);
            expect(readKeyEnvironment(page(field), IDLE).focus).toBe("text");
        }
        for (const control of [
            element("input", { type: "checkbox" }),
            element("input", { type: "range" }),
            element("button"),
            element("div", { tabindex: "0" }),
        ]) {
            expect(isTextField(control)).toBe(false);
        }
    });

    it("tells the viewport, a control and no focus apart", () => {
        const viewport = element("div", { tabindex: "0", [VIEWPORT_FOCUS_ATTRIBUTE]: "" });
        expect(readKeyEnvironment(page(viewport), IDLE)).toMatchObject({
            focus: "viewport",
            inPanel: false,
            overlayOpen: false,
        });
        expect(readKeyEnvironment(page(viewport), IDLE).nativeKeys.size).toBe(0);
        expect(readKeyEnvironment(page(element("button")), IDLE).focus).toBe("control");
        for (const none of [null, element("body"), element("html")]) {
            const environment = readKeyEnvironment(page(none), IDLE);
            expect(environment.focus).toBe("none");
            expect([...environment.nativeKeys]).toEqual(["Tab"]);
        }
    });

    it("knows which native keys each kind of control consumes", () => {
        const keys = (target: FocusedElement) => [...nativeKeysOf(target)].sort();
        const activate = ["Enter", "Space", "Tab"];
        const navigate = [
            "ArrowDown",
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "End",
            "Enter",
            "Home",
            "Space",
            "Tab",
        ];
        expect(keys(element("button"))).toEqual(activate);
        expect(keys(element("a", { href: "#" }))).toEqual(activate);
        expect(keys(element("input", { type: "checkbox" }))).toEqual(activate);
        expect(keys(element("div", { role: "button", tabindex: "0" }))).toEqual(activate);
        // The splitter, a Radix select trigger, a bottom-panel tab, a menu bar trigger, a tree.
        expect(keys(element("div", { role: "separator", tabindex: "0" }))).toEqual(navigate);
        expect(keys(element("button", { role: "combobox" }))).toEqual(navigate);
        expect(keys(element("button", { role: "tab" }))).toEqual(navigate);
        expect(keys(element("button", { role: "menuitem" }))).toEqual(navigate);
        expect(keys(element("div", { role: "treeitem", tabindex: "0" }))).toEqual(navigate);
        expect(keys(element("select"))).toEqual(navigate);
        expect(keys(element("input", { type: "range" }))).toEqual(navigate);
        // A tile of the Tilesets panel: nothing but Tab.
        expect(keys(element("div", { role: "gridcell", tabindex: "0" }))).toEqual(["Tab"]);
        expect(keys(element("div", { tabindex: "0" }))).toEqual(["Tab"]);
        expect(keys(element("a"))).toEqual(["Tab"]);
    });

    it("gives typeahead to selects and trees only", () => {
        const typeahead = (target: FocusedElement) =>
            readKeyEnvironment(page(target), IDLE).typeahead;
        expect(typeahead(element("button", { role: "combobox" }))).toBe(true);
        expect(typeahead(element("select"))).toBe(true);
        expect(typeahead(element("div", { role: "treeitem" }))).toBe(true);
        expect(typeahead(element("button"))).toBe(false);
        expect(typeahead(element("button", { role: "menuitem" }))).toBe(false);
    });

    it("reads the panel, an open overlay and the context state", () => {
        const cell = element("div", { tabindex: "0" }, [PANEL_SELECTOR]);
        expect(readKeyEnvironment(page(cell), IDLE).inPanel).toBe(true);
        expect(readKeyEnvironment(page(element("div", { tabindex: "0" })), IDLE).inPanel).toBe(
            false,
        );
        expect(readKeyEnvironment(page(cell, [OVERLAY_SELECTOR]), IDLE).overlayOpen).toBe(true);
        expect(readKeyEnvironment(page(cell), { gesture: true, markers: true })).toMatchObject({
            gesture: true,
            markers: true,
        });
    });

    it("finds the panel context in the bottom panel and in marked elements (DESIGN §10.1)", () => {
        expect(PANEL_SELECTOR).toContain('[data-region="bottom-panel"]');
        expect(PANEL_SELECTOR).toContain("[data-keymap-panel]");
    });

    it("recognises Radix surfaces by role and state, and marked surfaces", () => {
        for (const role of ["dialog", "alertdialog", "menu", "listbox"]) {
            expect(OVERLAY_SELECTOR).toContain(`[role="${role}"][data-state="open"]`);
        }
        expect(OVERLAY_SELECTOR).toContain("[data-keymap-overlay]");
        expect(OVERLAY_SELECTOR).not.toContain("tooltip");
    });
});

// --- The listener ----------------------------------------------------------------------------

interface Pressed {
    prevented: boolean;
}

/** Dispatches a key event on `target` and reports whether its default was prevented. */
function dispatch(
    target: EventTarget,
    type: "keydown" | "keyup",
    key: string,
    init: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "repeat", boolean>> = {},
    before?: (event: Event) => void,
): Pressed {
    const event = Object.assign(new Event(type, { cancelable: true }), {
        key,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        repeat: false,
        isComposing: false,
        ...init,
    });
    before?.(event);
    target.dispatchEvent(event);
    return { prevented: event.defaultPrevented };
}

describe("keyboard listener", () => {
    const setup = (environment: KeyEnvironment = VIEWPORT) => {
        const value = fixture();
        const target = new EventTarget();
        const errors: string[] = [];
        const state = { environment };
        const uninstall = installKeymap({
            registry: value.registry,
            target,
            environment: () => state.environment,
            onError: (error, command) => void errors.push(`${command.id}: ${String(error)}`),
        });
        return { ...value, target, errors, state, uninstall };
    };

    it("runs the command of a chord and prevents the browser default", () => {
        const { target, calls, add } = setup();
        add("save", "Ctrl+S");
        add("ellipse", "Shift+U", "canvas");
        expect(dispatch(target, "keydown", "s", { ctrlKey: true })).toEqual({ prevented: true });
        expect(dispatch(target, "keydown", "U", { shiftKey: true })).toEqual({ prevented: true });
        expect(calls).toEqual(["save", "ellipse"]);
    });

    it("leaves an unbound key alone", () => {
        const { target, calls } = setup();
        expect(dispatch(target, "keydown", "p", { ctrlKey: true })).toEqual({ prevented: false });
        expect(dispatch(target, "keydown", "Tab")).toEqual({ prevented: false });
        expect(calls).toEqual([]);
    });

    it("prevents the default of a disabled command's chord without running it", () => {
        const { target, calls, add, disabled } = setup();
        add("select-none", "Ctrl+D");
        disabled.add("select-none");
        expect(dispatch(target, "keydown", "d", { ctrlKey: true })).toEqual({ prevented: true });
        expect(calls).toEqual([]);
    });

    it("prevents the default of a bound chord that does not act in a text field", () => {
        const { target, calls, add, state } = setup(TEXT);
        add("select-none", "Ctrl+D");
        add("undo", "Ctrl+Z");
        add("zoom-tool", "Z", "canvas");
        expect(dispatch(target, "keydown", "d", { ctrlKey: true })).toEqual({ prevented: true });
        expect(dispatch(target, "keydown", "z", { ctrlKey: true })).toEqual({ prevented: false });
        expect(dispatch(target, "keydown", "z")).toEqual({ prevented: false });
        expect(calls).toEqual([]);
        state.environment = VIEWPORT;
        dispatch(target, "keydown", "z", { ctrlKey: true });
        dispatch(target, "keydown", "z");
        expect(calls).toEqual(["undo", "zoom-tool"]);
    });

    it("leaves a key alone that a control has already handled", () => {
        const { target, calls, add } = setup();
        add("finish", "Enter", "canvas");
        const handled = dispatch(target, "keydown", "Enter", {}, (event) => event.preventDefault());
        expect(handled.prevented).toBe(true);
        expect(calls).toEqual([]);
    });

    it("runs a hold binding once and releases it on key up", () => {
        const { target, registry } = setup();
        const log: string[] = [];
        registry.register({
            id: "hand",
            title: "Hand",
            shortcut: "Space",
            context: "canvas",
            run: () => void log.push("down"),
            release: () => void log.push("up"),
        });
        expect(dispatch(target, "keydown", " ")).toEqual({ prevented: true });
        expect(dispatch(target, "keydown", " ", { repeat: true })).toEqual({ prevented: true });
        expect(log).toEqual(["down"]);
        expect(dispatch(target, "keyup", " ", { shiftKey: true })).toEqual({ prevented: true });
        expect(log).toEqual(["down", "up"]);
    });

    it("releases held bindings when the window loses focus and when it is removed", () => {
        const { target, registry, uninstall } = setup();
        const log: string[] = [];
        registry.register({
            id: "hand",
            title: "Hand",
            shortcut: "Space",
            context: "canvas",
            run: () => void log.push("down"),
            release: () => void log.push("up"),
        });
        dispatch(target, "keydown", " ");
        target.dispatchEvent(new Event("blur"));
        expect(log).toEqual(["down", "up"]);
        dispatch(target, "keydown", " ");
        uninstall();
        expect(log).toEqual(["down", "up", "down", "up"]);
        dispatch(target, "keydown", " ");
        expect(log).toHaveLength(4);
    });

    it("hands what a command throws, or rejects with, to the error handler", async () => {
        const { target, registry, errors } = setup();
        registry.register({
            id: "throws",
            title: "Throws",
            shortcut: "Ctrl+1",
            run() {
                throw new Error("sync");
            },
        });
        registry.register({
            id: "rejects",
            title: "Rejects",
            shortcut: "Ctrl+2",
            run: () => Promise.reject(new Error("async")),
        });
        expect(dispatch(target, "keydown", "1", { ctrlKey: true })).toEqual({ prevented: true });
        dispatch(target, "keydown", "2", { ctrlKey: true });
        await Promise.resolve();
        await Promise.resolve();
        expect(errors).toEqual(["throws: Error: sync", "rejects: Error: async"]);
    });
});
