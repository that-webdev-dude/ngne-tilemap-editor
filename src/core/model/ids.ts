import { MAX_ID_LENGTH } from "./limits";

// IDs of FORMAT §1.1: 1 to 64 characters of `A`–`Z`, `a`–`z`, `0`–`9`, `_` and `-`. The editor
// writes UUIDs. As in the sprite editor (`core/sprite/model/ids.ts`), a generator is passed
// where tests need deterministic IDs.

/** Returns a new ID on every call. */
export type IdGenerator = () => string;

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Whether `value` is a well-formed ID. */
export function isId(value: unknown): value is string {
    return typeof value === "string" && value.length <= MAX_ID_LENGTH && ID_PATTERN.test(value);
}

/** The default generator: a random UUID. */
export const randomId: IdGenerator = () => crypto.randomUUID();

/** A deterministic generator for tests: `<prefix>1`, `<prefix>2`, … */
export function sequentialIds(prefix = "id"): IdGenerator {
    let count = 0;
    return () => `${prefix}${++count}`;
}

/** The key under which IDs compare: FORMAT §2.4 forbids two that differ only in letter case. */
export function idKey(id: string): string {
    return id.toLowerCase();
}
