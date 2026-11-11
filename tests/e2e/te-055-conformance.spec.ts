import { conformanceTests } from "./te-055-cases";

// TE-055: export conformance (SPEC §10.3) at device pixel ratio 1. The three conditions for
// every fixture: atlases and tilemaps pass their readers; the export reads back as the project;
// a real NGNE game draws every map as `core/compositor` does at scales 1 and 3, and at 1.25
// with no texel of a neighbouring atlas rectangle. DPR 1.25: te-055-conformance-dpr125.spec.ts.

conformanceTests(1);
