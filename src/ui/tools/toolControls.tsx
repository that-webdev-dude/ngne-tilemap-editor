import { useSyncExternalStore } from "react";
import type { ToolState } from "../../app/tools/activeTool";
import { slotOf } from "../../app/tools/registry";
import type {
    Tool,
    ToolAction,
    ToolOptionSpec,
    ToolOptionValue,
    ToolReadout,
} from "../../app/tools/types";
import { runCommand } from "../commands/runCommand";
import { useCommands } from "../commands/useCommands";
import { Button } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { IconButton } from "../primitives/IconButton";
import { NumberField } from "../primitives/NumberField";
import { SegmentedControl } from "../primitives/SegmentedControl";
import { Select } from "../primitives/Select";
import { Tooltip } from "../primitives/Tooltip";
import { Toggle } from "../primitives/Toggle";

// The controls the context bar shows for the active tool (DESIGN §7): an option by its kind,
// the variants of its rail slot, its command buttons and its readouts. Used by the context bar
// (`shell/regions/ContextBar.tsx`) and by context bar content that shows a tool's options with
// more of its own (`fillMode.contextbar.tsx`); kept apart from the context bar, which loads the
// registered content, so that content does not import the module that discovers it.

interface OptionControlProps {
    option: ToolOptionSpec;
    value: ToolOptionValue;
    onChange(value: ToolOptionValue): void;
}

/** A readout of the active tool: its label and the text it reads now (DESIGN §7). */
export function Readout({ readout }: { readout: ToolReadout }) {
    const text = useSyncExternalStore(readout.subscribe, readout.read);
    return (
        <span className="ui-field" data-tool-readout={readout.key}>
            <span className="ui-field__label">{readout.label}</span>
            <output className="context-readout">{text}</output>
        </span>
    );
}

/**
 * The command buttons of the active tool (DESIGN §7: rotate and flip the stamp): an icon
 * button or a text button each, disabled while its command is.
 */
export function Actions({ actions }: { actions: readonly ToolAction[] }) {
    const commands = useCommands();
    return (
        <span className="context-actions">
            {actions.map((action) => {
                const command = commands.find((each) => each.id === action.command);
                const data = { "data-tool-action": action.command };
                const disabled = !command || !command.enabled();
                const run = () => void runCommand(action.command);
                return action.icon ? (
                    <IconButton
                        key={action.command}
                        {...data}
                        label={action.label}
                        shortcut={command?.shortcuts[0]}
                        disabled={disabled}
                        onClick={run}
                    >
                        <Icon icon={action.icon} />
                    </IconButton>
                ) : (
                    <Tooltip
                        key={action.command}
                        label={command?.title() ?? action.label}
                        shortcut={command?.shortcuts[0]}
                    >
                        <Button {...data} disabled={disabled} onClick={run}>
                            {action.label}
                        </Button>
                    </Tooltip>
                );
            })}
        </span>
    );
}

/**
 * The variants of the active tool's rail slot that name themselves in the context bar (DESIGN
 * §7: the shape fill's Rectangle / Ellipse), as a segmented control that selects one.
 */
export function VariantChoice({ tool, tools }: { tool: Tool; tools: ToolState }) {
    const slotId = slotOf(tool);
    const slot = tools.registry.railSlots().find((each) => each.id === slotId);
    const variants = (slot?.variants ?? []).filter((each) => each.variantLabel !== undefined);
    if (!slot || variants.length < 2) return null;
    return (
        <span className="ui-field" data-tool-variant-choice={slot.id}>
            <SegmentedControl
                label={slot.label}
                value={tool.id}
                onChange={(id) => void tools.select(id)}
                options={variants.map((each) => ({ value: each.id, label: each.variantLabel! }))}
            />
        </span>
    );
}

/** One option of the active tool, as the control its kind calls for (DESIGN §7). */
export function OptionControl({ option, value, onChange }: OptionControlProps) {
    const data = { "data-tool-option": option.key };
    switch (option.kind) {
        case "number":
            return (
                <span {...data}>
                    <NumberField
                        label={option.label}
                        value={Number(value)}
                        onChange={onChange}
                        min={option.min}
                        max={option.max}
                        step={option.step}
                        unit={option.unit}
                    />
                </span>
            );
        case "toggle":
            return (
                <Toggle
                    {...data}
                    label={option.label}
                    pressed={value === true}
                    onPressedChange={onChange}
                    showLabel
                />
            );
        case "choice": {
            const choice = String(value);
            if (option.display === "select") {
                return (
                    <span {...data}>
                        <Select
                            label={option.label}
                            value={choice}
                            onChange={onChange}
                            options={option.choices}
                        />
                    </span>
                );
            }
            return (
                <span className="ui-field" {...data}>
                    {/* The group is named by its aria-label; this is the visible label. */}
                    <span className="ui-field__label" aria-hidden="true">
                        {option.label}
                    </span>
                    <SegmentedControl
                        label={option.label}
                        value={choice}
                        onChange={onChange}
                        options={option.choices}
                    />
                </span>
            );
        }
    }
}
