// SHA-256 (FIPS 180-4) over bytes, synchronous and without host APIs, so that `core/` computes
// tile fingerprints (FORMAT §2.4) in Node, in the worker and on the main thread alike.
// `crypto.subtle.digest` would do it natively, but only asynchronously, per call.

const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INITIAL = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** Runs the compression function over the 64-byte block of `bytes` at `offset`. */
function compress(state: Uint32Array, w: Uint32Array, bytes: Uint8Array, offset: number): void {
    for (let i = 0; i < 16; i++) {
        const at = offset + i * 4;
        w[i] = (bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!;
    }
    for (let i = 16; i < 64; i++) {
        const a = w[i - 15]!;
        const b = w[i - 2]!;
        const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
        const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
        w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    let a = state[0]!;
    let b = state[1]!;
    let c = state[2]!;
    let d = state[3]!;
    let e = state[4]!;
    let f = state[5]!;
    let g = state[6]!;
    let h = state[7]!;
    for (let i = 0; i < 64; i++) {
        const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const choice = (e & f) ^ (~e & g);
        const t1 = (h + s1 + choice + K[i]! + w[i]!) | 0;
        const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (s0 + majority) | 0;
        h = g;
        g = f;
        f = e;
        e = (d + t1) | 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) | 0;
    }
    state[0] = state[0]! + a;
    state[1] = state[1]! + b;
    state[2] = state[2]! + c;
    state[3] = state[3]! + d;
    state[4] = state[4]! + e;
    state[5] = state[5]! + f;
    state[6] = state[6]! + g;
    state[7] = state[7]! + h;
}

/** The SHA-256 of `bytes` as 64 lowercase hexadecimal digits. */
export function sha256Hex(bytes: Uint8Array): string {
    const state = Uint32Array.from(INITIAL);
    const w = new Uint32Array(64);
    const whole = bytes.length - (bytes.length % 64);
    for (let offset = 0; offset < whole; offset += 64) compress(state, w, bytes, offset);

    // The rest, the 0x80 marker, zeros and the bit length as a 64-bit big-endian integer.
    const rest = bytes.length - whole;
    const tail = new Uint8Array(rest < 56 ? 64 : 128);
    tail.set(bytes.subarray(whole));
    tail[rest] = 0x80;
    const bits = bytes.length * 8;
    const view = new DataView(tail.buffer);
    view.setUint32(tail.length - 8, Math.floor(bits / 0x100000000));
    view.setUint32(tail.length - 4, bits >>> 0);
    for (let offset = 0; offset < tail.length; offset += 64) compress(state, w, tail, offset);

    let hex = "";
    for (const word of state) hex += word.toString(16).padStart(8, "0");
    return hex;
}
