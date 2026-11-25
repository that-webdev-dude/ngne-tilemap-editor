import { slotOf, useToolState } from "@ngne/editor-ui/shell";
import { toolState } from "../../app/tools/activeTool";
import { Readout, VariantChoice } from "./toolControls";

/**
 * What the context bar shows after the active tool's command buttons (DESIGN §7): the choice
 * of its rail slot's variants, then its readouts. The package's context bar draws the tool's
 * name, options and command buttons (`actions`) and puts this in its readouts slot (`AppShell`
 * `contextReadouts`), the place of a variant choice (@ngne/editor-ui SPEC §8), which never
 * moves into its overflow menu; registered context bar content takes the place of all of them.
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
            {(tool.readouts ?? []).map((readout) => (
                <Readout key={`${tool.id}:${readout.key}`} readout={readout} />
            ))}
        </>
    );
}
