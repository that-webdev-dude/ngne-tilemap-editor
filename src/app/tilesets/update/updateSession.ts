import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import type { Command } from "../../../core/history";
import type { PixelBuffer, Project, TileSourceKey } from "../../../core/model";
import { tileBytes, tileUsage, updateFromSourceCommand } from "../../../core/tileset";
import type {
    MapUsage,
    SourceTiles,
    TileResolution,
    UpdateMatch,
    UpdateSummary,
} from "../../../core/tileset";

// One run of the Update Tileset from Source dialog (SPEC §6.3, DESIGN §9; TE-028): the source
// re-read and matched by the worker, one row per ambiguous and missing tile with its old
// picture, its usage per map and a choice, and the apply. Each row starts on a choice that
// loses nothing: an ambiguous tile on the first of its candidates no row above took, else Keep
// as is; a missing tile on Keep as is. Replace with… waits for a tile of the source to be
// picked. Apply runs the update as one history entry against the project as it is then;
// Cancel runs nothing.

/** A choice of a row: a resolution, or Replace with… before its tile is picked. */
export type RowChoice = TileResolution | { kind: "replace"; entry: null };

/** An ambiguous or missing tile, as the dialog lists it. */
export interface UpdateRow {
    tileId: number;
    status: "ambiguous" | "missing";
    /** Source entries the tile may take (ambiguous), in source order. */
    candidates: readonly number[];
    /** The tile's picture before the update. */
    picture: PixelBuffer;
    /** The maps that use the tile, with their cell counts. */
    usage: readonly MapUsage[];
}

export interface UpdateSessionState {
    readonly tilesetId: string;
    readonly tilesetName: string;
    readonly source: SourceTiles;
    readonly summary: UpdateSummary;
    readonly rows: readonly UpdateRow[];
    /** By tile ID, one per row. */
    readonly choices: ReadonlyMap<number, RowChoice>;
    /** Apply is running the update. */
    readonly applying: boolean;
    /** Why the last Apply changed nothing; cleared by the next choice. */
    readonly failure: string | null;
    /** What Apply did once it ran: made the entry, or found nothing to change. */
    readonly outcome: UpdateOutcome | null;
}

/** "applied": one history entry made; "unchanged": the choices change nothing, no entry. */
export type UpdateOutcome = "applied" | "unchanged";

export interface UpdateSession {
    readonly store: StoreApi<UpdateSessionState>;
    /** Sets the choice of the row of `tileId`. */
    choose(tileId: number, choice: RowChoice): void;
    /** Whether Apply can run now. */
    canApply(): boolean;
    /** Applies the update; resolves with what it did, or null when it is refused. */
    confirm(): Promise<UpdateOutcome | null>;
}

export interface UpdateSessionOptions {
    /** The project the update applies to, as it is now. */
    project(): Project;
    /** Executes the update's command; throws, the project unchanged, when it is refused. */
    execute(command: Command): void;
    /** Why the history cannot take a command now (a stroke), or null. */
    busy(): string | null;
}

/** A picture of `tileWidth × tileHeight` from straight RGBA bytes. */
export function pictureOf(
    bytes: Uint8Array,
    size: { tileWidth: number; tileHeight: number },
): PixelBuffer {
    return {
        width: size.tileWidth,
        height: size.tileHeight,
        data: new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.length),
    };
}

/** A source key as the dialog names it: "(3, 1)", "frame-2 (0, 1)", or the atlas frame. */
export function keyLabel(key: TileSourceKey): string {
    if (typeof key === "string") return key;
    if (key.length === 2) return `(${key[0]}, ${key[1]})`;
    return `${key[0]} (${key[1]}, ${key[2]})`;
}

/** The rows of `match` for tileset `tilesetId` of `project`: ambiguous, then missing. */
export function updateRows(project: Project, tilesetId: string, match: UpdateMatch): UpdateRow[] {
    const tileset = project.tilesets.find((each) => each.id === tilesetId)!;
    const open = [
        ...match.ambiguous.map((a) => ({
            tileId: a.tileId,
            status: "ambiguous" as const,
            candidates: a.candidates,
        })),
        ...match.missing.map((tileId) => ({
            tileId,
            status: "missing" as const,
            candidates: [] as number[],
        })),
    ];
    const usage = tileUsage(
        project,
        tileset.slot,
        open.map((row) => row.tileId),
    );
    const position = new Map(tileset.tiles.map((tile, k) => [tile.id, k]));
    return open.map(({ tileId, status, candidates }) => ({
        tileId,
        status,
        candidates,
        picture: pictureOf(tileBytes(tileset.pixels, tileset, position.get(tileId)!), tileset),
        usage: usage.get(tileId) ?? [],
    }));
}

/** The first choices: a candidate no row above took, else Keep as is. */
export function initialChoices(rows: readonly UpdateRow[]): Map<number, RowChoice> {
    const taken = new Set<number>();
    const choices = new Map<number, RowChoice>();
    for (const row of rows) {
        const entry = row.candidates.find((candidate) => !taken.has(candidate));
        if (entry === undefined) {
            choices.set(row.tileId, { kind: "keep" });
        } else {
            taken.add(entry);
            choices.set(row.tileId, { kind: "candidate", entry });
        }
    }
    return choices;
}

/** Whether every row has a whole choice and no candidate is chosen twice. */
export function choicesComplete(choices: ReadonlyMap<number, RowChoice>): boolean {
    const taken = new Set<number>();
    for (const choice of choices.values()) {
        if (choice.kind === "replace" && choice.entry === null) return false;
        if (choice.kind === "candidate") {
            if (taken.has(choice.entry)) return false;
            taken.add(choice.entry);
        }
    }
    return true;
}

function reason(error: unknown): string {
    return error instanceof Error && error.message !== "" ? error.message : String(error);
}

export function createUpdateSession(
    init: {
        tilesetId: string;
        tilesetName: string;
        source: SourceTiles;
        match: UpdateMatch;
    },
    options: UpdateSessionOptions,
): UpdateSession {
    const rows = updateRows(options.project(), init.tilesetId, init.match);
    const store = createStore<UpdateSessionState>(() => ({
        tilesetId: init.tilesetId,
        tilesetName: init.tilesetName,
        source: init.source,
        summary: init.match.summary,
        rows,
        choices: initialChoices(rows),
        applying: false,
        failure: null,
        outcome: null,
    }));

    const canApply = () => {
        const state = store.getState();
        return !state.applying && choicesComplete(state.choices);
    };

    return {
        store,
        choose(tileId, choice) {
            const state = store.getState();
            if (state.applying || !state.choices.has(tileId)) return;
            const choices = new Map(state.choices);
            choices.set(tileId, choice);
            store.setState({ choices, failure: null });
        },
        canApply,
        async confirm() {
            if (!canApply()) return null;
            const state = store.getState();
            const fail = (failure: string) => {
                store.setState({ applying: false, failure });
                return null;
            };
            store.setState({ applying: true, failure: null });
            const busy = options.busy();
            if (busy) return fail(busy);
            const resolutions = new Map(
                [...state.choices].map(([id, choice]) => [id, choice as TileResolution]),
            );
            let outcome: UpdateOutcome;
            try {
                const command = updateFromSourceCommand(
                    options.project(),
                    state.tilesetId,
                    state.source,
                    resolutions,
                );
                if (command) options.execute(command);
                outcome = command ? "applied" : "unchanged";
            } catch (error) {
                return fail(reason(error));
            }
            store.setState({ applying: false, outcome });
            return outcome;
        },
    };
}
