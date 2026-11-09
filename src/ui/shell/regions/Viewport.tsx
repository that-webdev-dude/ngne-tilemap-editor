import { useSession } from "../../../app/state/session";
import { EmptyState } from "../../sprite/EmptyState";
import { ViewportArea } from "../../viewport/ViewportArea";

/**
 * The Viewport region: the NGNE canvas of the active map (TE-013), or the empty state while no
 * project is open (TE-047).
 */
export function Viewport() {
    const open = useSession((state) => state.open);
    return open ? <ViewportArea /> : <EmptyState />;
}
