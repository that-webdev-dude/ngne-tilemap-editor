import { useSyncExternalStore } from "react";
import { slotOf } from "../../../app/tools/registry";
import { shownContextBarContent, subscribeContextBarContent } from "../../tools/contextBarRegistry";
import { Actions, OptionControl, Readout, VariantChoice } from "../../tools/toolControls";
import { useToolState } from "../../tools/useToolState";
import "../../tools/contextBar.css";

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
