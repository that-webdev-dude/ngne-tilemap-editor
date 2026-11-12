import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type * as ChordModule from "../../src/app/commands/chord";
import type * as ToolRegistryModule from "../../src/app/tools/toolRegistry";
import { boxOf, collectErrors, region } from "./te-003-support";
import {
    eachShellState,
    layoutProblems,
    loadAudit,
    pageCall,
    smallTargets,
    showEveryToast,
    NOTIFICATIONS,
    startEditor,
    visitAllSurfaces,
    WINDOWS,
} from "./te-065-support";

// TE-065: pointer targets, names and tooltips, and the layout (DESIGN §1 → `se-design` §2,
// §4, §8; DESIGN §10.4; SPEC §15). In the shell — empty, with the "Audit" project, every dock
// section expanded, both bottom panel tabs, the context bar of every tool of both tool sets —
// and in every dialog and surface a command or a situation opens (`visitAllSurfaces`):
//
// - every pointer target is at least 24 × 24 px but the exceptions of DESIGN §10.4;
// - every icon-only control has an `aria-label`, and its tooltip shows that name and, for a
//   command with a key, the key;
// - at 1280 × 720 and at 125% browser zoom of 1920 × 1080 (1536 × 864 CSS px), no interactive
//   control is clipped or overlaps another (`layoutProblems`), and every surface lies inside
//   the window.

test("pointer targets are at least 24 × 24 px in the shell and in every surface, but the exceptions of DESIGN §10.4", async ({
    page,
}) => {
    test.setTimeout(10 * 60_000);
    const errors = collectErrors(page);
    await startEditor(page);
    const problems: string[] = [];
    const add = (name: string, found: string[]): void => {
        problems.push(...found.map((problem) => `${name}: ${problem}`));
    };
    add("empty state", await smallTargets(page));
    await eachShellState(page, async (name) => add(name, await smallTargets(page)));
    const missing = await visitAllSurfaces(page, async ({ source, name, selector }) =>
        add(`${source}: ${name}`, await smallTargets(page, selector)),
    );
    expect(missing, "registered dialogs and app surfaces not visited").toEqual([]);
    expect(problems).toEqual([]);
    expect(errors).toEqual([]);
});

test("the check finds a small target, and skips only the exceptions of DESIGN §10.4", async ({
    page,
}) => {
    await startEditor(page);
    await loadAudit(page);
    // The terrain brush's swatches are listed (they are 24 px high in the context bar), and the
    // splitters, 8 px wide, skipped.
    expect(await pageCall<boolean>(page, "selectTool", "terrain")).toBe(true);
    await expect(
        region(page, "context-bar").locator("[data-terrain-swatch]").first(),
    ).toBeVisible();
    const splitter = page.getByRole("separator", { name: "Resize panels" });
    expect((await boxOf(splitter)).width).toBeLessThan(24);
    expect(await smallTargets(page)).toEqual([]);
    // A button of 20 × 20 px in the dock is found; the same size inside the tile grid is not.
    await page.evaluate(() => {
        const add = (parent: Element, name: string) => {
            const button = document.createElement("button");
            button.setAttribute("aria-label", name);
            button.style.cssText = "width: 20px; height: 20px; padding: 0";
            parent.append(button);
        };
        add(document.querySelector('[data-region="dock"]')!, "Probe in the dock");
        add(document.querySelector("[data-tile-grid]")!, "Probe in the tile grid");
    });
    expect(await smallTargets(page)).toEqual(['button "Probe in the dock": 20.0 × 20.0']);
});

/**
 * The icon-only buttons inside `selector` (buttons that show no text of their own) without a
 * name, and those whose tooltip, on hover, does not show their name, or the key of the command
 * of that title when it has one. A cell of a choice that shows a place or a colour rather than
 * an icon (a radio without an icon) needs its name only (`se-design` §8).
 */
async function iconButtonProblems(
    page: Page,
    selector: string,
    rest: { x: number; y: number },
    close: "escape" | "pointer",
): Promise<{ count: number; problems: string[] }> {
    // The key of each command, by its title, and of each tool of the rail, by its label: a
    // button of the tool rail and the stamp preview ("…: select Stamp Brush") show the tool's
    // key. Other buttons named as a tool (the collision editor's own tool strip, which has no
    // keys) are not the rail's tools.
    const keys = await page.evaluate(async () => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const { formatChord } = (await load("/src/app/commands/chord.ts")) as typeof ChordModule;
        const { toolRegistry } = (await load(
            "/src/app/tools/toolRegistry.ts",
        )) as typeof ToolRegistryModule;
        const commands: Record<string, string> = {};
        for (const command of window.__ngneTest!.commands.list()) {
            const chord = command.shortcuts[0];
            if (chord) commands[command.title().replace(/…$/, "")] = formatChord(chord);
        }
        const tools: Record<string, string> = {};
        for (const tool of toolRegistry.list()) {
            if (tool.shortcut) tools[tool.label] = tool.shortcut;
        }
        return { commands, tools };
    });
    const keyOf = (name: string, tool: boolean) =>
        tool
            ? (keys.tools[name] ?? keys.tools[/: select (.+)$/.exec(name)?.[1] ?? ""])
            : keys.commands[name.replace(/…$/, "")];
    expect(Object.keys(keys.tools).length, "tool keys known").toBeGreaterThan(10);
    const iconOnly = await page.locator(selector).evaluate((root) => {
        for (const element of document.querySelectorAll("[data-te065-icon-button]")) {
            element.removeAttribute("data-te065-icon-button");
        }
        const found: { index: string; cell: boolean; tool: boolean }[] = [];
        root.querySelectorAll<HTMLElement>("button").forEach((button, index) => {
            // Text shown only on hover or focus (a layer row's opacity) is text all the same.
            if (!button.checkVisibility() || (button.textContent ?? "").trim() !== "") return;
            // Pointer-only controls hidden from assistive technology (the tab's close
            // control, `se-design` §8) are not icon-only controls of their own.
            if (button.closest('[aria-hidden="true"]')) return;
            const cell = button.getAttribute("role") === "radio" && !button.querySelector("svg");
            button.setAttribute("data-te065-icon-button", `${index}`);
            const tool =
                button.hasAttribute("data-tool") || button.hasAttribute("data-stamp-preview");
            found.push({ index: `${index}`, cell, tool });
        });
        return found;
    });
    const problems: string[] = [];
    for (const { index, cell, tool } of iconOnly) {
        const button = page.locator(`[data-te065-icon-button="${index}"]`);
        const name = ((await button.getAttribute("aria-label")) ?? "").trim();
        if (name === "") {
            problems.push(
                `no name: ${await button.evaluate((element) => element.outerHTML.slice(0, 120))}`,
            );
            continue;
        }
        if (cell) continue;
        // A disabled button takes no pointer; it is a tooltip's trigger all the same (Radix
        // marks its trigger with `data-state`).
        if (await button.isDisabled()) {
            if ((await button.getAttribute("data-state")) === null) {
                problems.push(`no tooltip: ${name}`);
            }
            continue;
        }
        if (close === "pointer") {
            await page.locator(selector).evaluate((element) => {
                if (!element.hasAttribute("tabindex")) element.setAttribute("tabindex", "-1");
                (element as HTMLElement).focus();
            });
            await expect(page.getByRole("tooltip")).toHaveCount(0);
        }
        await button.hover();
        const tooltip = page.getByRole("tooltip").filter({ hasText: name }).first();
        const shown = await tooltip
            .waitFor({ state: "visible", timeout: 3000 })
            .then(() => true)
            .catch(() => false);
        if (!shown) problems.push(`no tooltip: ${name}`);
        else {
            const key = keyOf(name, tool);
            if (key && !((await tooltip.textContent()) ?? "").includes(key)) {
                problems.push(`tooltip without its key ${key}: ${name}`);
            }
        }
        if (close === "escape") await page.keyboard.press("Escape");
        await page.mouse.move(rest.x, rest.y);
        await page.mouse.move(rest.x + 1, rest.y);
        await expect(page.getByRole("tooltip").filter({ hasText: name })).toHaveCount(0);
    }
    return { count: iconOnly.length, problems };
}

test("every icon-only control of the shell has an aria-label and a tooltip with its name and key", async ({
    page,
}) => {
    test.setTimeout(10 * 60_000);
    const errors = collectErrors(page);
    await startEditor(page);
    const problems: string[] = [];
    let total = 0;
    const counted: string[] = [];
    await eachShellState(page, async (name) => {
        // Only the context bar changes from one tool to the next.
        const scope = name.includes(", tool ") ? '[data-region="context-bar"]' : "body";
        const workspace = await region(page, "status-bar").boundingBox();
        const rest = { x: workspace!.x + 40, y: workspace!.y + workspace!.height / 2 };
        const found = await iconButtonProblems(page, scope, rest, "escape");
        total += found.count;
        counted.push(`${name}: ${found.count}`);
        problems.push(...found.problems.map((problem) => `${name}: ${problem}`));
    });
    test.info().annotations.push({ type: "icon buttons", description: counted.join("; ") });
    expect(total).toBeGreaterThan(20);
    expect(problems).toEqual([]);
    expect(errors).toEqual([]);
});

test("every icon-only control of every surface has an aria-label and a tooltip with its name and key", async ({
    page,
}) => {
    test.setTimeout(10 * 60_000);
    const errors = collectErrors(page);
    await startEditor(page);
    const problems: string[] = [];
    let total = 0;
    const missing = await visitAllSurfaces(page, async ({ source, name, selector }) => {
        // At rest: the window's bottom-left corner, on a modal dialog's overlay or the status
        // bar, where no trigger is and no surface lies.
        const rest = { x: 2, y: page.viewportSize()!.height - 2 };
        const found = await iconButtonProblems(page, selector, rest, "pointer");
        total += found.count;
        problems.push(...found.problems.map((problem) => `${source}: ${name}: ${problem}`));
    });
    expect(missing, "registered dialogs and app surfaces not visited").toEqual([]);
    expect(total, "icon-only buttons in the surfaces").toBeGreaterThan(5);
    expect(problems).toEqual([]);
    expect(errors).toEqual([]);
});

for (const size of WINDOWS) {
    test(`no clipped or overlapping control in the shell or any surface at ${size.name}`, async ({
        page,
    }) => {
        test.setTimeout(10 * 60_000);
        const errors = collectErrors(page);
        await startEditor(page, { size });
        expect(await page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([
            size.width,
            size.height,
        ]);
        const problems: string[] = [];
        const add = (name: string, found: string[]): void => {
            problems.push(...found.map((problem) => `${name}: ${problem}`));
        };
        add("empty state", await layoutProblems(page));
        await eachShellState(page, async (name) => add(name, await layoutProblems(page)));
        const windowBox = { x: 0, y: 0, width: size.width, height: size.height };
        const missing = await visitAllSurfaces(
            page,
            async ({ source, name, selector, surface }) => {
                const box = await boxOf(surface);
                const inside =
                    box.x >= -0.5 &&
                    box.y >= -0.5 &&
                    box.x + box.width <= windowBox.width + 0.5 &&
                    box.y + box.height <= windowBox.height + 0.5;
                if (!inside) problems.push(`${source}: ${name}: outside the window`);
                add(`${source}: ${name}`, await layoutProblems(page, selector));
            },
        );
        expect(missing, "registered dialogs and app surfaces not visited").toEqual([]);

        // A toast of each kind, the one with an action among them: inside the window, no
        // clipped control, no message cut off.
        await showEveryToast(page);
        const toasts = page.locator(NOTIFICATIONS);
        const box = await boxOf(toasts);
        expect(
            box.x >= 0 &&
                box.y >= 0 &&
                box.x + box.width <= size.width &&
                box.y + box.height <= size.height,
            "toasts inside the window",
        ).toBe(true);
        add("toasts", await layoutProblems(page, NOTIFICATIONS));
        expect(
            await toasts.evaluate((region) =>
                [...region.querySelectorAll<HTMLElement>(".ui-toast__message")]
                    .filter((message) => message.scrollWidth > message.clientWidth + 0.5)
                    .map((message) => message.textContent ?? ""),
            ),
            "toast messages cut off",
        ).toEqual([]);
        expect(problems).toEqual([]);
        expect(errors).toEqual([]);
    });
}

test("the layout check sees an overlap, a control cut off by its panel and one cut off by the page, and keeps its exemptions narrow", async ({
    page,
}) => {
    await startEditor(page);
    expect(await layoutProblems(page)).toEqual([]);
    await page.evaluate(() => {
        const root = document.createElement("div");
        root.id = "te065-probe";
        // Each group lies above the app (z-index), so that hit-testing finds the probes.
        const group = (left: number, top: number, html: string, style = "") =>
            `<div style="position:fixed;z-index:1000;left:${left}px;top:${top}px;width:200px;height:60px;${style}">${html}</div>`;
        const at = (left: number, top = 0, more = "") =>
            `position:absolute;left:${left}px;top:${top}px;${more}`;
        const button = (name: string, left: number, top = 0, more = "") =>
            `<button style="${at(left, top, `width:60px;height:24px;${more}`)}">${name}</button>`;
        const splitter = (name: string, left: number, top = 0, more = "") =>
            `<div role="separator" aria-label="${name}" style="${at(left, top, `width:8px;height:24px;${more}`)}"></div>`;
        root.innerHTML = [
            // A and B overlap; C shares a 1 px hairline with B, which is no overlap.
            group(
                300,
                200,
                button("A", 0) + button("B", 40, 10) + button("C", 31, 33),
                "height:100px",
            ),
            // D is cut off by a panel that clips and cannot scroll.
            group(600, 200, button("D", 70), "width:100px;height:40px;overflow:hidden"),
            // E is cut off by the page.
            `<button style="position:fixed;z-index:1000;left:-20px;top:300px;width:60px;height:24px">E</button>`,
            // A splitter on top of a button takes its presses: an overlap.
            group(300, 340, button("F", 0) + splitter("S1", 50, 0, "z-index:1")),
            // A button on top of a splitter takes every press there: none.
            group(300, 380, button("G", 0, 0, "z-index:2") + splitter("S2", 50, 0, "z-index:1")),
            // A splitter over a region that is no control (as over the viewport): none.
            group(
                300,
                460,
                `<div tabindex="0" style="${at(0, 0, "width:60px;height:24px")}"></div>` +
                    splitter("S4", 50, 0, "z-index:1"),
            ),
            // Two splitters that cross: an overlap.
            group(
                300,
                500,
                splitter("S5", 8) + splitter("S6", 0, 8, "width:24px;height:8px;z-index:1"),
            ),
            // Two buttons side by side sharing a 1 px border: none.
            group(300, 540, button("M1", 0) + button("M2", 59)),
            // A button scrolled out of a scrolling panel's view: scrolling shows it, none.
            group(
                600,
                340,
                `<div style="height:200px"></div>${button("K", 0, 0, "position:static")}`,
                "width:100px;height:40px;overflow:auto",
            ),
            // Out of a clipping panel's view, a button lying over another panel is no overlap.
            group(
                600,
                420,
                `<div style="height:40px;overflow:auto"><div style="height:60px"></div>${button("N", 0, 0, "position:static")}</div>`,
                "width:100px;height:100px",
            ),
        ].join("");
        document.body.append(root);
    });
    expect(await layoutProblems(page, "#te065-probe")).toEqual([
        'overlap: button "A" and button "B" share 20.0 × 14.0 px',
        'overlap: button "F" and separator "S1" share 8.0 × 24.0 px',
        'overlap: separator "S5" and separator "S6" share 8.0 × 8.0 px',
        'clipped: button "D" by div',
        'clipped: button "E" by body',
    ]);
});

test("the bottom panel's splitter takes the presses 4 px above its border under the dock too, and the dock's rows those past the dock's splitter", async ({
    page,
}) => {
    await startEditor(page);
    await loadAudit(page);
    const owners = await page.evaluate(() => {
        const bottom = document.querySelector('[aria-label="Resize bottom panel"]')!;
        const side = document.querySelector('[aria-label="Resize panels"]')!;
        const dock = document.querySelector('[data-region="dock"]')!.getBoundingClientRect();
        const border = document.querySelector(".shell-panel")!.getBoundingClientRect().top;
        const row = document.querySelector('[data-region="dock"] [role="option"]')!;
        const rowBox = row.getBoundingClientRect();
        const at = (x: number, y: number) => document.elementFromPoint(x, y);
        return {
            underDock: [1, 2, 3, 4].map(
                (dy) => at(dock.left + dock.width / 2, border - dy) === bottom,
            ),
            underViewport: [1, 2, 3, 4].map((dy) => at(dock.left - 200, border - dy) === bottom),
            rowEdge: row.contains(at(rowBox.left + 1, rowBox.top + rowBox.height / 2)),
            besideDock: at(dock.left - 3, rowBox.top + rowBox.height / 2) === side,
        };
    });
    expect(owners).toEqual({
        underDock: [true, true, true, true],
        underViewport: [true, true, true, true],
        rowEdge: true,
        besideDock: true,
    });
});
