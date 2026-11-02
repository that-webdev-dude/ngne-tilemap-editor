import { railToolSet } from "../../../app/tools/toolSets";
import { Icon } from "../../primitives/Icon";
import { ToolButton } from "../../primitives/ToolButton";
import { useToolState } from "../../tools/useToolState";
import { VariantToolButton } from "../../tools/VariantToolButton";
import { RailGroup } from "../RailFrame";

/**
 * Tool rail content (DESIGN §6), rendered from the tool registry: the tool set of the active
 * layer's kind, a button per slot in the groups of the rail, and the navigate group in every
 * set. A registered tool's button selects it; the active tool's is pressed. A slot planned for
 * a later ticket is a disabled button until its tool is registered. A slot with variants shows
 * the one selected last, with a corner mark, and holding it opens the menu of its variants.
 * The stamp preview joins the bottom of the rail with TE-017.
 */
export function ToolRail() {
    const tools = useToolState();
    const active = tools.activeId();
    return (
        <>
            {railToolSet(tools.registry, tools.kind()).map((group) => (
                <RailGroup key={group[0]?.id}>
                    {group.map((slot) => {
                        const shown = tools.shownInSlot(slot);
                        if (shown && slot.variants.length > 1) {
                            return (
                                <VariantToolButton
                                    key={slot.id}
                                    slot={slot}
                                    shown={shown}
                                    active={shown.id === active}
                                    select={(id) => void tools.select(id)}
                                />
                            );
                        }
                        const icon = shown?.icon ?? slot.icon;
                        return (
                            <ToolButton
                                key={slot.id}
                                label={shown?.label ?? slot.label}
                                shortcut={shown?.shortcut ?? slot.shortcut}
                                data-tool={slot.id}
                                active={shown !== null && shown.id === active}
                                disabled={shown === null}
                                onClick={() => shown && tools.select(shown.id)}
                            >
                                {icon ? <Icon icon={icon} /> : null}
                            </ToolButton>
                        );
                    })}
                </RailGroup>
            ))}
        </>
    );
}
