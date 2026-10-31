import { preferences } from "../preferences/preferences";
import { viewPreferences } from "../view/viewPreferences";
import { fillRects } from "./draw";
import { axesOf, cellGridLines, lineRects, visiblePart } from "./gridLines";
import type { OverlayLayer } from "./types";

// The cell grid (DESIGN §4), drawn while Show Grid is on (View → Show Grid, `grid.commands.ts`).
// Lines lie on cell edges (`gridLines.ts`), in the grid preference's colour: by default the
// theme's ink, white in the dark theme and black in the light one, at 25%.

/** The tile-grid alpha of DESIGN §4; the default of the grid preference. */
export const CELL_GRID_ALPHA = 0.25;

export const overlayLayers: OverlayLayer[] = [
    {
        id: "cell-grid",
        order: 300,
        draw(frame) {
            if (!viewPreferences.getState().grid) return;
            const { map, mapping, size, context } = frame;
            const mapWidth = map.width * map.tileWidth;
            const mapHeight = map.height * map.tileHeight;
            const corner = mapping.mapToDevice(0, 0);
            const area = visiblePart(
                {
                    x: Math.round(corner.x),
                    y: Math.round(corner.y),
                    width: Math.round(mapWidth * mapping.scale),
                    height: Math.round(mapHeight * mapping.scale),
                },
                size,
            );
            if (!area) return;
            const axes = axesOf(
                corner,
                mapping.scale,
                { width: mapWidth, height: mapHeight },
                size,
            );
            const lines = cellGridLines(axes, map.tileWidth, map.tileHeight);
            const { colour, opacity } = preferences.get("grid");
            fillRects(
                context,
                lineRects(lines, area),
                colour === "theme" ? frame.theme.ink : colour,
                opacity / 100,
            );
        },
        // Show Grid and the grid's colour and opacity.
        watch(redraw) {
            const stopView = viewPreferences.subscribe((state, previous) => {
                if (state.grid !== previous.grid) redraw();
            });
            const stopPreferences = preferences.subscribe((key) => {
                if (key === "grid") redraw();
            });
            return () => {
                stopView();
                stopPreferences();
            };
        },
    },
];
