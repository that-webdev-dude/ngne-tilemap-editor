import type { StoreApi } from "zustand/vanilla";
import { createMapSession, findLayer } from "../../core/model";
import type { MapView, ProjectSession } from "../../core/model";
import type { SessionState } from "../state/session";
import type { MapTabsState } from "../tabs/tabs";

// The session state of a project, kept per project ID in IndexedDB, best effort (SPEC §10.1,
// TE-048): its open map tabs in their order, the active map, and each shown map's view and
// active layer. It is written a moment after it changes and when the project goes; it is
// restored when a project of that ID takes the window again (Open, a recent file, a drop,
// recovery). Revert keeps what it keeps on its own (SPEC §10.1): a project replaced by one of
// the same ID restores nothing. Selections are not kept.
//
// Database `ngne-tilemap-editor-session` (SUITE §7), store `projects`, keyed by project ID; the
// newest `SESSION_RECORDS_KEPT` records are kept.

/** What is kept of one map. */
export interface MapState {
    readonly mapId: string;
    readonly view: MapView;
    readonly activeLayerId: number;
}

/** What is kept of one project. */
export interface SessionRecord {
    readonly projectId: string;
    /** When it was written, in milliseconds since the epoch. */
    readonly savedAt: number;
    /** IDs of the open maps, in tab order. */
    readonly tabs: readonly string[];
    readonly activeMapId: string;
    readonly maps: readonly MapState[];
}

export interface SessionStateStorage {
    get(projectId: string): Promise<SessionRecord | undefined>;
    put(record: SessionRecord): Promise<void>;
}

export const SESSION_DATABASE = "ngne-tilemap-editor-session";
export const SESSION_STORE = "projects";
/** How many projects' session states are kept: the newest. */
export const SESSION_RECORDS_KEPT = 100;
/** The delay from a change of the session state to its write. */
export const SESSION_WRITE_DELAY_MS = 500;
/** How long an operation waits for IndexedDB to open, in milliseconds. */
const OPEN_TIMEOUT_MS = 3000;

function request<Result>(task: IDBRequest<Result>): Promise<Result> {
    return new Promise((resolve, reject) => {
        task.onsuccess = () => resolve(task.result);
        task.onerror = () => reject(task.error ?? new Error("IndexedDB request failed."));
    });
}

/** The session states in the page's IndexedDB, or null where there is none (Node). */
export function indexedDbSessionState(
    factory: Pick<IDBFactory, "open"> | null = typeof indexedDB === "undefined" ? null : indexedDB,
): SessionStateStorage | null {
    if (!factory) return null;
    let opened: Promise<IDBDatabase> | null = null;
    const database = (): Promise<IDBDatabase> => {
        if (opened) return opened;
        const opening = new Promise<IDBDatabase>((resolve, reject) => {
            const open = factory.open(SESSION_DATABASE, 1);
            const timer = setTimeout(() => {
                open.onsuccess = () => open.result.close();
                reject(new Error("IndexedDB did not answer."));
            }, OPEN_TIMEOUT_MS);
            open.onupgradeneeded = () => {
                if (!open.result.objectStoreNames.contains(SESSION_STORE)) {
                    open.result.createObjectStore(SESSION_STORE);
                }
            };
            open.onsuccess = () => {
                clearTimeout(timer);
                const db = open.result;
                const forget = () => {
                    if (opened === opening) opened = null;
                };
                db.onversionchange = () => {
                    db.close();
                    forget();
                };
                db.onclose = forget;
                resolve(db);
            };
            open.onerror = () => {
                clearTimeout(timer);
                reject(open.error ?? new Error("Not opened."));
            };
            open.onblocked = () => {
                clearTimeout(timer);
                open.onsuccess = () => open.result.close();
                reject(new Error("The database is blocked."));
            };
        });
        opened = opening;
        opening.catch(() => {
            if (opened === opening) opened = null;
        });
        return opening;
    };
    return {
        async get(projectId) {
            const db = await database();
            const store = db.transaction(SESSION_STORE, "readonly").objectStore(SESSION_STORE);
            return (await request(store.get(projectId))) as SessionRecord | undefined;
        },
        async put(record) {
            const db = await database();
            const transaction = db.transaction(SESSION_STORE, "readwrite");
            const store = transaction.objectStore(SESSION_STORE);
            store.put(record, record.projectId);
            const all = (await request(store.getAll())) as SessionRecord[];
            if (all.length > SESSION_RECORDS_KEPT) {
                all.sort((a, b) => b.savedAt - a.savedAt);
                for (const old of all.slice(SESSION_RECORDS_KEPT)) store.delete(old.projectId);
            }
            await new Promise<void>((resolve, reject) => {
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
                transaction.onabort = () => reject(transaction.error);
            });
        },
    };
}

/** The session state of `session` with `tabs` open. */
export function sessionRecordOf(
    session: ProjectSession,
    tabs: readonly string[],
    savedAt: number,
): SessionRecord {
    const ids = new Set(session.project.maps.map((map) => map.id));
    const maps: MapState[] = [];
    for (const [mapId, each] of session.perMap) {
        if (!ids.has(mapId)) continue;
        maps.push({ mapId, view: { ...each.view }, activeLayerId: each.activeLayerId });
    }
    return {
        projectId: session.project.id,
        savedAt,
        tabs: tabs.filter((id) => ids.has(id)),
        activeMapId: session.activeMapId,
        maps,
    };
}

/**
 * Applies `record` to `session` as far as its maps and layers are still there: each map's view
 * and active layer, the active map. Returns the tabs to open, in order, the active map among
 * them; null when the record names none of the project's maps.
 */
export function applySessionRecord(
    session: ProjectSession,
    record: SessionRecord,
): string[] | null {
    const maps = new Map(session.project.maps.map((map) => [map.id, map]));
    let applied = false;
    for (const state of record.maps) {
        const map = maps.get(state.mapId);
        if (!map) continue;
        const each = session.perMap.get(map.id) ?? createMapSession(map);
        const view = state.view;
        if (
            Number.isFinite(view.centreX) &&
            Number.isFinite(view.centreY) &&
            Number.isFinite(view.zoom) &&
            view.zoom > 0
        ) {
            each.view = { centreX: view.centreX, centreY: view.centreY, zoom: view.zoom };
        }
        if (findLayer(map, state.activeLayerId)) each.activeLayerId = state.activeLayerId;
        session.perMap.set(map.id, each);
        applied = true;
    }
    const tabs = record.tabs.filter(
        (id, index) => maps.has(id) && record.tabs.indexOf(id) === index,
    );
    const active = maps.get(record.activeMapId);
    if (active) {
        session.activeMapId = active.id;
        if (!session.perMap.has(active.id)) session.perMap.set(active.id, createMapSession(active));
        if (!tabs.includes(active.id)) tabs.push(active.id);
        applied = true;
    }
    if (!applied && tabs.length === 0) return null;
    if (!tabs.includes(session.activeMapId) && maps.has(session.activeMapId)) {
        tabs.push(session.activeMapId);
    }
    return tabs;
}

export interface SessionMemoryOptions {
    sessions: StoreApi<SessionState>;
    tabs: StoreApi<MapTabsState>;
    /** Where the states are kept; null: nowhere, nothing is kept or restored. */
    storage: SessionStateStorage | null;
    delayMs?: number;
    now?(): number;
}

export interface SessionMemory {
    /** Writes the open project's state now, if one is due. */
    flush(): void;
    /** Resolves once every read and write started so far has finished. */
    idle(): Promise<void>;
    stop(): void;
}

/** Keeps the session state of the projects of `sessions` (see above). */
export function createSessionMemory(options: SessionMemoryOptions): SessionMemory {
    const { sessions, tabs, storage } = options;
    const delayMs = options.delayMs ?? SESSION_WRITE_DELAY_MS;
    const now = options.now ?? (() => Date.now());
    let tail: Promise<void> = Promise.resolve();
    const follow = (task: Promise<unknown>) => {
        tail = Promise.all([tail, task.catch(() => {})]).then(() => {});
    };

    /** The open project followed: its history, session and the tabs it shows. */
    let current: {
        history: SessionState["history"];
        session: ProjectSession;
        tabs: readonly string[];
    } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const write = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        if (!current || !storage) return;
        const record = sessionRecordOf(current.session, current.tabs, now());
        follow(
            storage.put(record).catch((error: unknown) => {
                console.warn("Could not keep the session state:", error);
            }),
        );
    };

    const schedule = () => {
        if (!current || !storage || stopped) return;
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(write, delayMs);
    };

    const restore = (history: SessionState["history"], projectId: string) => {
        if (!storage) return;
        const { activeMapId } = history.session;
        follow(
            storage
                .get(projectId)
                .then((record) => {
                    const state = sessions.getState();
                    // Shown already in another way: the user has moved on, or it is gone.
                    if (!record || stopped || state.history !== history) return;
                    if (state.session.activeMapId !== activeMapId) return;
                    const open = applySessionRecord(state.session, record);
                    if (!open) return;
                    tabs.setState({ open });
                    state.touch();
                })
                .catch((error: unknown) => {
                    console.warn("Could not restore the session state:", error);
                }),
        );
    };

    const check = (state: SessionState) => {
        if (stopped) return;
        if (current && current.history !== state.history) {
            // The project goes: what it showed is kept now.
            const previous = current.session.project.id;
            write();
            current = null;
            if (state.open) {
                current = {
                    history: state.history,
                    session: state.session,
                    tabs: tabs.getState().open,
                };
                if (state.session.project.id !== previous) {
                    restore(state.history, state.session.project.id);
                }
            }
            return;
        }
        if (!current && state.open) {
            current = {
                history: state.history,
                session: state.session,
                tabs: tabs.getState().open,
            };
            restore(state.history, state.session.project.id);
            return;
        }
        if (current) schedule();
    };

    if (sessions.getState().open) {
        const state = sessions.getState();
        current = { history: state.history, session: state.session, tabs: tabs.getState().open };
    }
    const stopSessions = sessions.subscribe(check);
    const stopTabs = tabs.subscribe((state) => {
        // A new project's tabs are taken when the session store tells of it.
        if (!current || current.history !== sessions.getState().history) return;
        current.tabs = state.open;
        schedule();
    });

    return {
        flush() {
            if (timer !== null) write();
        },
        idle: () => tail,
        stop() {
            stopped = true;
            if (timer !== null) clearTimeout(timer);
            timer = null;
            stopSessions();
            stopTabs();
        },
    };
}
