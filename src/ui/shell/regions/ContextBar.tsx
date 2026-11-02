import { useSyncExternalStore } from "react";
import { slotOf } from "../../../app/tools/registry";
import type { ToolState } from "../../../app/tools/activeTool";
import type {
    Tool,
    ToolAction,
    ToolOptionSpec,
    ToolOptionValue,
    ToolReadout,
} from "../../../app/tools/types";
import { runCommand } from "../../commands/runCommand";
import { useCommands } from "../../commands/useCommands";
import { shownContextBarContent, subscribeContextBarContent } from "../../tools/contextBarRegistry";
import { Button } from "../../primitives/Button";
import { Icon } from "../../primitives/Icon";
import { IconButton } from "../../primitives/IconButton";
import { NumberField } from "../../primitives/NumberField";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import { Select } from "../../primitives/Select";
import { Tooltip } from "../../primitives/Tooltip";
import { Toggle } from "../../primitives/Toggle";
import { useToolState } from "../../tools/useToolState";
import "../../tools/contextBar.css";

interface OptionControlProps {
    option: ToolOptionSpec;
    value: ToolOptionValue;
    onChange(value: ToolOptionValue): void;
}

/** A readout of the active tool: its label and the text it reads now (DESIGN §7). */
function Readout({ readout }: { readout: ToolReadout }) {
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
function Actions({ actions }: { actions: readonly ToolAction[] }) {
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
function VariantChoice({ tool, tools }: { tool: Tool; tools: ToolState }) {
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
function OptionControl({ option, value, onChange }: OptionControlProps) {
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

/**
 * Context bar content (DESIGN §7): the active tool's name and its options, in the order the
 * tool lists them, rendered from its option schema, then the choice of its slot's variants,
 * then its command buttons, then its readouts. Empty while no registered tool is active.
 * While registered content is shown (`contextBarRegistry.ts`), it takes the options' place.
 */
export function ContextBar() {
    const tools = useToolState();
    const content = useSyncExternalStore(subscribeContextBarContent, shownContextBarContent);
    const tool = tools.active();
    if (!tool) return null;
    const values = tools.options(tool);
    return (
        <>
            <span className="context-tool" data-context-tool={tool.id}>
                {tool.label}
            </span>
            {content ? (
                <span className="context-content" data-context-content={content.id}>
                    <content.Body />
                </span>
            ) : null}
            {content
                ? null
                : tool.options.map((option) => (
                      <OptionControl
                          key={`${tool.id}:${option.key}`}
                          option={option}
                          value={values[option.key] ?? option.default}
                          onChange={(value) => tools.setOption(tool, option.key, value)}
                      />
                  ))}
            {content || tool.variantLabel === undefined ? null : (
                <VariantChoice key={`${slotOf(tool)}:variants`} tool={tool} tools={tools} />
            )}
            {content || !tool.actions?.length ? null : (
                <Actions key={`${tool.id}:actions`} actions={tool.actions} />
            )}
            {content
                ? null
                : (tool.readouts ?? []).map((readout) => (
                      <Readout key={`${tool.id}:${readout.key}`} readout={readout} />
                  ))}
        </>
    );
}
