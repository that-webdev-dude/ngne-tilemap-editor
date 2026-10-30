import { useId, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { PREFERENCE_RANGES, preferences, usePreference } from "../../app/preferences/preferences";
import type { CheckerboardPreference, GridPreference } from "../../app/preferences/preferences";
import { surfaces } from "../../app/surfaces/surfaces";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";
import { NumberField } from "../primitives/NumberField";
import { SegmentedControl } from "../primitives/SegmentedControl";
import type { SegmentedControlProps, SegmentedOption } from "../primitives/SegmentedControl";
import { Toggle } from "../primitives/Toggle";
import { DEFAULT_THEME, setTheme, useTheme } from "../theme/theme";
import type { Theme } from "../theme/theme";
import { formatHexColour, parseHexColour } from "./hexColour";
import "../primitives/field.css";
import "./preferences.css";

type CheckerColours = Exclude<CheckerboardPreference["colors"], "theme">;

const THEMES: readonly SegmentedOption<Theme>[] = [
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
];
const COLOUR_SOURCES: readonly SegmentedOption<"theme" | "custom">[] = [
    { value: "theme", label: "Theme" },
    { value: "custom", label: "Custom" },
];

const close = () => surfaces.close("preferences");

/** A colour token of the current theme as 0xRRGGBB. */
function themeColour(name: string): number {
    const style = getComputedStyle(document.documentElement);
    return parseHexColour(style.getPropertyValue(name)) ?? 0;
}

/** The checkerboard of the current theme (DESIGN §3.1), read from its tokens. */
function themeCheckerColours(): CheckerColours {
    return { a: themeColour("--check-a"), b: themeColour("--check-b") };
}

/** The grid colour of the current theme (DESIGN §4): white in dark, black in light. */
function themeGridColour(theme: Theme): number {
    return theme === "dark" ? 0xffffff : 0x000000;
}

/** One preference: its name in the label column, its controls as a named group. */
function Section({ label, children }: { label: string; children: ReactNode }) {
    const labelId = useId();
    return (
        <>
            <span className="ui-field__label preferences__label" id={labelId}>
                {label}
            </span>
            <div className="preferences__group" role="group" aria-labelledby={labelId}>
                {children}
            </div>
        </>
    );
}

function Row({ children }: { children: ReactNode }) {
    return <div className="preferences__row">{children}</div>;
}

/** A segmented control with its name shown before it, as the fields show theirs. */
function LabelledSegments<Value extends string>(props: SegmentedControlProps<Value>) {
    return (
        <span className="ui-field">
            <span className="ui-field__label" aria-hidden="true">
                {props.label}
            </span>
            <SegmentedControl {...props} />
        </span>
    );
}

interface HexFieldProps {
    label: string;
    /** 0xRRGGBB. */
    value: number;
    onChange(value: number): void;
}

/**
 * A colour as hex text. Like the number field, what is typed applies on Enter or when the
 * field is left, and text that is not a colour is dropped.
 */
function HexField({ label, value, onChange }: HexFieldProps) {
    const inputId = useId();
    const [draft, setDraft] = useState<string | null>(null);
    const commit = () => {
        if (draft === null) return;
        const colour = parseHexColour(draft);
        setDraft(null);
        if (colour !== null && colour !== value) onChange(colour);
    };
    return (
        <span className="ui-field">
            <label className="ui-field__label" htmlFor={inputId}>
                {label}
            </label>
            <input
                id={inputId}
                className="preferences__hex"
                type="text"
                autoComplete="off"
                spellCheck={false}
                maxLength={7}
                value={draft ?? formatHexColour(value)}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key === "Enter") commit();
                    else if (event.key === "Escape") setDraft(null);
                }}
            />
        </span>
    );
}

function CheckerboardSection() {
    const checkerboard = usePreference("checkerboard");
    const { colors } = checkerboard;
    // The colours last chosen, so that Theme and back to Custom does not lose them.
    const lastCustom = useRef<CheckerColours | null>(null);
    const set = (patch: Partial<CheckerboardPreference>) =>
        preferences.set("checkerboard", { ...checkerboard, ...patch });
    const setSource = (source: "theme" | "custom") => {
        if (source === "theme") {
            if (colors !== "theme") lastCustom.current = colors;
            set({ colors: "theme" });
        } else if (colors === "theme") {
            set({ colors: lastCustom.current ?? themeCheckerColours() });
        }
    };
    // Custom colours replace the tokens for the preview; without them it shows the theme's.
    const preview =
        colors === "theme"
            ? undefined
            : ({
                  "--check-a": formatHexColour(colors.a),
                  "--check-b": formatHexColour(colors.b),
              } as CSSProperties);

    return (
        <Section label="Checkerboard">
            <Row>
                <LabelledSegments
                    label="Colours"
                    value={colors === "theme" ? "theme" : "custom"}
                    onChange={setSource}
                    options={COLOUR_SOURCES}
                />
                <NumberField
                    label="Size"
                    value={checkerboard.size}
                    onChange={(size) => set({ size })}
                    unit="px"
                    {...PREFERENCE_RANGES.checkerboardSize}
                />
                <span className="preferences__checker" style={preview} aria-hidden="true" />
            </Row>
            {colors === "theme" ? null : (
                <Row>
                    <HexField
                        label="Colour A"
                        value={colors.a}
                        onChange={(a) => set({ colors: { ...colors, a } })}
                    />
                    <HexField
                        label="Colour B"
                        value={colors.b}
                        onChange={(b) => set({ colors: { ...colors, b } })}
                    />
                </Row>
            )}
        </Section>
    );
}

function GridSection() {
    const theme = useTheme();
    const grid = usePreference("grid");
    const { colour } = grid;
    // The colour last chosen, so that Theme and back to Custom does not lose it.
    const lastCustom = useRef<number | null>(null);
    const set = (patch: Partial<GridPreference>) => preferences.set("grid", { ...grid, ...patch });
    const setSource = (source: "theme" | "custom") => {
        if (source === "theme") {
            if (colour !== "theme") lastCustom.current = colour;
            set({ colour: "theme" });
        } else if (colour === "theme") {
            set({ colour: lastCustom.current ?? themeGridColour(theme) });
        }
    };
    const shown = colour === "theme" ? themeGridColour(theme) : colour;
    const swatch: CSSProperties = {
        background: formatHexColour(shown),
        opacity: grid.opacity / 100,
    };

    return (
        <Section label="Grid">
            <Row>
                <LabelledSegments
                    label="Colour"
                    value={colour === "theme" ? "theme" : "custom"}
                    onChange={setSource}
                    options={COLOUR_SOURCES}
                />
                <NumberField
                    label="Opacity"
                    value={grid.opacity}
                    onChange={(opacity) => set({ opacity })}
                    unit="%"
                    {...PREFERENCE_RANGES.percent}
                />
                <span className="preferences__swatch" aria-hidden="true">
                    <span className="preferences__swatch-colour" style={swatch} />
                </span>
            </Row>
            {colour === "theme" ? null : (
                <Row>
                    <HexField
                        label="Grid colour"
                        value={colour}
                        onChange={(value) => set({ colour: value })}
                    />
                </Row>
            )}
        </Section>
    );
}

function HighlightSection() {
    const highlight = usePreference("highlight");
    return (
        <Section label="Highlight current layer">
            <Row>
                <NumberField
                    label="Other layers"
                    value={highlight.opacity}
                    onChange={(opacity) => preferences.set("highlight", { opacity })}
                    unit="%"
                    {...PREFERENCE_RANGES.percent}
                />
            </Row>
        </Section>
    );
}

function AutosaveSection() {
    const autosave = usePreference("autosave");
    return (
        <Section label="Autosave">
            <Row>
                <Toggle
                    label="Autosave"
                    showLabel
                    pressed={autosave.enabled}
                    onPressedChange={(enabled) => preferences.set("autosave", { enabled })}
                />
            </Row>
        </Section>
    );
}

/**
 * Preferences dialog (DESIGN §9, `se-design` §7): the theme and every value of the preference
 * store (theme, checkerboard, grid colour and opacity, highlight-layer opacity, autosave). A
 * change applies at once: it is written to its store, which tells its subscribers and persists
 * it. There is nothing to confirm, so the dialog has Close, and Restore defaults to go back.
 * The theme belongs to the theme store (ui/theme), the rest to the preference store. Every
 * on/off setting is a text toggle (`aria-pressed`), the one idiom of SUITE §4.
 */
export function PreferencesDialog() {
    const theme = useTheme();
    const restoreDefaults = () => {
        preferences.reset();
        setTheme(DEFAULT_THEME);
    };
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) close();
            }}
            title="Preferences"
            actions={
                <>
                    <Button onClick={restoreDefaults}>Restore defaults</Button>
                    <Button variant="primary" onClick={close}>
                        Close
                    </Button>
                </>
            }
        >
            <div className="preferences">
                <Section label="Theme">
                    <Row>
                        <SegmentedControl
                            label="Theme"
                            value={theme}
                            onChange={setTheme}
                            options={THEMES}
                        />
                    </Row>
                </Section>
                <CheckerboardSection />
                <GridSection />
                <HighlightSection />
                <AutosaveSection />
            </div>
        </Dialog>
    );
}
