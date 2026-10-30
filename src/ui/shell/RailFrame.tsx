import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { railColumns } from "./layout";
import { RegionBoundary } from "./RegionBoundary";

export interface RailFrameProps {
    children: ReactNode;
    /**
     * The number of buttons in each group of the rail, as the rail's content plans them: the
     * tool set of the active layer's kind (DESIGN §6, TE-016). None while no tool exists.
     */
    groups?: readonly number[];
    /** Height of the footer in one column (the stamp preview, DESIGN §2); 0 without one. */
    footer?: number;
}

/**
 * Tool rail region. It lays its groups out in one column and switches to two (72 px) when they
 * do not fit its height; it never scrolls and never clips a tool (`se-design` §2). The content
 * is built from `RailGroup` and, at the bottom, an optional `RailFooter`; separators between
 * groups are drawn by the rail.
 *
 * The column count follows the planned content, not what is rendered: a rail whose content
 * failed to render keeps the healthy layout, and the footer, which two columns lay out side by
 * side, cannot make the rail switch back and forth.
 */
export function RailFrame({ children, groups = [], footer = 0 }: RailFrameProps) {
    const ref = useRef<HTMLElement>(null);
    const [height, setHeight] = useState<number | null>(null);

    useLayoutEffect(() => {
        const rail = ref.current;
        if (!rail) return;
        // The resize observer reports once when it starts, before the first paint.
        const resize = new ResizeObserver(() => setHeight(rail.clientHeight));
        resize.observe(rail);
        return () => resize.disconnect();
    }, []);

    const columns = height === null ? 1 : railColumns(groups, footer, height);

    return (
        <nav
            ref={ref}
            className="shell-rail"
            data-region="tool-rail"
            data-columns={columns}
            aria-label="Tools"
        >
            <RegionBoundary name="Tool rail" compact>
                {children}
            </RegionBoundary>
        </nav>
    );
}

/** One group of tool buttons; its direct children are the buttons. */
export function RailGroup({ children }: { children: ReactNode }) {
    return (
        <div className="shell-rail__group" data-rail-group="">
            {children}
        </div>
    );
}

/**
 * Content pinned to the bottom of the rail (the stamp preview of DESIGN §2). Its children
 * stack in one column and stand side by side in two.
 */
export function RailFooter({ children }: { children: ReactNode }) {
    return (
        <div className="shell-rail__footer" data-rail-footer="">
            {children}
        </div>
    );
}
