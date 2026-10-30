import { AllocationError } from "./errors";

/**
 * Returns `byteLength` zero bytes, or throws when it cannot. A history takes one as an
 * option so that a test can make allocation fail.
 */
export type Allocator = (byteLength: number) => ArrayBuffer;

/** The allocator used unless another is given. */
export const defaultAllocator: Allocator = (byteLength) => new ArrayBuffer(byteLength);

/** `count` zeroed 32-bit words. Any failure of `allocate` is an `AllocationError`. */
export function allocateWords(allocate: Allocator, count: number): Uint32Array {
    const bytes = count * 4;
    try {
        return new Uint32Array(allocate(bytes));
    } catch (cause) {
        throw new AllocationError(bytes, cause);
    }
}
