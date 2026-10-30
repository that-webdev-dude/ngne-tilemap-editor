import { normalizeChord } from "../../../src/app/commands/chord";

// TE-007: the key table of DESIGN §10.3, parsed from the text of docs/DESIGN.md. Pure, so the
// chord harness page can run it in the browser; te-007-design-keys.ts reads the file for the
// spec. The end-to-end chord test
// presses every chord this parser returns, so the list cannot drift from the design: a row the
// parser does not understand is an error, not a skipped row. Adapted from the sprite editor's
// se-007-spec-keys.ts.

export type DesignContext = "gesture" | "markers" | "panel" | "canvas" | "global";

/** A row's condition: the kind of the active layer, or no marker selection. */
export type DesignCondition = "tile-layer" | "marker-layer" | "no-marker-selection" | null;

/** One chord of the table in one of its contexts. */
export interface DesignBinding {
    /** The chord in the notation of src/app/commands/chord.ts. */
    chord: string;
    context: DesignContext;
    /** Marked †: also acts while a text field has focus. */
    text: boolean;
    /** Written "(hold)": acts while the key is down. */
    hold: boolean;
    condition: DesignCondition;
    /** The row's key cell and action, for messages. */
    row: string;
}

export interface DesignKeyTable {
    /** Every keyboard chord of the table, once per context it is listed in. */
    bindings: DesignBinding[];
    /** Key cells (or their parts) bound to the pointer, which are not keyboard chords. */
    pointerKeys: string[];
}

const CONTEXTS: readonly DesignContext[] = ["gesture", "markers", "panel", "canvas", "global"];
const ARROWS: Readonly<Record<string, string>> = {
    "←": "ArrowLeft",
    "→": "ArrowRight",
    "↑": "ArrowUp",
    "↓": "ArrowDown",
};
const ALL_ARROWS = Object.values(ARROWS);
const POINTER_CONTEXT = "pointer over viewport";
/** Parts of a key cell that name a pointer gesture, not a key. */
const POINTER_KEYS = new Set(["middle drag"]);

interface Key {
    chord: string;
    hold: boolean;
}

/** The chords one alternative of a key cell stands for: "Arrows" is four, "1–6" six. */
function expand(token: string, row: string): Key[] {
    const hold = / \(hold\)$/.test(token);
    const name = token.replace(/ \(hold\)$/, "");
    let chords: string[];
    const digits = /^(\d)–(\d)$/.exec(name);
    if (name === "Arrows") chords = ALL_ARROWS;
    else if (name === "Shift+arrows") chords = ALL_ARROWS.map((arrow) => `Shift+${arrow}`);
    else if (digits) {
        const [from, to] = [Number(digits[1]), Number(digits[2])];
        chords = Array.from({ length: to - from + 1 }, (_, index) => String(from + index));
    } else chords = [name.replace(/[←→↑↓]$/, (arrow) => ARROWS[arrow] ?? arrow)];
    return chords.map((chord) => {
        try {
            return { chord: normalizeChord(chord), hold };
        } catch (error) {
            throw new Error(`DESIGN §10.3 row "${row}": cannot read the key "${token}".`, {
                cause: error,
            });
        }
    });
}

/** The keys of a key cell with their † marks; pointer parts are returned apart. */
function parseKeys(
    cell: string,
    row: string,
): { keys: (Key & { text: boolean })[]; pointer: string[] } {
    const keys: (Key & { text: boolean })[] = [];
    const pointer: string[] = [];
    for (const entry of cell.split(/[,;]/)) {
        const text = entry.includes("†");
        const token = entry.replace("†", "").trim();
        if (POINTER_KEYS.has(token)) pointer.push(token);
        else keys.push(...expand(token, row).map((key) => ({ ...key, text })));
    }
    return { keys, pointer };
}

interface Where {
    contexts: DesignContext[];
    condition: DesignCondition;
}

function parseContexts(cell: string, row: string): Where {
    const where: Where = { contexts: [], condition: null };
    for (const part of cell.split(",").map((text) => text.trim())) {
        const context = part
            .replace(" (viewport focused)", "")
            .replace(" / pointer", "") as DesignContext;
        if (CONTEXTS.includes(context)) where.contexts.push(context);
        else if (part === "tile layer") where.condition = "tile-layer";
        else if (part === "marker layer") where.condition = "marker-layer";
        else if (part === "no marker selection") where.condition = "no-marker-selection";
        else throw new Error(`DESIGN §10.3 row "${row}": cannot read the context "${part}".`);
    }
    if (where.contexts.length === 0) throw new Error(`DESIGN §10.3 row "${row}" has no context.`);
    return where;
}

/** The rows of the "| Key | Context | Action | Source |" table of DESIGN §10.3. */
function tableRows(markdown: string): string[][] {
    const lines = markdown.replace(/\r/g, "").split("\n");
    const section = lines.findIndex((line) => /^### 10\.3 Table\s*$/.test(line));
    if (section === -1) throw new Error("docs/DESIGN.md has no section 10.3 Table.");
    const header = lines.findIndex(
        (line, index) =>
            index > section &&
            /^\|\s*Key\s*\|\s*Context\s*\|\s*Action\s*\|\s*Source\s*\|$/.test(line),
    );
    if (header === -1)
        throw new Error("DESIGN §10.3 has no Key / Context / Action / Source table.");
    const rows: string[][] = [];
    for (const line of lines.slice(header + 2)) {
        if (!line.startsWith("|")) break;
        const cells = line
            .split("|")
            .slice(1, -1)
            .map((cell) => cell.trim());
        if (cells.length !== 4) throw new Error(`DESIGN §10.3: unexpected table row "${line}".`);
        rows.push(cells);
    }
    return rows;
}

/** Parses the key table out of the text of docs/DESIGN.md. Throws on anything unexpected. */
export function parseDesignKeyTable(markdown: string): DesignKeyTable {
    const table: DesignKeyTable = { bindings: [], pointerKeys: [] };
    for (const [keys = "", contexts = "", action = ""] of tableRows(markdown)) {
        const row = `${keys} — ${action}`;
        if (contexts === POINTER_CONTEXT) {
            table.pointerKeys.push(keys);
            continue;
        }
        const where = parseContexts(contexts, row);
        const parsed = parseKeys(keys, row);
        table.pointerKeys.push(...parsed.pointer);
        for (const key of parsed.keys) {
            for (const context of where.contexts) {
                table.bindings.push({ ...key, context, condition: where.condition, row });
            }
        }
    }
    return table;
}

/**
 * Chords Chrome keeps for itself in a normal browser window: the page never receives them, so
 * they cannot be bound (Chromium `IsReservedCommandOrKey`: new tab, new window, new incognito
 * window, close tab, close window, reopen tab, next and previous tab). Playwright sends keys
 * below that layer and cannot show the difference, so the test compares against this list.
 */
export const CHROME_RESERVED_CHORDS: readonly string[] = [
    "Ctrl+T",
    "Ctrl+N",
    "Ctrl+Shift+N",
    "Ctrl+W",
    "Ctrl+Shift+W",
    "Ctrl+Shift+T",
    "Ctrl+Tab",
    "Ctrl+Shift+Tab",
    "Ctrl+PageDown",
    "Ctrl+PageUp",
    "Ctrl+F4",
    "Alt+F4",
].map(normalizeChord);
