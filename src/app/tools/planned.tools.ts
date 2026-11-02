import {
    Circle,
    Eraser,
    Hand,
    MapPin,
    Mountain,
    MousePointer2,
    PaintBucket,
    Pentagon,
    ScanSearch,
    Spline,
    Square,
    SquareDashed,
    Stamp,
    WandSparkles,
    Waypoints,
    ZoomIn,
} from "lucide-react";
import type { PlannedToolSpec } from "./types";

/**
 * The slots of the tool rail (DESIGN §6) with the keys of DESIGN §10.3. Each is shown as a
 * disabled button until a tool with the same id is registered from its ticket's own
 * `*.tools.ts` module; the tool then takes the slot over, its position, key and icon included
 * unless it names its own. Positions are spaced by 10; the hundreds are the rail's groups:
 * tile paint · terrain · tile select · marker select · marker create · navigate. `layers`
 * names the tool set a slot belongs to; the navigate group is in every set.
 */
export const plannedTools: PlannedToolSpec[] = [
    tile("stamp", "Stamp Brush", "B", Stamp, 100),
    tile("eraser", "Eraser", "E", Eraser, 110),
    tile("bucket", "Bucket Fill", "G", PaintBucket, 120),
    tile("shapeFill", "Shape Fill", "U", Square, 130),
    tile("terrain", "Terrain Brush", "T", Mountain, 200),
    tile("rectSelect", "Rectangle Select", "M", SquareDashed, 300),
    tile("wand", "Magic Wand", "W", WandSparkles, 310),
    tile("sameTile", "Select Same Tile", "S", ScanSearch, 320),
    marker("markerSelect", "Select", "V", MousePointer2, 400),
    marker("editPoints", "Edit Points", "O", Spline, 410),
    marker("markerRectangle", "Rectangle", "U", Square, 500),
    marker("markerEllipse", "Ellipse", "Shift+U", Circle, 510),
    marker("markerPoint", "Point", "P", MapPin, 520),
    marker("markerPolygon", "Polygon", "Shift+D", Pentagon, 530),
    marker("markerPolyline", "Polyline", "L", Waypoints, 540),
    { id: "hand", label: "Hand", shortcut: "H", icon: Hand, railOrder: 900 },
    { id: "zoom", label: "Zoom", shortcut: "Z", icon: ZoomIn, railOrder: 910 },
];

function tile(...[id, label, shortcut, icon, railOrder]: SlotArgs): PlannedToolSpec {
    return { id, label, shortcut, icon, railOrder, layers: ["tile"] };
}

function marker(...[id, label, shortcut, icon, railOrder]: SlotArgs): PlannedToolSpec {
    return { id, label, shortcut, icon, railOrder, layers: ["marker"] };
}

type SlotArgs = [string, string, string, PlannedToolSpec["icon"], number];
