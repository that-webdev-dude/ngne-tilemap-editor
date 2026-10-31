import { gridTests } from "./te-014-cases";

// TE-014: the cell grid on the overlay, Ctrl+G and its persistence, and the status fields, at
// the configured device pixel ratio (1). Ratio 1.25 is te-014-grid-dpr125.spec.ts.
gridTests(1);
