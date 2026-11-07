import type { ComponentType } from "react";
import type { Command } from "../../core/history";
import type { Layer, Project } from "../../core/model";
// Declares `import.meta.glob` wherever this module is compiled.
import type {} from "../../import-meta";

/**
 * Layer popover field registry (DESIGN §8.2; TE-035). The layer properties popover shows name,
 * class, opacity, offset and parallax for every layer; a kind adds its own fields (image and
 * repeat X/Y: TE-036; marker colour: TE-037) by creating a module named `*.layerField.tsx`
 * anywhere under `src/ui` that exports `layerField`; this file finds it with a glob import, so
 * no shared file is edited (RULES 6).
 *
 *     // src/ui/markers/colour.layerField.tsx
 *     export const layerField: LayerField<number> = {
 *         id: "colour", order: 10,
 *         appliesTo: (layer) => layer.type === "marker",
 *         read: (layer) => (layer as MarkerLayer).color,
 *         command: (project, mapId, layerId, colour) => markerColourCommand(...),
 *         Field: ColourField,
 *     };
 *
 * A field edits a draft value; when the popover closes, every field whose value differs from
 * `read` gives its `command`, and they make one undo step with the common fields.
 *
 * `command` only calls a function of the field's `src/app` module, which builds the command
 * (RULES 4: `src/ui` changes documents only through the app); the field module builds no
 * command itself and executes none.
 */
export interface LayerField<Value = unknown> {
    /** Stable, unique id; the key of its value in the draft. */
    id: string;
    /** Position below the common fields, ascending. */
    order: number;
    /** Whether the field shows for `layer`. */
    appliesTo(layer: Layer): boolean;
    /** The value the layer has now: the field's first value. */
    read(layer: Layer): Value;
    /** Whether two values are the same; `Object.is` by default. */
    equals?(a: Value, b: Value): boolean;
    /**
     * The command that sets `value` on layer `layerId` of map `mapId`: the result of an app
     * function the field calls, never one it builds.
     */
    command(project: Project, mapId: string, layerId: number, value: Value): Command;
    /** The field in the popover. */
    Field: ComponentType<LayerFieldProps<Value>>;
}

export interface LayerFieldProps<Value> {
    layer: Layer;
    value: Value;
    onChange(value: Value): void;
}

/** What a `*.layerField.tsx` module exports. */
export interface LayerFieldModule {
    layerField?: LayerField<never>;
}

/** Validates the discovered modules and returns their fields in popover order. */
export function collectLayerFields(modules: Record<string, LayerFieldModule>): LayerField[] {
    const seen = new Map<string, string>();
    const fields: LayerField[] = [];
    for (const [path, module] of Object.entries(modules)) {
        const field = module.layerField as LayerField | undefined;
        if (!field) throw new Error(`${path} does not export "layerField".`);
        const first = seen.get(field.id);
        if (first) throw new Error(`Layer field id "${field.id}" is used by ${first} and ${path}.`);
        seen.set(field.id, path);
        fields.push(field);
    }
    return fields.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/**
 * The commands of the fields of `fields` that apply to `layer` and whose value in `extras`
 * differs from the layer's.
 */
export function extraCommands(
    fields: readonly LayerField[],
    project: Project,
    mapId: string,
    layer: Layer,
    extras: Readonly<Record<string, unknown>>,
): Command[] {
    const commands: Command[] = [];
    for (const field of fields) {
        if (!field.appliesTo(layer) || !(field.id in extras)) continue;
        const value = extras[field.id];
        const same = field.equals ?? Object.is;
        if (same(value, field.read(layer))) continue;
        commands.push(field.command(project, mapId, layer.id, value));
    }
    return commands;
}

/** Every layer popover field of the app, in popover order. */
export const layerFields: readonly LayerField[] = collectLayerFields(
    import.meta.glob<LayerFieldModule>("../**/*.layerField.tsx", { eager: true }),
);
