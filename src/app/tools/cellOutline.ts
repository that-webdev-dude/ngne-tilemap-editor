import type { CellRect } from "../../core/cells";
import type { ProjectMap } from "../../core/model";
import type { DeviceRect } from "../overlay/gridLines";
import type { ViewMapping } from "../view/coordinates";

// Cell rectangles on the overlay (DESIGN §4: the stamp and erase previews): their device
// rectangle on whole pixels, and the four 1-pixel sides of its outline, drawn inside it.

/** The device rectangle of `rect`, edges rounded to whole device pixels. */
export function cellDeviceRect(mapping: ViewMapping, rect: CellRect): DeviceRect {
    const start = mapping.cellToDevice(rect.x, rect.y);
    const end = mapping.cellToDevice(rect.x + rect.width, rect.y + rect.height);
    const x = Math.round(start.x);
    const y = Math.round(start.y);
    return { x, y, width: Math.round(end.x) - x, height: Math.round(end.y) - y };
}

/** The part of `rect` inside `map`; null when none of it is. */
export function clipToMap(
    rect: CellRect,
    map: Pick<ProjectMap, "width" | "height">,
): CellRect | null {
    const x = Math.max(0, rect.x);
    const y = Math.max(0, rect.y);
    const right = Math.min(map.width, rect.x + rect.width);
    const bottom = Math.min(map.height, rect.y + rect.height);
    if (right <= x || bottom <= y) return null;
    return { x, y, width: right - x, height: bottom - y };
}

/** The 1-pixel sides of the outline of `rect`, inside it; none for an empty rectangle. */
export function outlineRects(rect: DeviceRect): DeviceRect[] {
    const { x, y, width, height } = rect;
    if (width < 1 || height < 1) return [];
    if (width <= 2 || height <= 2) return [rect];
    return [
        { x, y, width, height: 1 },
        { x, y: y + height - 1, width, height: 1 },
        { x, y: y + 1, width: 1, height: height - 2 },
        { x: x + width - 1, y: y + 1, width: 1, height: height - 2 },
    ];
}
