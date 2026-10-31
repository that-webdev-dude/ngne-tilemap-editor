import { ProjectError, openZip, writeZip } from "../../../core/codec";
import type { ZipInput } from "../../../core/codec";
import { buffersOf, defineTask } from "../task";

// The zip container (`core/sprite/project/zip`) off the main thread.

export interface ZipWriteInput {
    entries: ZipInput[];
}

export interface ZipReadInput {
    bytes: Uint8Array;
    /** `openZip`'s bound on all entries read together. */
    maxTotalBytes: number;
    /** The entries to read, in order, each with its own bound. */
    entries: { name: string; maxBytes: number }[];
}

declare module "../protocol" {
    interface WorkerTaskTypes {
        /** `writeZip`; the archive is transferred. */
        "zip.write": TaskType<ZipWriteInput, Uint8Array<ArrayBuffer>, ProjectError>;
        /**
         * `openZip`, then `read` of each entry asked for, in order: its content, or
         * `undefined` when the archive has none. The contents are transferred; a stored entry
         * is a view of the archive's bytes.
         */
        "zip.read": TaskType<ZipReadInput, (Uint8Array | undefined)[], ProjectError>;
    }
}

export const tasks = [
    defineTask("zip.write", {
        run: ({ entries }) => writeZip(entries),
        transfer: (bytes) => buffersOf(bytes),
        failures: [ProjectError],
    }),
    defineTask("zip.read", {
        run: ({ bytes, maxTotalBytes, entries }) => {
            const archive = openZip(bytes, maxTotalBytes);
            return entries.map(({ name, maxBytes }) => archive.read(name, maxBytes));
        },
        transfer: (contents) => buffersOf(...contents.filter((data) => data !== undefined)),
        failures: [ProjectError],
    }),
];
