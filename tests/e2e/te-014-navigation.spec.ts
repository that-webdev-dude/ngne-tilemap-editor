import { navigationTests } from "./te-014-cases";

// TE-014: wheel, keys, Space-drag and middle-drag navigation and the per-map view, at the
// configured device pixel ratio (1). Ratio 1.25 is te-014-navigation-dpr125.spec.ts.
navigationTests(1);
