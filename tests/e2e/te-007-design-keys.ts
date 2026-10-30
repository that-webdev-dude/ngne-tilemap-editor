import { readFileSync } from "node:fs";
import { parseDesignKeyTable } from "./harness/te-007-design-keys";
import type { DesignKeyTable } from "./harness/te-007-design-keys";

// TE-007: the key table of DESIGN §10.3 as the spec reads it, from docs/DESIGN.md on disk. The
// parser itself lives beside the harness page, which runs it in the browser.

export * from "./harness/te-007-design-keys";

export function readDesignKeyTable(): DesignKeyTable {
    return parseDesignKeyTable(
        readFileSync(new URL("../../docs/DESIGN.md", import.meta.url), "utf8"),
    );
}
