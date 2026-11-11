import type { TmjImportReport } from "../../core/tmj";

// The text of the Import Tiled Map report (DESIGN §9; TE-061) that is not the report's own
// entries: the summary lines.

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The summary lines of the report (DESIGN §9): map size, layers, tilesets, markers. */
export function summaryLines(report: TmjImportReport): string[] {
    const { summary } = report;
    const kinds = [
        plural(summary.tileLayers, "tile layer", "tile layers"),
        plural(summary.markerLayers, "marker layer", "marker layers"),
        plural(summary.imageLayers, "image layer", "image layers"),
        plural(summary.groups, "group", "groups"),
    ];
    const tilesets = summary.tilesets.map(
        (tileset) =>
            `${tileset.name} (${plural(tileset.tiles, "tile", "tiles")}${tileset.reused ? ", reused" : ""})`,
    );
    return [
        `Map “${summary.name}”: ${summary.width} × ${summary.height} cells of ` +
            `${summary.tileWidth} × ${summary.tileHeight} px`,
        `${plural(summary.layers, "layer", "layers")}: ${kinds.join(", ")}`,
        `${plural(summary.tilesets.length, "tileset", "tilesets")}${tilesets.length > 0 ? `: ${tilesets.join(", ")}` : ""}`,
        `${plural(summary.markers, "marker", "markers")}, ${plural(summary.images, "image", "images")}`,
    ];
}
