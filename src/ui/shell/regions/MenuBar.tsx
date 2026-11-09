import { Menubar } from "radix-ui";
import { MENU_BAR } from "../../../app/commands/types";
import { useSession } from "../../../app/state/session";
import { CommandPaletteTrigger } from "../../commandPalette/CommandPaletteTrigger";
import { MenubarItems } from "../../menubar/MenubarItems";
import { MapTabs } from "../../tabs/MapTabs";
import "../../primitives/menu.css";
import "../../menubar/menubar.css";

/** The seven menus (DESIGN §5), each generated from the command registry. */
function Menus() {
    return (
        <Menubar.Root className="menubar" aria-label="Main menu" loop>
            {MENU_BAR.map((menu) => (
                <Menubar.Menu key={menu} value={menu}>
                    <Menubar.Trigger className="menubar__trigger">{menu}</Menubar.Trigger>
                    <Menubar.Portal>
                        <Menubar.Content
                            className="ui-menu"
                            align="start"
                            sideOffset={6}
                            collisionPadding={8}
                        >
                            <MenubarItems menu={menu} />
                        </Menubar.Content>
                    </Menubar.Portal>
                </Menubar.Menu>
            ))}
        </Menubar.Root>
    );
}

/**
 * Menu bar content: the menus, the project's name and the map tabs in the centre (TE-031; none
 * while no project is open, TE-047) and the command palette trigger at the right (TE-008). The
 * dialogs the menus open are shown by the dialog host at the root of the app.
 */
export function MenuBar() {
    const open = useSession((state) => state.open);
    return (
        <>
            <Menus />
            {open ? <MapTabs /> : <span className="map-tabs" />}
            <CommandPaletteTrigger />
        </>
    );
}
