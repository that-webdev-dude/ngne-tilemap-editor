import type { ComponentType, SyntheticEvent } from "react";
import { shownSession } from "../../app/state/shownSession";

// The body of a dock section that shows the active map through `useShownSession`. What it shows
// is the map before until the frame of a switch has been drawn (`app/state/shownSession.ts`),
// and a press or a key meant for a row of that map must not act on the map that is active now:
// while the section is behind, it takes no input. Its menus and popovers are covered: their
// events pass through here although they are drawn elsewhere.
//
// The Maps section needs none of this: its rows are the project's maps, whichever is active,
// and a double click on one of them is a switch followed at once by a press on the same row.

/** Keeps an event from a body that shows the map before a switch. */
function dropWhileBehind(event: SyntheticEvent): void {
    if (shownSession.current()) return;
    event.stopPropagation();
    event.preventDefault();
}

/** `Body` as a dock section's body that takes no input while it shows the map before a switch. */
export function showsActiveMap(Body: ComponentType): ComponentType {
    return function ShowsActiveMap() {
        return (
            <div
                style={{ display: "contents" }}
                onPointerDownCapture={dropWhileBehind}
                onMouseDownCapture={dropWhileBehind}
                onClickCapture={dropWhileBehind}
                onDoubleClickCapture={dropWhileBehind}
                onContextMenuCapture={dropWhileBehind}
                onKeyDownCapture={dropWhileBehind}
                onDragStartCapture={dropWhileBehind}
                onDropCapture={dropWhileBehind}
            >
                <Body />
            </div>
        );
    };
}
