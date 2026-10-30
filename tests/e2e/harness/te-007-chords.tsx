import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createCommandRegistry } from "../../../src/app/commands/registry";
import type { KeyContext } from "../../../src/app/commands/types";
import { setKeyContext } from "../../../src/app/keymap/contextState";
import { VIEWPORT_FOCUS_ATTRIBUTE } from "../../../src/app/keymap/environment";
import { installKeymap } from "../../../src/app/keymap/install";
import { Button } from "../../../src/ui/primitives/Button";
import { Dialog } from "../../../src/ui/primitives/Dialog";
import { Select } from "../../../src/ui/primitives/Select";
import { AppShell } from "../../../src/ui/shell/AppShell";
import { UiRoot } from "../../../src/ui/UiRoot";
import { parseDesignKeyTable } from "./te-007-design-keys";

// TE-007 chord harness: the real shell and the real keymap on a registry that holds nothing
// but probe commands, which the spec registers from the key table of DESIGN §10.3. The regions
// carry what the keymap contexts need: a viewport focus element, a cell of the bottom panel, a
// text field. Opened by hand for the owner check: `?probe` registers the table's chords and
// lists each one received. Adapted from the sprite editor's se-007-keymap.tsx.

/** One probe command: a chord of the table in one context (tests/e2e/te-007-design-keys.ts). */
interface ProbeBinding {
    chord: string;
    context: KeyContext;
    text: boolean;
    hold: boolean;
    condition: "tile-layer" | "marker-layer" | "no-marker-selection" | null;
}

interface KeyRecord {
    type: string;
    key: string;
    prevented: boolean;
}

interface ChordHarness {
    /** Ids of the probes that ran, in order. */
    calls: string[];
    /** Ids of the hold probes that were released, in order. */
    releases: string[];
    /** Every key event after the keymap handled it. */
    events: KeyRecord[];
    /** The kind of the active layer in the conditions of the table. */
    layer: "tile" | "marker";
    /** Markers are selected (the `markers` context and the "no marker selection" condition). */
    markerSelection: boolean;
    /** Registers one probe per binding and returns their ids in the same order. */
    register(bindings: ProbeBinding[]): string[];
    setContext(context: "gesture", active: boolean): void;
    /** Clears the records and returns to a tile layer, no gesture, no marker selection. */
    reset(): void;
}

declare global {
    interface Window {
        te007?: ChordHarness;
    }
}

const registry = createCommandRegistry();
/** Listeners of the page's own list of received chords. */
const received = new Set<(chord: string) => void>();

const harness: ChordHarness = {
    calls: [],
    releases: [],
    events: [],
    layer: "tile",
    markerSelection: false,
    register(bindings) {
        return bindings.map((binding, index) => {
            const id = `probe-${index}`;
            const { condition } = binding;
            registry.register({
                id,
                title: `${binding.chord} in ${binding.context}`,
                shortcut: binding.chord,
                context: binding.text ? [binding.context, "text"] : binding.context,
                enabled: () =>
                    condition === null ||
                    (condition === "tile-layer" && harness.layer === "tile") ||
                    (condition === "marker-layer" && harness.layer === "marker") ||
                    (condition === "no-marker-selection" && !harness.markerSelection),
                run: () => {
                    harness.calls.push(id);
                    for (const listener of received) listener(binding.chord);
                },
                release: binding.hold ? () => void harness.releases.push(id) : undefined,
            });
            return id;
        });
    },
    setContext: setKeyContext,
    reset() {
        harness.calls.length = 0;
        harness.releases.length = 0;
        harness.events.length = 0;
        harness.layer = "tile";
        harness.markerSelection = false;
        setKeyContext("gesture", false);
        setKeyContext("markers", false);
    },
};
window.te007 = harness;

installKeymap({ registry });
// Registered after the keymap's listener, so each event is recorded as the keymap left it.
for (const type of ["keydown", "keyup"]) {
    window.addEventListener(type, (event) => {
        const { key } = event as KeyboardEvent;
        harness.events.push({ type, key, prevented: event.defaultPrevented });
    });
}

const CHOICES = [
    { value: "one", label: "One" },
    { value: "two", label: "Two" },
];

/** The owner check: the chords received so far, one line each, newest last. */
function Received() {
    const [chords, setChords] = useState<string[]>([]);
    useEffect(() => {
        const listener = (chord: string) =>
            setChords((seen) => (seen.includes(chord) ? seen : [...seen, chord]));
        received.add(listener);
        return () => void received.delete(listener);
    }, []);
    return (
        <div style={{ padding: 8 }}>
            <p>Click the viewport, then press the chords of DESIGN §10.3. Received:</p>
            <ul data-testid="received" aria-label="Chords received">
                {chords.map((chord) => (
                    <li key={chord}>{chord}</li>
                ))}
            </ul>
        </div>
    );
}

function Page() {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [choice, setChoice] = useState("one");
    return (
        <UiRoot>
            <AppShell
                regions={{
                    "context-bar": (
                        <>
                            <input aria-label="Name" data-testid="text-field" />
                            <Button data-testid="plain-button">Plain button</Button>
                            <Select
                                label="Choice"
                                hideLabel
                                value={choice}
                                onChange={setChoice}
                                options={CHOICES}
                            />
                            <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
                        </>
                    ),
                    viewport: (
                        <div
                            tabIndex={0}
                            data-testid="viewport-focus"
                            style={{ width: "100%", height: "100%" }}
                            {...{ [VIEWPORT_FOCUS_ATTRIBUTE]: "" }}
                        />
                    ),
                    "bottom-panel": (
                        <>
                            <div tabIndex={0} data-testid="panel-cell">
                                Tile
                            </div>
                            <button type="button" data-testid="panel-button">
                                Panel button
                            </button>
                        </>
                    ),
                    dock: <Received />,
                }}
            />
            <Dialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                title="Test dialog"
                actions={<Button onClick={() => setDialogOpen(false)}>Close</Button>}
            >
                <input aria-label="Dialog field" data-testid="dialog-field" />
            </Dialog>
        </UiRoot>
    );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(<Page />);

// Opened by hand (owner check): the chords of DESIGN §10.3 are fetched from the docs and
// registered, so the page lists each one as it is received.
if (new URLSearchParams(window.location.search).has("probe")) {
    const markdown = await (await fetch("/docs/DESIGN.md")).text();
    harness.register(parseDesignKeyTable(markdown).bindings);
}
