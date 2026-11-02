import { useSyncExternalStore } from "react";
import type { ToolOptionSpec, ToolOptionValue, ToolReadout } from "../../../app/tools/types";
import { shownContextBarContent, subscribeContextBarContent } from "../../tools/contextBarRegistry";
import { NumberField } from "../../primitives/NumberField";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import { Select } from "../../primitives/Select";
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
 * tool lists them, rendered from its option schema, then its readouts. Empty while no
 * registered tool is active.
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
            {content
                ? null
                : (tool.readouts ?? []).map((readout) => (
                      <Readout key={`${tool.id}:${readout.key}`} readout={readout} />
                  ))}
        </>
    );
}
