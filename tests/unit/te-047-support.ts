import type { StoreApi } from "zustand/vanilla";
import type {
    DiscardChangesRequest,
    FileDialogs,
    NewProjectValues,
    SaveChangesRequest,
    SaveChoice,
} from "../../src/app/file/dialogs";
import type { ProjectCodec } from "../../src/app/file/projectCodec";
import { createFileWorkflows } from "../../src/app/file/workflows";
import type { FileWorkflows } from "../../src/app/file/workflows";
import type {
    ChosenFile,
    ProjectFileHandle,
    ProjectFilePlatform,
} from "../../src/app/platform/projectFiles";
import { createSessionStore } from "../../src/app/state/session";
import type { SessionState } from "../../src/app/state/session";
import { renameMapCommand } from "../../src/core/maps";
import { createProject, createProjectSession, sequentialIds } from "../../src/core/model";
import type { Project } from "../../src/core/model";
import { deserialize, serialize } from "../../src/core/project";

// Shared by the TE-047 unit tests (adapted from the sprite editor's se-041-support.ts): the
// file workflows over a store of their own, a disk in memory behind fake File System Access
// handles, a platform whose pickers the test answers, the questions answered by the test, and
// the codec of `core/project` run in place (the worker's tasks are the same functions).

/** A file handle over `disk`, which counts what is asked of it. */
export interface FakeHandle extends ProjectFileHandle {
    grants: boolean;
    readonly writes: Uint8Array[];
    permissionRequests: number;
    /** When set, the next write waits for this promise before it completes. */
    hold: Promise<void> | null;
    /** When set, every write fails with it. */
    failWrite: Error | null;
}

export class MemoryDisk {
    readonly files = new Map<string, Uint8Array>();

    handle(name: string): FakeHandle {
        const disk = this.files;
        const handle: FakeHandle = {
            name,
            grants: true,
            writes: [],
            permissionRequests: 0,
            hold: null,
            failWrite: null,
            stored: { name },
            async isSame(other) {
                return other.name === name;
            },
            async size() {
                const bytes = disk.get(name);
                if (!bytes) throw new DOMException(`No file ${name}`, "NotFoundError");
                return bytes.length;
            },
            async read() {
                const bytes = disk.get(name);
                if (!bytes) throw new DOMException(`No file ${name}`, "NotFoundError");
                return bytes.slice();
            },
            requestRead: async () => true,
            async requestWrite() {
                handle.permissionRequests++;
                return handle.grants;
            },
            async write(bytes) {
                const held = handle.hold;
                handle.hold = null;
                if (held) await held;
                if (handle.failWrite) throw handle.failWrite;
                handle.writes.push(bytes.slice());
                disk.set(name, bytes.slice());
            },
        };
        return handle;
    }
}

/** A file to open: from the disk with its handle, or bytes alone (file input, drop). */
export function chosen(name: string, bytes: Uint8Array, handle: FakeHandle | null): ChosenFile {
    return {
        name,
        size: bytes.length,
        read: async () => (handle ? handle.read() : bytes.slice()),
        handle: async () => handle,
    };
}

export interface FakePlatform extends ProjectFilePlatform {
    access: boolean;
    readonly toOpen: (ChosenFile | null)[];
    readonly toSave: (FakeHandle | null)[];
    readonly suggested: string[];
    readonly downloads: { name: string; bytes: Uint8Array }[];
}

export function fakePlatform(): FakePlatform {
    const platform: FakePlatform = {
        access: true,
        toOpen: [],
        toSave: [],
        suggested: [],
        downloads: [],
        canChooseSaveTarget: () => platform.access,
        hasUserActivation: () => true,
        chooseFileToOpen: async () => platform.toOpen.shift() ?? null,
        async chooseSaveTarget(name) {
            platform.suggested.push(name);
            return platform.toSave.shift() ?? null;
        },
        download(name, bytes) {
            platform.downloads.push({ name, bytes: bytes.slice() });
        },
    };
    return platform;
}

/** Questions the test answers: the answers given in order, and what was asked. */
export interface FakeDialogs extends FileDialogs {
    readonly saveAnswers: (SaveChoice | null)[];
    readonly discardAnswers: boolean[];
    readonly newProjectAnswers: (NewProjectValues | null)[];
    readonly asked: (
        | Pick<SaveChangesRequest, "kind" | "action" | "project" | "file">
        | Pick<DiscardChangesRequest, "kind" | "action" | "document" | "file">
        | { kind: "new-project" }
    )[];
}

export function fakeDialogs(): FakeDialogs {
    const dialogs: FakeDialogs = {
        saveAnswers: [],
        discardAnswers: [],
        newProjectAnswers: [],
        asked: [],
        store: { getState: () => ({ request: null }), subscribe: () => () => {} },
        attachHost: () => () => {},
        async confirmDiscard(options) {
            dialogs.asked.push({ kind: "discard-changes", ...options });
            return dialogs.discardAnswers.shift() ?? false;
        },
        async confirmSave(options) {
            dialogs.asked.push({ kind: "save-changes", ...options });
            return dialogs.saveAnswers.shift() ?? null;
        },
        async newProject() {
            dialogs.asked.push({ kind: "new-project" });
            return dialogs.newProjectAnswers.shift() ?? null;
        },
    };
    return dialogs;
}

/** The codec of `core/project`, run in place. */
export const inPlaceCodec: ProjectCodec = {
    write: async (project) => serialize(project),
    read: (bytes) => deserialize(bytes),
};

export interface Setup {
    sessions: StoreApi<SessionState>;
    workflows: FileWorkflows;
    platform: FakePlatform;
    dialogs: FakeDialogs;
    disk: MemoryDisk;
    infos: string[];
    errors: string[];
    recent: ProjectFileHandle[];
    fitted: string[];
}

/** A project named `name` with one 8 × 6 map, IDs from `prefix`. */
export function project(name = "World", prefix = "p"): Project {
    return createProject({
        name,
        newId: sequentialIds(prefix),
        map: { name: "Map 1", width: 8, height: 6, tileWidth: 16, tileHeight: 16 },
    });
}

/** The workflows over a store open on `initial` (or on the empty state for null). */
export function setup(initial: Project | null = project()): Setup {
    const sessions = createSessionStore(initial && createProjectSession(initial), {
        verify: null,
    });
    const platform = fakePlatform();
    const dialogs = fakeDialogs();
    const infos: string[] = [];
    const errors: string[] = [];
    const recent: ProjectFileHandle[] = [];
    const fitted: string[] = [];
    const workflows = createFileWorkflows({
        sessions,
        platform,
        dialogs,
        codec: inPlaceCodec,
        notices: { info: (message) => infos.push(message), error: (m) => errors.push(m) },
        recent: {
            add: async (handle) => void recent.push(handle),
            remove: async () => {},
        },
        idle: () => !sessions.getState().history.transaction,
        fitWhenShown: (id) => fitted.push(id),
        newProjectDefaults: () => ({
            name: "Untitled",
            map: { name: "Map 1", width: 64, height: 64, tileWidth: 16, tileHeight: 16 },
        }),
    });
    return {
        sessions,
        workflows,
        platform,
        dialogs,
        disk: new MemoryDisk(),
        infos,
        errors,
        recent,
        fitted,
    };
}

/** Renames the project's first map through the history: one undoable change. */
export function edit(sessions: StoreApi<SessionState>, name = "Edited"): void {
    const { history, session } = sessions.getState();
    history.execute(renameMapCommand(session.project.maps[0]!.id, name));
}
