// The terrain filler's random choice among equal candidates (SPEC §5.2): Marsaglia's
// `xorshift32` (shifts 13, 17, 5). The session seeds it from the clock, tests with a constant,
// so with a fixed seed the filler's result is deterministic.

/** A source of unsigned 32-bit integers. */
export type Random = () => number;

/** Replaces the one seed `xorshift32` cannot leave: 0. */
const ZERO_SEED = 0x9e3779b9;

/** A `xorshift32` generator from `seed` (taken as unsigned 32-bit; 0 is replaced). */
export function xorshift32(seed: number): Random {
    let state = seed >>> 0 || ZERO_SEED;
    return () => {
        state ^= state << 13;
        state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;
        return state;
    };
}

/** A seed from the clock, for a session's generator. */
export function clockSeed(now: number = Date.now()): number {
    return (Math.floor(now) % 0x100000000) >>> 0 || ZERO_SEED;
}
