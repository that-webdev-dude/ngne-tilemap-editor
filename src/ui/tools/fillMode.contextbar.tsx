import { Fragment } from "react";
import { toolState } from "../../app/tools/activeTool";
import { bucketTool } from "../../app/tools/fill/bucket.tools";
import { fillModeOf } from "../../app/tools/fill/fillPlan";
import { ellipseFillTool, rectangleFillTool } from "../../app/tools/fill/shapeFill.tools";
import { slotOf } from "../../app/tools/registry";
import type { Tool, ToolOptionValue } from "../../app/tools/types";
import { TerrainPickers } from "../terrains/TerrainPickers";
import type { ContextBarContent } from "./contextBarRegistry";
import { Actions, OptionControl, Readout, VariantChoice } from "./toolControls";
import { useToolState } from "./useToolState";
import "./fillMode.css";

// The context bar of the bucket and the shape fill (DESIGN §7): the tool's options as the
// context bar shows them, with the terrain set and terrain pickers of the terrain brush after
// Fill while it is Terrain (SPEC §5.4), then the shape's variants, the stamp transforms and
// the readouts, with the controls of `toolControls.tsx`. The fill mode is one per tool, as Tiled keeps it per tool: the Rectangle and Ellipse
// variants of the shape fill are one tool in Tiled (`ShapeFillTool`), so an option set here is
// set for every variant of the rail slot that has it. Registered as context bar content so it
// takes the options' place while a fill tool is active (contextBarRegistry.ts).

const FILL_TOOLS: readonly string[] = [bucketTool.id, rectangleFillTool.id, ellipseFillTool.id];

/** Sets option `key` of `tool` and of every other variant of its rail slot that has it. */
function setSlotOption(tool: Tool, key: string, value: ToolOptionValue): void {
    const slot = toolState.registry.railSlots().find((each) => each.id === slotOf(tool));
    const variants = slot?.variants.length ? slot.variants : [tool];
    for (const variant of variants) {
        if (variant.options.some((option) => option.key === key)) {
            toolState.setOption(variant, key, value);
        }
    }
}

function FillBar() {
    const tools = useToolState();
    const tool = tools.active();
    if (!tool) return null;
    const values = tools.options(tool);
    const terrain = fillModeOf(values) === "terrain";
    return (
        <>
            {tool.options.map((option) => (
                <Fragment key={`${tool.id}:${option.key}`}>
                    <OptionControl
                        option={option}
                        value={values[option.key] ?? option.default}
                        onChange={(value) => setSlotOption(tool, option.key, value)}
                    />
                    {option.key === "fillMode" && terrain ? <TerrainPickers /> : null}
                </Fragment>
            ))}
            {tool.variantLabel === undefined ? null : <VariantChoice tool={tool} tools={tools} />}
            {tool.actions?.length ? <Actions actions={tool.actions} /> : null}
            {(tool.readouts ?? []).map((readout) => (
                <Readout key={`${tool.id}:${readout.key}`} readout={readout} />
            ))}
        </>
    );
}

export const contextBarContent: ContextBarContent = {
    id: "fill",
    order: 61,
    shown: () => toolState.kind() === "tile" && FILL_TOOLS.includes(toolState.activeId()),
    subscribe: (listener) => toolState.subscribe(listener),
    Body: FillBar,
};
