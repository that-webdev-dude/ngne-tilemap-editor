import { slotOf, useToolState } from "@ngne/editor-ui/shell";
import { toolState } from "../../app/tools/activeTool";
import { Actions, Readout, VariantChoice } from "./toolControls";

/**
 * What the context bar shows after the active tool's options (DESIGN §7): the choice of its
 * rail slot's variants, its command buttons, then its readouts. The package's context bar
 * draws the tool's name and options and puts this in its readouts slot (`AppShell`
 * `contextReadouts`), which never moves into its overflow menu; registered context bar content
 * takes the place of both.
 */
export function ToolReadouts() {
    useToolState(toolState);
    const tool = toolState.active();
    if (!tool) return null;
    return (
        <>
            {tool.variantLabel === undefined ? null : (
                <VariantChoice key={`${slotOf(tool)}:variants`} tool={tool} tools={toolState} />
            )}
            {tool.actions?.length ? (
                <Actions key={`${tool.id}:actions`} actions={tool.actions} />
            ) : null}
            {(tool.readouts ?? []).map((readout) => (
                <Readout key={`${tool.id}:${readout.key}`} readout={readout} />
            ))}
        </>
    );
}
