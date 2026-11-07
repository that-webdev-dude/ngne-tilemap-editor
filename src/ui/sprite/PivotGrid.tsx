import { useRef } from "react";
import type { KeyboardEvent } from "react";
import { RESIZE_ANCHORS } from "../../core/maps";
import { movePivotPreset } from "./pivotGridKeys";
import "./pivotGrid.css";

/** Where the old map sits in the new one on each axis: 0, ½ or 1 (`ResizeAnchor`). */
export interface Pivot {
    x: number;
    y: number;
}

export interface PivotGridProps {
    /** Accessible name of the group. */
    label: string;
    /** The checked anchor; null when the offset is not one of the nine. */
    value: Pivot | null;
    onChange(pivot: Pivot): void;
}

/**
 * The 3×3 anchors of Resize / Offset Map (DESIGN §9) as a radio group laid out like the map:
 * the top-left cell is the top-left corner. Arrow keys move the choice by one cell; no cell is
 * checked while the offset is not one of the nine.
 */
export function PivotGrid({ label, value, onChange }: PivotGridProps) {
    const cells = useRef<(HTMLButtonElement | null)[]>([]);
    const checked = value
        ? RESIZE_ANCHORS.findIndex((anchor) => anchor.x === value.x && anchor.y === value.y)
        : -1;
    // One tab stop for the group: the checked cell, or the first one when none is.
    const tabStop = checked === -1 ? 0 : checked;

    const choose = (index: number) => {
        const anchor = RESIZE_ANCHORS[index];
        if (anchor) onChange({ x: anchor.x, y: anchor.y });
    };
    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        const next = movePivotPreset(index, event.key);
        if (next === null) return;
        event.preventDefault();
        cells.current[next]?.focus();
        choose(next);
    };

    return (
        <div className="pivot-grid" role="radiogroup" aria-label={label}>
            {RESIZE_ANCHORS.map((anchor, index) => (
                <button
                    key={anchor.id}
                    ref={(element) => {
                        cells.current[index] = element;
                    }}
                    type="button"
                    role="radio"
                    className="pivot-grid__cell"
                    aria-checked={index === checked}
                    aria-label={anchor.name}
                    data-preset={anchor.id}
                    tabIndex={index === tabStop ? 0 : -1}
                    onClick={() => choose(index)}
                    onKeyDown={(event) => onKeyDown(event, index)}
                />
            ))}
        </div>
    );
}
