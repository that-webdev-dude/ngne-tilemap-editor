// The ID of the Edit points tool (DESIGN §6: the rail slot `editPoints`; TE-039). A module of its
// own, importing nothing: the tool registry loads the tool, and the chosen point's state reads
// the active tool, so both name the ID without importing each other first.

export const EDIT_POINTS_TOOL = "editPoints";
