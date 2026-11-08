import { Ellipsis, Plus } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useStore } from "zustand";
import { PROPERTIES_MENU } from "../../app/properties/properties.commands";
import {
    addProperty,
    addPropertyProblem,
    builtinFields,
    changePropertyType,
    removeProperty,
    renameProperty,
    setBuiltinField,
    setPropertyValue,
    setTileFocus,
    shownTarget,
    targetProperties,
    targetTitle,
    usePropertiesPanel,
} from "../../app/properties/propertiesPanel";
import type { BuiltinField } from "../../app/properties/propertiesPanel";
import { useSession } from "../../app/state/session";
import { tilesetPanelStore } from "../../app/tilesets/panel/tilesetPanel";
import { formatHex, parseHex } from "../../core/color";
import {
    MAX_FILE_PROPERTY_LENGTH,
    MAX_INT_PROPERTY,
    MAX_STRING_PROPERTY_LENGTH,
    MAX_TEXT_LENGTH,
} from "../../core/model";
import type { PropertyType } from "../../core/model";
import { PROPERTY_TYPES } from "../../core/properties";
import type { CommonProperty } from "../../core/properties";
import { cssColour } from "../colour/pickerMath";
import { ColourPicker } from "../colour/ColourPicker";
import { contextMenuEntries } from "../commands/contextMenu";
import { useCommands } from "../commands/useCommands";
import { Button, Icon, IconButton, NumberField, Popover, Select } from "../primitives";
import "./properties.css";

// The Properties dock section (SPEC §9, DESIGN §8.3; TE-040). The header names what is shown
// ("Marker · exit", "3 tiles", "Layer · Ground", "Map · Overworld") and holds the panel's menu
// (Show Project Properties, Show Tileset Properties, Show Selection Properties). The body has
// two parts: the built-in fields of the shown items, then Custom properties, rows of
// `name · type chip · value control` sorted by name, with Add (+) and a row menu (Rename,
// Change Type, Remove). With several items, a property common to all shows, editing it sets it
// on all, and a value that differs shows "—".
//
// A text field applies on Enter or when it loses the focus; Escape keeps the old value. A
// colour applies when its picker closes. Every edit goes through `app/properties`, one undo
// step each.

/** Decimals a float field keeps (the number field's `precision`). */
const FLOAT_DECIMALS = 9;

const TYPE_OPTIONS = PROPERTY_TYPES.map((type) => ({ value: type, label: type }));

/** What the panel shows and the project it is in, following every change. */
function useShown() {
    const session = useSession((state) => state.session);
    useSession((state) => state.revision);
    usePropertiesPanel((state) => state);
    useStore(tilesetPanelStore, (state) => state.selections);
    useStore(tilesetPanelStore, (state) => state.activeTilesetId);
    useStore(tilesetPanelStore, (state) => state.filter);
    return { project: session.project, target: shownTarget(session) };
}

/** The header's right side: what is shown, and the panel's menu. */
export function PropertiesHeader() {
    const { project, target } = useShown();
    const commands = useCommands();
    const entries = contextMenuEntries(PROPERTIES_MENU, commands);
    return (
        <span className="properties-header">
            <span className="properties-header__subject" data-properties-subject="">
                {target ? targetTitle(project, target) : ""}
            </span>
            <DropdownMenu.Root modal={false}>
                <DropdownMenu.Trigger asChild disabled={entries.length === 0}>
                    <IconButton label="Properties menu" data-properties-menu="">
                        <Icon icon={Ellipsis} />
                    </IconButton>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                    <DropdownMenu.Content
                        className="ui-menu"
                        align="end"
                        sideOffset={4}
                        collisionPadding={8}
                    >
                        {entries.map((entry) =>
                            entry.type === "separator" ? (
                                <DropdownMenu.Separator
                                    key={entry.id}
                                    className="ui-menu__separator"
                                />
                            ) : (
                                <DropdownMenu.Item
                                    key={entry.id}
                                    className="ui-menu__item"
                                    disabled={entry.disabled}
                                    onSelect={entry.onSelect}
                                    data-command={entry.id}
                                >
                                    {entry.label}
                                </DropdownMenu.Item>
                            ),
                        )}
                    </DropdownMenu.Content>
                </DropdownMenu.Portal>
            </DropdownMenu.Root>
        </span>
    );
}

/**
 * A text field that applies on Enter or blur and keeps the old value on Escape. `mixed` shows
 * "—" for values that differ; then any text typed applies, even the first item's.
 */
function TextValue({
    label,
    value,
    mixed = false,
    maxLength,
    hideLabel = true,
    onCommit,
    ...data
}: {
    label: string;
    value: string;
    mixed?: boolean;
    maxLength: number;
    hideLabel?: boolean;
    onCommit(value: string): void;
    [data: `data-${string}`]: string;
}) {
    const [draft, setDraft] = useState<string | null>(null);
    const id = useId();
    const shown = draft ?? (mixed ? "" : value);
    const commit = () => {
        if (draft === null) return;
        setDraft(null);
        if (draft === value && !mixed) return;
        onCommit(draft);
    };
    return (
        <>
            {hideLabel ? null : (
                <label className="ui-field__label" htmlFor={id}>
                    {label}
                </label>
            )}
            <input
                id={id}
                className="properties-panel__text"
                type="text"
                autoComplete="off"
                spellCheck={false}
                maxLength={maxLength}
                aria-label={hideLabel ? label : undefined}
                placeholder={mixed ? "—" : undefined}
                value={shown}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        commit();
                    } else if (event.key === "Escape" && draft !== null) {
                        event.preventDefault();
                        event.stopPropagation();
                        setDraft(null);
                    }
                }}
                {...data}
            />
        </>
    );
}

function BuiltinRow({ field }: { field: BuiltinField }) {
    if (field.kind === "readonly") {
        return (
            <>
                <span className="ui-field__label">{field.label}</span>
                <span className="properties-panel__readonly" data-builtin-field={field.key}>
                    {field.value}
                </span>
            </>
        );
    }
    if (field.kind === "number") {
        return (
            <>
                <span className="ui-field__label" aria-hidden="true">
                    {field.label}
                </span>
                <span data-builtin-field={field.key}>
                    <NumberField
                        label={field.label}
                        hideLabel
                        className="properties-panel__number"
                        value={field.value}
                        min={field.min}
                        max={field.max}
                        precision={field.integer ? 0 : 3}
                        onChange={(value) => setBuiltinField(field.key, value)}
                    />
                </span>
            </>
        );
    }
    return (
        <>
            <span className="ui-field__label" aria-hidden="true">
                {field.label}
            </span>
            <TextValue
                key={`${field.key}:${field.value}:${field.mixed}`}
                label={field.label}
                value={field.value}
                mixed={field.mixed}
                maxLength={MAX_TEXT_LENGTH}
                onCommit={(value) => setBuiltinField(field.key, value)}
                data-builtin-field={field.key}
            />
        </>
    );
}

/** The colour of a colour property: a swatch that opens the picker; applied when it closes. */
function ColourValue({ property }: { property: CommonProperty }) {
    const stored = parseHex(property.value as string) ?? 0x000000ff;
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<number | null>(null);
    const text = formatHex(stored, true).toLowerCase();
    return (
        <Popover
            label={`${property.name} colour`}
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                // Only an edit applies: with mixed values, even one that gives the first item's.
                if (!next && draft !== null && (property.mixed || draft !== stored)) {
                    setPropertyValue(property.name, "color", formatHex(draft, true).toLowerCase());
                }
                setDraft(null);
            }}
            className="properties-panel__picker"
            trigger={
                <button
                    type="button"
                    className="properties-panel__swatch"
                    aria-label={`${property.name}: ${property.mixed ? "mixed" : text}`}
                    data-property-value=""
                >
                    {property.mixed ? (
                        <span className="properties-panel__mixed">—</span>
                    ) : (
                        <>
                            <span className="properties-panel__swatch-colour">
                                <span style={{ background: cssColour(stored) }} />
                            </span>
                            <span>{text}</span>
                        </>
                    )}
                </button>
            }
        >
            <ColourPicker value={draft ?? stored} unset={property.mixed} onChange={setDraft} />
        </Popover>
    );
}

/** A file property: its name as text, and Pick, which takes the chosen file's name. */
function FileValue({ property }: { property: CommonProperty }) {
    const input = useRef<HTMLInputElement>(null);
    return (
        <span className="properties-panel__file">
            <TextValue
                key={`${String(property.value)}:${property.mixed}`}
                label={property.name}
                value={property.value as string}
                mixed={property.mixed}
                maxLength={MAX_FILE_PROPERTY_LENGTH}
                onCommit={(value) => setPropertyValue(property.name, "file", value)}
                data-property-value=""
            />
            <Button data-property-pick="" onClick={() => input.current?.click()}>
                Pick
            </Button>
            <input
                ref={input}
                type="file"
                hidden
                tabIndex={-1}
                data-property-file-input=""
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) setPropertyValue(property.name, "file", file.name);
                }}
            />
        </span>
    );
}

function ValueControl({ property }: { property: CommonProperty }) {
    const { name, type, value, mixed } = property;
    switch (type) {
        case "bool":
            return (
                <input
                    type="checkbox"
                    className="properties-panel__check"
                    aria-label={name}
                    checked={!mixed && value === true}
                    ref={(element) => {
                        if (element) element.indeterminate = mixed;
                    }}
                    onChange={(event) => setPropertyValue(name, "bool", event.target.checked)}
                    data-property-value=""
                />
            );
        case "int":
            return (
                <span data-property-value="">
                    <NumberField
                        label={name}
                        hideLabel
                        className="properties-panel__number"
                        value={value as number}
                        mixed={mixed}
                        min={-MAX_INT_PROPERTY}
                        max={MAX_INT_PROPERTY}
                        onChange={(next) => setPropertyValue(name, "int", next)}
                    />
                </span>
            );
        case "float":
            return (
                <span data-property-value="">
                    <NumberField
                        label={name}
                        hideLabel
                        className="properties-panel__number"
                        value={value as number}
                        mixed={mixed}
                        min={-Number.MAX_VALUE}
                        max={Number.MAX_VALUE}
                        precision={FLOAT_DECIMALS}
                        onChange={(next) => setPropertyValue(name, "float", next)}
                    />
                </span>
            );
        case "string":
            return (
                <TextValue
                    key={`${String(value)}:${mixed}`}
                    label={name}
                    value={value as string}
                    mixed={mixed}
                    maxLength={MAX_STRING_PROPERTY_LENGTH}
                    onCommit={(next) => setPropertyValue(name, "string", next)}
                    data-property-value=""
                />
            );
        case "color":
            return <ColourValue property={property} />;
        case "file":
            return <FileValue property={property} />;
    }
}

/** The row menu: Rename, Change Type ▸, Remove. */
function RowMenu({ property, onRename }: { property: CommonProperty; onRename(): void }) {
    return (
        <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger asChild>
                <IconButton label={`${property.name} menu`} data-property-menu="">
                    <Icon icon={Ellipsis} />
                </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
                <DropdownMenu.Content
                    className="ui-menu"
                    align="end"
                    sideOffset={4}
                    collisionPadding={8}
                >
                    <DropdownMenu.Item
                        className="ui-menu__item"
                        onSelect={onRename}
                        data-property-action="rename"
                    >
                        Rename
                    </DropdownMenu.Item>
                    <DropdownMenu.Sub>
                        <DropdownMenu.SubTrigger
                            className="ui-menu__item"
                            data-property-action="type"
                        >
                            Change Type
                        </DropdownMenu.SubTrigger>
                        <DropdownMenu.Portal>
                            <DropdownMenu.SubContent
                                className="ui-menu"
                                sideOffset={4}
                                collisionPadding={8}
                            >
                                <DropdownMenu.RadioGroup
                                    value={property.type}
                                    onValueChange={(type) =>
                                        changePropertyType(property.name, type as PropertyType)
                                    }
                                >
                                    {PROPERTY_TYPES.map((type) => (
                                        <DropdownMenu.RadioItem
                                            key={type}
                                            value={type}
                                            className="ui-menu__item"
                                            data-property-type={type}
                                        >
                                            {type}
                                        </DropdownMenu.RadioItem>
                                    ))}
                                </DropdownMenu.RadioGroup>
                            </DropdownMenu.SubContent>
                        </DropdownMenu.Portal>
                    </DropdownMenu.Sub>
                    <DropdownMenu.Separator className="ui-menu__separator" />
                    <DropdownMenu.Item
                        className="ui-menu__item"
                        onSelect={() => removeProperty(property.name)}
                        data-property-action="remove"
                    >
                        Remove
                    </DropdownMenu.Item>
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
}

/** The in-place rename of a row: Enter or leaving applies, Escape keeps the old name. */
function RenameField({ name, onEnd }: { name: string; onEnd(): void }) {
    const [text, setText] = useState(name);
    const done = useRef(false);
    const finish = (apply: boolean) => {
        if (done.current) return;
        done.current = true;
        // A blank name keeps the old one; a taken one is refused with a message.
        if (apply && text !== name && text.trim() !== "") renameProperty(name, text);
        onEnd();
    };
    return (
        <input
            className="properties-panel__text properties-panel__rename"
            type="text"
            aria-label={`Rename ${name}`}
            autoComplete="off"
            spellCheck={false}
            maxLength={MAX_TEXT_LENGTH}
            // The field appears where the name was, for typing at once.
            autoFocus
            value={text}
            data-property-rename=""
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setText(event.target.value)}
            onBlur={() => finish(true)}
            onKeyDown={(event: KeyboardEvent) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    finish(true);
                } else if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    finish(false);
                }
            }}
        />
    );
}

function PropertyRow({ property }: { property: CommonProperty }) {
    const [renaming, setRenaming] = useState(false);
    return (
        <li className="properties-panel__row" data-property={property.name}>
            {renaming ? (
                <RenameField name={property.name} onEnd={() => setRenaming(false)} />
            ) : (
                <span className="properties-panel__name" title={property.name}>
                    {property.name}
                </span>
            )}
            <span className="properties-panel__chip" data-property-type-chip="">
                {property.type}
            </span>
            <span className="properties-panel__value">
                <ValueControl property={property} />
            </span>
            <RowMenu property={property} onRename={() => setRenaming(true)} />
        </li>
    );
}

/** Add (+): a popover with Name, Type and Add. */
function AddProperty() {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const [type, setType] = useState<PropertyType>("string");
    const nameId = useId();
    const problemId = useId();
    const problem = name === "" ? null : addPropertyProblem(name);
    const add = () => {
        if (name.trim() === "" || problem) return;
        if (addProperty(name, type)) {
            setOpen(false);
            setName("");
        }
    };
    return (
        <Popover
            label="Add property"
            open={open}
            onOpenChange={setOpen}
            align="end"
            className="properties-panel__add"
            trigger={
                <IconButton label="Add property" data-property-add="">
                    <Icon icon={Plus} />
                </IconButton>
            }
        >
            <form
                className="properties-panel__add-form"
                onSubmit={(event) => {
                    event.preventDefault();
                    add();
                }}
            >
                <label className="ui-field__label" htmlFor={nameId}>
                    Name
                </label>
                <input
                    id={nameId}
                    className="properties-panel__text"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={MAX_TEXT_LENGTH}
                    aria-invalid={problem ? true : undefined}
                    aria-describedby={problem ? problemId : undefined}
                    value={name}
                    data-property-add-name=""
                    onChange={(event) => setName(event.target.value)}
                />
                <span className="ui-field__label">Type</span>
                <span data-property-add-type="">
                    <Select
                        label="Type"
                        hideLabel
                        value={type}
                        onChange={setType}
                        options={TYPE_OPTIONS}
                    />
                </span>
                {problem ? (
                    <span id={problemId} className="properties-panel__problem" role="alert">
                        {problem}
                    </span>
                ) : null}
                <div className="properties-panel__add-actions">
                    <Button
                        type="submit"
                        variant="primary"
                        disabled={name.trim() === "" || problem !== null}
                        data-property-add-confirm=""
                    >
                        Add
                    </Button>
                </div>
            </form>
        </Popover>
    );
}

function Section({
    title,
    extra,
    children,
}: {
    title: string;
    extra?: ReactNode;
    children: ReactNode;
}) {
    return (
        <div className="properties-panel__section">
            <div className="properties-panel__section-header">
                <span>{title}</span>
                {extra}
            </div>
            {children}
        </div>
    );
}

/** The body of the Properties section. */
export function PropertiesPanel() {
    const { project, target } = useShown();
    useTileFocusFromDock();
    if (!target) {
        return <p className="properties-panel__empty">Nothing is selected.</p>;
    }
    const fields = builtinFields(project, target);
    const properties = targetProperties(project, target);
    return (
        <div
            className="properties-panel"
            data-properties-panel=""
            data-properties-kind={target.kind}
        >
            <div className="properties-panel__fields">
                {fields.map((field) => (
                    <BuiltinRow key={field.key} field={field} />
                ))}
            </div>
            <Section
                title="Custom properties" // Another selection starts the popover afresh, closed.
                extra={<AddProperty key={JSON.stringify(target)} />}
            >
                {properties.length === 0 ? (
                    <p className="properties-panel__empty">No custom properties.</p>
                ) : (
                    <ul className="properties-panel__list" aria-label="Custom properties">
                        {properties.map((property) => (
                            <PropertyRow
                                key={`${property.name}:${property.type}`}
                                property={property}
                            />
                        ))}
                    </ul>
                )}
            </Section>
        </div>
    );
}

/** Takes the focus from the tiles when the focus enters the Maps or Layers section. */
function useTileFocusFromDock(): void {
    useEffect(() => {
        const onFocusIn = (event: FocusEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest('[data-dock-panel="layers"], [data-dock-panel="maps"]')) {
                setTileFocus(false);
            }
        };
        document.addEventListener("focusin", onFocusIn);
        return () => document.removeEventListener("focusin", onFocusIn);
    }, []);
}
