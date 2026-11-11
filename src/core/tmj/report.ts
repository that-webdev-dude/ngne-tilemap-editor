// The import report of SPEC §13: every item the conversion dropped or changed, grouped by the
// BRIEF §7 row (or SPEC §13 Conversion bullet) it falls under, with counts and where it was.

/**
 * The rows of the report, in the order the report lists them: the BRIEF §7 rows that drop or
 * change something, then the SPEC §13 Conversion bullets that do, then values the editor's
 * ranges (FORMAT §1, §2.5, §2.8) do not hold.
 */
export const TMJ_REPORT_ROWS = [
    "infinite-map",
    "gid-flip-bits",
    "object-rotation",
    "dropped-objects",
    "template-instances",
    "dropped-properties",
    "enum-properties",
    "tint-blend",
    "terrain-probability",
    "layer-offsets",
    "collision-shapes",
    "terrain-sets",
    "tile-render-size",
    "hidden-objects",
    "render-order",
    "out-of-range",
] as const;

export type TmjReportRow = (typeof TMJ_REPORT_ROWS)[number];

/** The heading of each row: the BRIEF §7 input, or the SPEC §13 item. */
export const TMJ_REPORT_TITLES: Readonly<Record<TmjReportRow, string>> = {
    "infinite-map": "Infinite map",
    "gid-flip-bits": "GID flip bits",
    "object-rotation": "Object rotation",
    "dropped-objects": "Tile objects, text, capsule",
    "template-instances": "Template instances",
    "dropped-properties": "object, list and class-typed properties",
    "enum-properties": "Enum properties",
    "tint-blend": "Layer tint, blend mode",
    "terrain-probability": "Terrain probability, terrain-set transformations, tile probability",
    "layer-offsets": "Fractional layer offsets",
    "collision-shapes": "Tile collision shapes",
    "terrain-sets": "Terrain set classes and properties",
    "tile-render-size": "Tile render size",
    "hidden-objects": "Hidden objects",
    "render-order": "Render order",
    "out-of-range": "Values outside the editor's ranges",
};

/**
 * Where an item was. Layer and object are Tiled's IDs and names, as the user saw them in Tiled;
 * a tileset is named as the project will name it, a tile by Tiled's local ID; none of them for
 * the map itself. An object of a tile is one of its collision shapes.
 */
export interface TmjLocation {
    readonly layer?: { readonly id: number; readonly name: string };
    readonly tileset?: string;
    readonly terrainSet?: string;
    readonly tile?: number;
    readonly object?: { readonly id: number; readonly name: string };
    /** A property's name, when the item is a property or its owner's property was. */
    readonly property?: string;
}

export interface TmjReportEntry {
    readonly row: TmjReportRow;
    /** What happened, for the user: "Rotation 30° dropped". */
    readonly detail: string;
    /** How many items the entry stands for (cells of a layer, for example); at least 1. */
    readonly count: number;
    readonly where: TmjLocation;
}

export interface TmjReportGroup {
    readonly row: TmjReportRow;
    readonly title: string;
    /** The sum of the entries' counts. */
    readonly count: number;
    readonly entries: readonly TmjReportEntry[];
}

/** The entries of a report, grouped by row in `TMJ_REPORT_ROWS` order; rows with none left out. */
export function groupReport(entries: readonly TmjReportEntry[]): TmjReportGroup[] {
    return TMJ_REPORT_ROWS.flatMap((row) => {
        const rowEntries = entries.filter((entry) => entry.row === row);
        if (rowEntries.length === 0) return [];
        const count = rowEntries.reduce((sum, entry) => sum + entry.count, 0);
        return [{ row, title: TMJ_REPORT_TITLES[row], count, entries: rowEntries }];
    });
}

/**
 * The location text of an entry: `Layer "Markers" (2) › Object "Door" (1) › Property "hp"`,
 * `Tileset "dungeon" › Tile 21 › Object "anchor" (2)`.
 */
export function formatLocation(where: TmjLocation): string {
    const parts: string[] = [];
    if (where.layer) parts.push(`Layer "${where.layer.name}" (${where.layer.id})`);
    if (where.tileset !== undefined) parts.push(`Tileset "${where.tileset}"`);
    if (where.terrainSet !== undefined) parts.push(`Terrain set "${where.terrainSet}"`);
    if (where.tile !== undefined) parts.push(`Tile ${where.tile}`);
    if (where.object) parts.push(`Object "${where.object.name}" (${where.object.id})`);
    if (where.property !== undefined) parts.push(`Property "${where.property}"`);
    return parts.length === 0 ? "Map" : parts.join(" › ");
}

/** Collects entries as the conversion goes. */
export class TmjReporter {
    readonly entries: TmjReportEntry[] = [];

    add(row: TmjReportRow, detail: string, where: TmjLocation, count = 1): void {
        this.entries.push({ row, detail, count, where });
    }
}
