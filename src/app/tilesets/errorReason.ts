/** The message of a thrown value, or the value as text when it has none. */
export function reason(error: unknown): string {
    return error instanceof Error && error.message !== "" ? error.message : String(error);
}
