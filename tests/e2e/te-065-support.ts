import { AxeBuilder } from "@axe-core/playwright";
import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type * as DialogRequestsModule from "../../src/app/dialogs/dialogRequests";
import type * as StorageModule from "../../src/app/platform/storage";
import type * as SurfacesModule from "../../src/app/surfaces/surfaces";
import type * as DialogRegistryModule from "../../src/ui/dialogs/registry";
import type * as ToastModule from "../../src/ui/toast/toast";
import { openEmptyApp } from "./support/wait";
import { region, THEME_KEY } from "./te-003-support";
import { rename, settleTimers } from "./te-007-support";
import { arrangePickers, stubPickers } from "./te-047-support";
import { acceptUnload, recoveryOffered, waitForSnapshot } from "./te-048-support";

// Shared helpers of the TE-065 audit, adapted from the sprite editor's se-071-support.ts.
// What is visited comes from the registries at run time, not from a list written here: the
// dialogs of `ui/dialogs/registry.ts` and the app's surfaces (`app/surfaces/surfaces.ts`),
// reached by every command whose title ends in "…" and by the situations that ask the other
// dialogs; the menus of `MENU_BAR`; the dock panels; the tools of the tool registry.

export const THEMES = ["dark", "light"] as const;
export type Theme = (typeof THEMES)[number];

/**
 * The window sizes of SPEC §15 and `se-design` §8: the minimum window, and 1920 × 1080 at 125%
 * browser zoom, which lays the page out in 1536 × 864 CSS pixels.
 */
export const WINDOWS = [
    { name: "1280×720", width: 1280, height: 720 },
    { name: "1536×864 (125% of 1920×1080)", width: 1536, height: 864 },
] as const;

/** Top-level surfaces: dialogs, popovers (Radix gives them `dialog`), menus, select lists. */
export const SURFACE_SELECTOR =
    '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

const PAGE_MODULE = "/tests/e2e/harness/te-065-page.ts";

/** Calls an export of the page module with JSON arguments; resolves with its JSON result. */
export function pageCall<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

/** The layer ids of the page module's "Audit" (it cannot be imported here: it loads the app). */
export const LAYERS = { ground: 1, paths: 3, areas: 4, sky: 5, props: 6, detail: 7 } as const;

declare global {
    interface Window {
        __te065?: { settled: boolean; failures: string[] };
    }
}

type ChooserFile = { name: string; mimeType: string; buffer: Buffer };
/** The files the next file chooser of a page is answered with, whatever it accepts. */
const nextChooserFiles = new WeakMap<Page, ChooserFile[]>();

/** File choosers shown on each page (`startEditor` answers them). */
const fileChoosers = new WeakMap<Page, number>();

/** How many pickers the page has shown: file choosers and the stubbed pickers. */
export async function pickersShown(page: Page): Promise<number> {
    const stubs = await page.evaluate(
        () => (window as { __te065Pickers?: number }).__te065Pickers ?? 0,
    );
    return stubs + (fileChoosers.get(page) ?? 0);
}

/** Answers the next file chooser with `files` (once). */
export function answerNextChooser(page: Page, files: ChooserFile[]): void {
    nextChooserFiles.set(page, files);
}

/** Writes `files` (path → bytes) into the OPFS folder `folder`, folders made as paths say. */
export function writeFolder(
    page: Page,
    folder: string,
    files: { path: string; bytes: number[] }[],
): Promise<void> {
    return page.evaluate(
        async ({ folder, files }) => {
            const root = await navigator.storage.getDirectory();
            const top = await root.getDirectoryHandle(folder, { create: true });
            for (const file of files) {
                const parts = file.path.split("/");
                let dir = top;
                for (const part of parts.slice(0, -1)) {
                    dir = await dir.getDirectoryHandle(part, { create: true });
                }
                const handle = await dir.getFileHandle(parts.at(-1)!, { create: true });
                const writable = await handle.createWritable();
                await writable.write(new Uint8Array(file.bytes));
                await writable.close();
            }
        },
        { folder, files },
    );
}

/** Makes the next folder picker return the OPFS folder `name`. */
export function nextFolder(page: Page, name: string): Promise<void> {
    return page.evaluate((name) => {
        (window as { __te065Folder?: string | null }).__te065Folder = name;
    }, name);
}

/** A 64 × 64 PNG, answered to every file chooser that takes images. */
let sourcePng: { name: string; mimeType: string; buffer: Buffer } | null = null;
async function grid(): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
    if (!sourcePng) {
        const { gridPng } = await import("./te-024-support");
        sourcePng = gridPng("grid.png", 64, 64);
    }
    return sourcePng;
}

/**
 * Opens the editor in `theme` at `size` on its empty state, with transitions off (colours
 * final when read), the File System Access pickers stubbed over OPFS (they cancel unless told
 * otherwise) and every file chooser answered: a PNG where it takes images, cancelled otherwise.
 */
export async function startEditor(
    page: Page,
    {
        theme = "dark",
        size = WINDOWS[0],
    }: { theme?: Theme; size?: { width: number; height: number } } = {},
): Promise<void> {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.addInitScript(({ key, theme }) => localStorage.setItem(key, theme), {
        key: THEME_KEY,
        theme,
    });
    await stubPickers(page);
    // The folder picker returns the OPFS folder `window.__te065Folder` names, once; cancelled
    // while none is named.
    await page.addInitScript(() => {
        Object.assign(window, {
            async showDirectoryPicker() {
                (window as { __te065Pickers?: number }).__te065Pickers =
                    ((window as { __te065Pickers?: number }).__te065Pickers ?? 0) + 1;
                const name = (window as { __te065Folder?: string | null }).__te065Folder;
                (window as { __te065Folder?: string | null }).__te065Folder = null;
                if (!name) throw new DOMException("The user aborted a request.", "AbortError");
                const root = await navigator.storage.getDirectory();
                return root.getDirectoryHandle(name, { create: true });
            },
        });
    });
    // The open and save pickers of `stubPickers`, counted (`pickersShown`).
    await page.addInitScript(() => {
        const counted = window as unknown as Record<string, unknown> & { __te065Pickers?: number };
        for (const name of ["showOpenFilePicker", "showSaveFilePicker"]) {
            const picker = counted[name] as ((...args: unknown[]) => unknown) | undefined;
            if (!picker) continue;
            counted[name] = (...args: unknown[]) => {
                counted.__te065Pickers = (counted.__te065Pickers ?? 0) + 1;
                return picker(...args);
            };
        }
    });
    const png = await grid();
    fileChoosers.set(page, 0);
    page.on("filechooser", (chooser) => {
        fileChoosers.set(page, (fileChoosers.get(page) ?? 0) + 1);
        void (async () => {
            const accept = (await chooser.element().getAttribute("accept")) ?? "";
            const next = nextChooserFiles.get(page);
            nextChooserFiles.delete(page);
            if (next) {
                await chooser.setFiles(next);
            } else if (/png|image/.test(accept)) {
                await chooser.setFiles([png]);
            } else {
                await chooser
                    .element()
                    .evaluate((input) =>
                        input.dispatchEvent(new Event("cancel", { bubbles: true })),
                    );
            }
        })().catch(() => undefined);
    });
    acceptUnload(page);
    await openEmptyApp(page);
    await page.waitForFunction(() => window.__ngneTest !== undefined);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

/**
 * Loads the page module's "Audit" project with both maps open as tabs, Overworld active, and
 * makes it dirty with one history step.
 */
export async function loadAudit(page: Page, active: number = LAYERS.ground): Promise<void> {
    await pageCall(page, "load", active);
    await pageCall(page, "openBothTabs");
    await expect(region(page, "viewport")).toBeVisible();
    await rename(page, "Audit", "Rename Project");
    await expect(region(page, "menu-bar").locator('[role="tab"]')).toHaveCount(2);
}

/** Expands every collapsed dock section. */
export async function expandDock(page: Page): Promise<void> {
    const toggles = page.locator('.dock-section__toggle[aria-expanded="false"]');
    while ((await toggles.count()) > 0) await toggles.first().click();
}

/** Runs a command as a menu does, without waiting for it; its failures are recorded. */
export async function runCommand(page: Page, id: string): Promise<void> {
    await page.evaluate((id) => {
        const record = (window.__te065 ??= { settled: true, failures: [] });
        const command = window.__ngneTest!.commands.get(id);
        if (!command) throw new Error(`No command ${id}`);
        record.settled = false;
        const fail = (error: unknown) => {
            record.failures.push(
                `${id}: ${error instanceof Error ? error.message : String(error)}`,
            );
            record.settled = true;
        };
        try {
            const result = command.run();
            if (result instanceof Promise) result.then(() => (record.settled = true), fail);
            else record.settled = true;
        } catch (error) {
            fail(error);
        }
    }, id);
}

/**
 * Makes the next run of a command, however it is started (a key, a menu, the palette), report
 * when it settles, as `runCommand` does, so that `surfaceOpened` waits for it.
 */
export async function armCommand(page: Page, id: string): Promise<void> {
    await page.evaluate((id) => {
        const record = (window.__te065 ??= { settled: true, failures: [] });
        const command = window.__ngneTest!.commands.get(id);
        if (!command) throw new Error(`No command ${id}`);
        const run = command.run;
        record.settled = false;
        const armed = command as { run: () => void | Promise<void> };
        armed.run = () => {
            armed.run = run;
            const finish = () => (record.settled = true);
            try {
                const result = run();
                if (result instanceof Promise) {
                    result.then(finish, (error: unknown) => {
                        record.failures.push(`${id}: ${String(error)}`);
                        finish();
                    });
                } else finish();
                return result;
            } catch (error) {
                record.failures.push(`${id}: ${String(error)}`);
                finish();
                throw error;
            }
        };
    }, id);
}

export function commandSettled(page: Page): Promise<boolean> {
    return page.evaluate(() => window.__te065?.settled ?? true);
}

export function commandFailures(page: Page): Promise<string[]> {
    return page.evaluate(() => [...(window.__te065?.failures ?? [])]);
}

/**
 * The commands of the registry that ask for more (a title ending in "…"), by id; planned
 * commands are left out. Every one must be enabled where the audit runs them (the "Audit"
 * project, tile 0 selected): one that is not fails, so no surface goes unaudited.
 */
export async function askingCommands(page: Page): Promise<string[]> {
    const commands = await page.evaluate(() =>
        window
            .__ngneTest!.commands.list()
            .filter((command) => !command.planned && command.title().endsWith("…"))
            .map((command) => ({ id: command.id, enabled: command.enabled() })),
    );
    expect(
        commands.filter((command) => !command.enabled).map((command) => command.id),
        "commands that ask for more but are disabled where the audit runs them",
    ).toEqual([]);
    return commands.map((command) => command.id);
}

/**
 * Marks the open top-level surfaces (`data-te065-surface`, in document order: the last is on
 * top) and returns how many there are. A surface inside another is part of it.
 */
export function markSurfaces(page: Page): Promise<number> {
    return page.evaluate((selector) => {
        for (const element of document.querySelectorAll("[data-te065-surface]")) {
            element.removeAttribute("data-te065-surface");
        }
        // A list of the shell (the Maps list, a panel's grid) is part of its region, not a
        // surface: surfaces are portalled out of the regions.
        const open = [...document.querySelectorAll<HTMLElement>(selector)].filter(
            (element) =>
                element.checkVisibility() &&
                !element.parentElement?.closest(selector) &&
                !element.closest("[data-region]"),
        );
        open.forEach((element, index) => element.setAttribute("data-te065-surface", `${index}`));
        return open.length;
    }, SURFACE_SELECTOR);
}

/** The surface on top, marked by `markSurfaces`; null while none is open. */
export async function topSurface(page: Page): Promise<{ selector: string; name: string } | null> {
    const count = await markSurfaces(page);
    if (count === 0) return null;
    const selector = `[data-te065-surface="${count - 1}"]`;
    const name = await page.locator(selector).evaluate((element) => {
        const label = element.getAttribute("aria-label");
        if (label) return label;
        const ids = element.getAttribute("aria-labelledby") ?? "";
        const named = ids
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? "")
            .join(" ")
            .trim();
        return named || element.getAttribute("role") || "";
    });
    return { selector, name };
}

/**
 * Lets an opened surface settle: Radix moves the focus into it one timer after it opens, and
 * places a popover once it has measured it, a frame after its first render.
 */
async function settled(page: Page): Promise<void> {
    await settleTimers(page);
    await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await settleTimers(page);
}

/** Waits until a surface is open, or the command run last has settled and none opened. */
export async function surfaceOpened(page: Page, ms = 10_000): Promise<boolean> {
    const deadline = Date.now() + ms;
    for (;;) {
        if ((await markSurfaces(page)) > 0) {
            await settled(page);
            return true;
        }
        if (await commandSettled(page)) {
            await page.evaluate(
                () =>
                    new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 50))),
            );
            if ((await markSurfaces(page)) > 0) {
                await settled(page);
                return true;
            }
            return false;
        }
        if (Date.now() > deadline) return false;
        await page.waitForTimeout(50);
    }
}

/** The dialog request kind or app surface open now, or null. */
export function openKind(page: Page): Promise<string | null> {
    return page.evaluate(async () => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const { commandDialogs } = (await load(
            "/src/app/dialogs/dialogRequests.ts",
        )) as typeof DialogRequestsModule;
        const { surfaces } = (await load("/src/app/surfaces/surfaces.ts")) as typeof SurfacesModule;
        return commandDialogs.store.getState().request?.kind ?? surfaces.store.getState().open;
    });
}

/** Every dialog kind of the dialog registry and every surface id of the app. */
export function registeredSurfaceKinds(page: Page): Promise<string[]> {
    return page.evaluate(async () => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const { registeredDialogs } = (await load(
            "/src/ui/dialogs/registry.ts",
        )) as typeof DialogRegistryModule;
        const { SURFACE_IDS } = (await load(
            "/src/app/surfaces/surfaces.ts",
        )) as typeof SurfacesModule;
        return [...registeredDialogs.keys(), ...SURFACE_IDS].sort();
    });
}

/** Whether the focus is inside `selector`. */
export function focusInside(page: Page, selector: string): Promise<boolean> {
    return page
        .locator(selector)
        .evaluate((element) => element.contains(document.activeElement))
        .catch(() => false);
}

/**
 * Closes the surface on top with Escape, once it holds the focus, and waits until it is gone.
 * A tooltip open over it is the top layer: the first Escape closes the tooltip (Radix).
 */
export async function escapeTop(page: Page): Promise<void> {
    const top = await topSurface(page);
    if (!top) return;
    const surface = page.locator(top.selector);
    await expect
        .poll(() => focusInside(page, top.selector), `${top.name} has the focus`)
        .toBe(true);
    if ((await page.getByRole("tooltip").count()) > 0) {
        await page.keyboard.press("Escape");
        await expect(page.getByRole("tooltip")).toHaveCount(0);
        await settleTimers(page);
    }
    if ((await surface.count()) > 0 && (await surface.isVisible())) {
        await page.keyboard.press("Escape");
        await expect(surface, `${top.name} closes on Escape`).toBeHidden();
    }
    await settleTimers(page);
}

/** Closes every open surface with Escape. */
export async function closeAll(page: Page): Promise<void> {
    for (let attempt = 0; attempt < 6 && (await markSurfaces(page)) > 0; attempt++) {
        await escapeTop(page);
    }
    expect(await markSurfaces(page), "every surface closed").toBe(0);
}

/** What a surface's visit gets. */
export interface SurfaceVisit {
    /** What opened it: a command id, or the situation of a dialog no command asks for. */
    source: string;
    /** The dialog request kind or app surface id behind it; null for a popover. */
    kind: string | null;
    name: string;
    /** A CSS selector of the surface element. */
    selector: string;
    surface: Locator;
}
export type Visit = (visit: SurfaceVisit) => Promise<void>;

async function visitTop(page: Page, source: string, visit: Visit, kinds: Set<string>) {
    const top = await topSurface(page);
    if (!top) throw new Error(`${source}: no surface is open`);
    const kind = await openKind(page);
    if (kind) kinds.add(kind);
    else {
        expect(top.name, `${source}: the surface has a name`).not.toBe("");
        kinds.add(`popover: ${top.name}`);
    }
    await visit({
        source,
        kind,
        name: top.name,
        selector: top.selector,
        surface: page.locator(top.selector),
    });
}

/** Runs `id` and visits the surface it opens; false when it opened none. */
async function visitCommand(
    page: Page,
    id: string,
    source: string,
    visit: Visit,
    kinds: Set<string>,
): Promise<boolean> {
    await runCommand(page, id);
    if (!(await surfaceOpened(page))) {
        await expect.poll(() => commandSettled(page), `${id} settles`).toBe(true);
        return false;
    }
    await visitTop(page, source, visit, kinds);
    await closeAll(page);
    return true;
}

/**
 * Visits every surface a command or a situation opens, then closes it with Escape (no field
 * edited, nothing changes). Starts by loading "Audit" (`loadAudit`).
 *
 * - every command that asks for more (`askingCommands`); one that opens no surface must have
 *   asked for a file (the stubbed pickers cancel);
 * - Layer Properties… on each kind of layer (tile, marker, image, group);
 * - the dialogs a situation asks: Close Project on the dirty project (save changes), Revert
 *   (discard changes), Import Tileset with a picked PNG, Update Tileset from Source with a
 *   picked PNG, Export into a folder holding a file of the bundle (overwrite), a launch with a
 *   snapshot (recovery).
 *
 * Fails when a registered dialog kind or app surface was not visited.
 */
export async function visitAllSurfaces(page: Page, visit: Visit): Promise<string[]> {
    const kinds = new Set<string>();
    const visited: string[] = [];
    await loadAudit(page);
    const asking = await askingCommands(page);
    for (const id of asking) {
        if (id === "layer.properties") continue;
        const pickers = await pickersShown(page);
        if (await visitCommand(page, id, id, visit, kinds)) visited.push(id);
        else {
            // A command that shows a picker first (cancelled, or answered with a PNG it takes
            // without asking more) has no surface of the app's to audit; any other opens one.
            expect(await pickersShown(page), `${id} opens a surface or a picker`).toBeGreaterThan(
                pickers,
            );
        }
        expect(await commandFailures(page), id).toEqual([]);
    }
    for (const layer of [LAYERS.ground, LAYERS.areas, LAYERS.sky, LAYERS.props]) {
        await pageCall(page, "activateLayer", layer);
        const source = `layer.properties (layer ${layer})`;
        expect(await visitCommand(page, "layer.properties", source, visit, kinds), source).toBe(
            true,
        );
        visited.push(source);
    }
    await pageCall(page, "activateLayer", LAYERS.ground);

    const situation = async (id: string, source: string) => {
        expect(await visitCommand(page, id, source, visit, kinds), source).toBe(true);
        expect(await commandFailures(page), source).toEqual([]);
        visited.push(source);
    };
    const { gridPng } = await import("./te-024-support");
    const { folderFiles } = await import("./te-061-support");

    // Update Tileset from Source with a smaller source: 12 of the 16 tiles are missing.
    answerNextChooser(page, [gridPng("terrain.png", 32, 32)]);
    await situation("tileset.updateFromSource", "tileset.updateFromSource (tiles missing)");

    // Import Tiled Map from a folder of maps: the fixture folder of TE-061.
    await writeFolder(page, "tmj", folderFiles());
    await nextFolder(page, "tmj");
    await situation("file.importTiledMap", "file.importTiledMap (a folder of maps)");

    // The save question: Close Project on the dirty project.
    await situation("file.closeProject", "file.closeProject (dirty project)");

    // The discard question: Revert of a saved project made dirty.
    await arrangePickers(page, { nextSave: ["audit.ngtilemap"] });
    await runCommand(page, "file.saveAs");
    await expect.poll(() => commandSettled(page), "Save As settles").toBe(true);
    await rename(page, "Audit", "Rename Project");
    await situation("file.revert", "file.revert (dirty project)");

    // The overwrite question: Export into a folder that holds another project's export.
    await writeFolder(page, "game", [
        {
            path: "ngne-tilemap.export.json",
            bytes: [
                ...Buffer.from(
                    `${JSON.stringify({
                        format: "ngne-tilemap-export",
                        version: 1,
                        generator: "ngne-tilemap-editor 1.0.0",
                        projectId: "another-project",
                        projectName: "Other game",
                    })}\n`,
                ),
            ],
        },
    ]);
    await nextFolder(page, "game");
    await page.evaluate(async () => {
        const path = "/src/app/export/exportProject.ts";
        const { exportPipeline } = (await import(/* @vite-ignore */ path)) as {
            exportPipeline: { exportProject(): Promise<boolean> };
        };
        void exportPipeline.exportProject();
    });
    await expect.poll(() => openKind(page), "overwrite question").toBe("export-overwrite");
    expect(await surfaceOpened(page)).toBe(true);
    await visitTop(page, "export (another project's folder)", visit, kinds);
    visited.push("export (another project's folder)");
    await closeAll(page);

    // Recovery: a snapshot of the dirty project, offered at the next launch.
    await waitForSnapshot(page);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-app-ready", "");
    expect(await recoveryOffered(page), "snapshots offered").toBeGreaterThan(0);
    expect(await surfaceOpened(page), "recovery").toBe(true);
    await visitTop(page, "launch with a snapshot", visit, kinds);
    visited.push("launch with a snapshot");
    await closeAll(page);

    const registered = await registeredSurfaceKinds(page);
    const missing = registered.filter((kind) => !kinds.has(kind));
    return missing;
}

/**
 * The one node a rule is not applied to, with the reason. The list of a select that scrolls
 * (Radix Select's viewport, rendered by the verbatim `ui/primitives/Select.tsx`) holds options
 * the arrow keys, Home and End focus (`tabindex="-1"`, the listbox pattern), so its content is
 * operable from the keyboard; axe's rule asks for a descendant in the tab order instead. The
 * spec checks the keyboard reaches the last option of such a list ("a select list that scrolls
 * is operable from the keyboard"). Changing the primitive is a doc change (DESIGN §3.2,
 * PROVENANCE), so TE-065 reports it.
 */
export const AXE_EXEMPTIONS = [
    { rule: "scrollable-region-focusable", node: "[data-radix-select-viewport]" },
] as const;

/**
 * axe (WCAG 2.1 A and AA) inside `selector`, as se-008's `audit`: the serious and critical
 * violations, one line each; how many texts the contrast rule judged; the on-screen texts it
 * could not decide. Text made only of symbols (an arrow key in a tooltip) is judged as well:
 * by default the contrast rule leaves it undecided (`ignoreUnicode`).
 */
export async function audit(
    page: Page,
    selector?: string,
): Promise<{ violations: string[]; contrastChecked: number; contrastUndecided: string[] }> {
    const judgeSymbols = {
        checks: { "color-contrast": { options: { ignoreUnicode: false } } },
    } as Parameters<AxeBuilder["options"]>[0];
    let builder = new AxeBuilder({ page })
        .options(judgeSymbols)
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
    if (selector) builder = builder.include(selector);
    const results = await builder.analyze();
    const contrast = (list: typeof results.passes) =>
        list.filter((rule) => rule.id === "color-contrast").flatMap((rule) => rule.nodes);
    const contrastUndecided: string[] = [];
    for (const node of contrast(results.incomplete)) {
        const target = node.target.join(" ");
        const onScreen = await page
            .locator(target)
            .first()
            .evaluate((element) => {
                const box = element.getBoundingClientRect();
                return (
                    element.checkVisibility() &&
                    box.width > 0 &&
                    box.height > 0 &&
                    box.right > 0 &&
                    box.bottom > 0 &&
                    box.left < window.innerWidth &&
                    box.top < window.innerHeight
                );
            })
            .catch(() => false);
        if (onScreen) contrastUndecided.push(target);
    }
    const violations = results.violations
        .filter((rule) => rule.impact === "serious" || rule.impact === "critical")
        .flatMap((rule) =>
            rule.nodes
                .filter(
                    (node) =>
                        !AXE_EXEMPTIONS.some(
                            (exemption) =>
                                exemption.rule === rule.id &&
                                node.target.length === 1 &&
                                String(node.target[0]).includes(exemption.node.slice(1, -1)),
                        ),
                )
                .map((node) => `${rule.id}: ${node.target.join(" ")} — ${node.failureSummary}`),
        );
    return { violations, contrastChecked: contrast(results.passes).length, contrastUndecided };
}

/** Serious and critical axe violations inside `selector`, one line each. */
export async function seriousViolations(page: Page, selector?: string): Promise<string[]> {
    return (await audit(page, selector)).violations;
}

/**
 * No serious or critical violation inside `selector`, nor on the page around it; every text of
 * the surface judged by the contrast rule (se-071's `expectAccessible`). A text the rule could
 * not decide because a scrolling list cuts it at its edge is scrolled into view and judged on
 * its own; any other undecided text fails.
 */
export async function expectAccessible(page: Page, name: string, selector: string): Promise<void> {
    await expect(page.locator(selector).first(), name).toBeVisible();
    expect(await seriousViolations(page), `${name}: whole page`).toEqual([]);
    const own = await audit(page, selector);
    expect(own.violations, name).toEqual([]);
    const hasText = await page
        .locator(selector)
        .first()
        .evaluate((root) => {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                const parent = node.parentElement;
                if (!parent || (node.textContent ?? "").trim() === "") continue;
                // The text of a disabled control is not judged (WCAG 1.4.3, inactive parts).
                if (parent.closest('[aria-disabled="true"], [data-disabled], :disabled')) continue;
                const box = parent.getBoundingClientRect();
                if (parent.checkVisibility() && box.width > 1 && box.height > 1) return true;
            }
            return false;
        });
    if (hasText) expect(own.contrastChecked, `${name}: texts judged`).toBeGreaterThan(0);
    // Whether each was cut is read before any is scrolled into view: scrolling one brings the
    // next into view.
    const cuts: boolean[] = [];
    for (const undecided of own.contrastUndecided) {
        cuts.push(await isCut(page, undecided));
    }
    for (const [index, undecided] of own.contrastUndecided.entries()) {
        if (!cuts[index]) {
            // Not cut by a list: judged here, as axe would, when only its own ancestors lie
            // under it (axe leaves some such text undecided, "partially overlaps").
            const ratio = await ownContrast(page, undecided);
            expect(
                ratio,
                `${name}: ${undecided} undecided, with something else under it`,
            ).not.toBeNull();
            expect(ratio!, `${name}: ${undecided} contrast`).toBeGreaterThanOrEqual(4.5);
            continue;
        }
        await page
            .locator(undecided)
            .first()
            .evaluate((element) => element.scrollIntoView({ block: "center" }));
        await page.evaluate(
            () =>
                new Promise((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(resolve)),
                ),
        );
        const alone = await audit(page, undecided);
        expect(alone.violations, `${name}: ${undecided}`).toEqual([]);
        expect(alone.contrastUndecided, `${name}: ${undecided} in view`).toEqual([]);
    }
}

/**
 * The contrast ratio (WCAG 2.1) of the text of `selector` over its background: the backgrounds
 * of its ancestors, composited up to the first opaque one. Null when an element that is not an
 * ancestor lies under the text (its background is then not the ancestors').
 */
function ownContrast(page: Page, selector: string): Promise<number | null> {
    return page
        .locator(selector)
        .first()
        .evaluate((element) => {
            const box = element.getBoundingClientRect();
            const points = [
                [box.left + 1, box.top + 1],
                [box.left + box.width / 2, box.top + box.height / 2],
                [box.right - 1, box.bottom - 1],
            ];
            for (const [x, y] of points) {
                for (const hit of document.elementsFromPoint(x!, y!)) {
                    if (hit !== element && !hit.contains(element)) return null;
                }
            }
            const parse = (value: string) => {
                const parts = /rgba?\(([^)]+)\)/
                    .exec(value)?.[1]
                    ?.split(/[ ,/]+/)
                    .filter(Boolean);
                if (!parts) return null;
                const [r, g, b, a] = parts.map(Number);
                return { r: r!, g: g!, b: b!, a: a ?? 1 };
            };
            const layers: { r: number; g: number; b: number; a: number }[] = [];
            for (let node: Element | null = element; node; node = node.parentElement) {
                const colour = parse(getComputedStyle(node).backgroundColor);
                if (colour && colour.a > 0) layers.push(colour);
                if (colour && colour.a >= 1) break;
            }
            let background = { r: 255, g: 255, b: 255 };
            for (const layer of layers.reverse()) {
                background = {
                    r: layer.r * layer.a + background.r * (1 - layer.a),
                    g: layer.g * layer.a + background.g * (1 - layer.a),
                    b: layer.b * layer.a + background.b * (1 - layer.a),
                };
            }
            const text = parse(getComputedStyle(element).color)!;
            const foreground = {
                r: text.r * text.a + background.r * (1 - text.a),
                g: text.g * text.a + background.g * (1 - text.a),
                b: text.b * text.a + background.b * (1 - text.a),
            };
            const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
                const channel = (value: number) => {
                    const c = value / 255;
                    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
                };
                return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
            };
            const [light, dark] = [luminance(foreground), luminance(background)].sort(
                (p, q) => q - p,
            );
            return (light! + 0.05) / (dark! + 0.05);
        });
}

/** Whether a scrolling list cuts the element `selector` at its visible edge. */
function isCut(page: Page, selector: string): Promise<boolean> {
    return page
        .locator(selector)
        .first()
        .evaluate((element) => {
            const row = element.getBoundingClientRect();
            for (let parent = element.parentElement; parent; parent = parent.parentElement) {
                const style = getComputedStyle(parent);
                const scrolls =
                    (/auto|scroll/.test(style.overflowY) &&
                        parent.scrollHeight > parent.clientHeight) ||
                    (/auto|scroll/.test(style.overflowX) &&
                        parent.scrollWidth > parent.clientWidth);
                if (!scrolls) continue;
                const view = parent.getBoundingClientRect();
                return (
                    row.top < view.top ||
                    row.bottom > view.bottom ||
                    row.left < view.left ||
                    row.right > view.right
                );
            }
            return false;
        });
}

/** The region that holds the toasts. */
export const NOTIFICATIONS = '[role="region"][aria-label="Notifications"]';

/**
 * Shows a toast of each kind the app shows: information, an error with the app's storage
 * message, and one with an action. Returns how many are on screen.
 */
export async function showEveryToast(page: Page): Promise<number> {
    await page.evaluate(async () => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const { toast } = (await load("/src/ui/toast/toast.ts")) as typeof ToastModule;
        const { STORAGE_WRITE_FAILED_MESSAGE } = (await load(
            "/src/app/platform/storage.ts",
        )) as typeof StorageModule;
        toast.info("Saved audit.ngtilemap");
        toast.error(STORAGE_WRITE_FAILED_MESSAGE);
        toast.info("A new version is ready.", { action: { label: "Reload", run() {} } });
    });
    await expect(page.locator(`${NOTIFICATIONS} .ui-toast`)).toHaveCount(3);
    return 3;
}

/**
 * The exceptions to the 24 × 24 px target of DESIGN §10.4, each also operable from the
 * keyboard: tiles in the Tilesets panel's grid, terrain swatches in the context bar,
 * splitters. Marker vertices are drawn on the viewport's overlay, not elements.
 */
export const TARGET_EXCEPTIONS =
    '[data-tile-grid] *, [data-region="context-bar"] [data-terrain-swatch], [role="separator"]';

/** Pointer targets smaller than 24 × 24 px inside `selector`, but `TARGET_EXCEPTIONS`. */
export function smallTargets(page: Page, selector = "body"): Promise<string[]> {
    return page.locator(selector).evaluate((root, exception) => {
        const targets = root.querySelectorAll<HTMLElement>(
            'button, input:not([type="hidden"]), select, textarea, a[href], [role="button"], [role="radio"], [role="checkbox"], [role="switch"], [role="slider"], [role="combobox"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="treeitem"], [role="gridcell"]',
        );
        const found: string[] = [];
        for (const element of targets) {
            if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) {
                continue;
            }
            if (getComputedStyle(element).pointerEvents === "none") continue;
            if (element.matches(exception)) continue;
            // A field's whole box is its target (the number field's frame).
            const box = (element.closest(".ui-number") ?? element).getBoundingClientRect();
            if (box.width <= 1 || box.height <= 1) continue;
            if (box.width < 24 || box.height < 24) {
                const name =
                    element.getAttribute("aria-label") ??
                    element.getAttribute("data-command") ??
                    element.textContent ??
                    "";
                const role = element.getAttribute("role") ?? element.tagName.toLowerCase();
                found.push(
                    `${role} "${name.trim().slice(0, 30)}": ${box.width.toFixed(1)} × ${box.height.toFixed(1)}`,
                );
            }
        }
        return found;
    }, TARGET_EXCEPTIONS);
}

/**
 * Interactive elements: native controls, ARIA widget roles and anything in the tab order.
 * Left out: what the pointer cannot reach and is not seen (Radix's hidden form inputs,
 * visually hidden text).
 */
const INTERACTIVE = [
    "button",
    "input:not([type=hidden])",
    "select",
    "textarea",
    "a[href]",
    '[tabindex]:not([tabindex="-1"])',
    ...[
        "button",
        "checkbox",
        "radio",
        "switch",
        "tab",
        "slider",
        "spinbutton",
        "combobox",
        "menuitem",
        "menuitemcheckbox",
        "menuitemradio",
        "option",
        "treeitem",
        "gridcell",
        "separator",
    ].map((role) => `[role="${role}"]`),
].join(", ");

/** What `INTERACTIVE` holds but regions in the tab order for their own sake and splitters. */
const CONTROLS = INTERACTIVE.split(", ")
    .filter((part) => !part.startsWith("[tabindex]") && part !== '[role="separator"]')
    .join(", ");

/**
 * The layout problems of the interactive elements inside `selector` (se-071's check):
 *
 * - overlap: two visible interactive elements, neither inside the other, whose boxes share
 *   more than a 1 px hairline. A splitter's hit area may meet one neighbour when one of the
 *   two takes every press of the shared area (a control must take them itself);
 * - clipped: an interactive element outside the visible box of an ancestor that clips it
 *   along an axis where that ancestor cannot scroll to show it, or outside the window.
 */
export function layoutProblems(page: Page, selector = "body"): Promise<string[]> {
    return page.locator(selector).evaluate(
        (scope, { interactive, controls }) => {
            const describe = (element: Element) => {
                const name =
                    element.getAttribute("aria-label") ??
                    element.getAttribute("data-command") ??
                    (element.textContent ?? "").trim().slice(0, 30);
                const role = element.getAttribute("role") ?? element.tagName.toLowerCase();
                return `${role} "${name}"`;
            };
            const elements = [...scope.querySelectorAll(interactive)].filter((element) => {
                if (!(element instanceof HTMLElement)) return false;
                if (!element.checkVisibility({ visibilityProperty: true, opacityProperty: true })) {
                    return false;
                }
                if (getComputedStyle(element).pointerEvents === "none") return false;
                const box = element.getBoundingClientRect();
                return box.width > 1 && box.height > 1;
            });
            const problems: string[] = [];
            const boxes = elements.map((element) => element.getBoundingClientRect());
            // What of each element is seen: its box cut by every ancestor that clips (a
            // scrolled dock section's header below the dock's edge is not over the panel
            // under the dock).
            const seen = elements.map((element, index) => {
                const box = boxes[index]!;
                let { left, top, right, bottom } = box;
                for (let parent = element.parentElement; parent; parent = parent.parentElement) {
                    const style = getComputedStyle(parent);
                    if (style.overflowX === "visible" && style.overflowY === "visible") continue;
                    const outer = parent.getBoundingClientRect();
                    const innerLeft = outer.left + parent.clientLeft;
                    const innerTop = outer.top + parent.clientTop;
                    if (style.overflowX !== "visible") {
                        left = Math.max(left, innerLeft);
                        right = Math.min(right, innerLeft + parent.clientWidth);
                    }
                    if (style.overflowY !== "visible") {
                        top = Math.max(top, innerTop);
                        bottom = Math.min(bottom, innerTop + parent.clientHeight);
                    }
                }
                return { left, top, right, bottom };
            });
            for (let i = 0; i < elements.length; i++) {
                for (let j = i + 1; j < elements.length; j++) {
                    const a = elements[i]!;
                    const b = elements[j]!;
                    if (a.contains(b) || b.contains(a)) continue;
                    const p = seen[i]!;
                    const q = seen[j]!;
                    const width = Math.min(p.right, q.right) - Math.max(p.left, q.left);
                    const height = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
                    if (width <= 1 || height <= 1) continue;
                    const aSplits = a.getAttribute("role") === "separator";
                    const bSplits = b.getAttribute("role") === "separator";
                    if (aSplits !== bSplits) {
                        const neighbour = aSplits ? "b" : "a";
                        const control = (aSplits ? b : a).matches(controls);
                        const radius = parseFloat(getComputedStyle(aSplits ? b : a).borderRadius);
                        // At least 1 px in: hit-testing rounds a point half a pixel from an edge
                        // to the neighbour across it (rows that abut).
                        const insetX = Math.min(Math.max(radius || 0, 1), width / 2);
                        const insetY = Math.min(Math.max(radius || 0, 1), height / 2);
                        const left = Math.max(p.left, q.left);
                        const top = Math.max(p.top, q.top);
                        const points = [
                            [left + insetX, top + insetY],
                            [left + width - insetX, top + insetY],
                            [left + insetX, top + height - insetY],
                            [left + width - insetX, top + height - insetY],
                            [left + width / 2, top + height / 2],
                        ];
                        const owners = new Set(
                            points.map(([x, y]) => {
                                // The window's last half pixel hit-tests to nothing.
                                const hit = document.elementFromPoint(
                                    Math.min(x!, window.innerWidth - 1),
                                    Math.min(y!, window.innerHeight - 1),
                                );
                                return hit && a.contains(hit)
                                    ? "a"
                                    : hit && b.contains(hit)
                                      ? "b"
                                      : "other";
                            }),
                        );
                        const single = owners.size === 1 && !owners.has("other");
                        if (single && (!control || owners.has(neighbour))) continue;
                    }
                    problems.push(
                        `overlap: ${describe(a)} and ${describe(b)} share ${width.toFixed(1)} × ${height.toFixed(1)} px`,
                    );
                }
            }
            const slack = 0.5;
            elements.forEach((element, index) => {
                const box = boxes[index]!;
                let scrolledAway = false;
                for (let parent = element.parentElement; parent; parent = parent.parentElement) {
                    const style = getComputedStyle(parent);
                    if (style.overflowX === "visible" && style.overflowY === "visible") continue;
                    const outer = parent.getBoundingClientRect();
                    const left = outer.left + parent.clientLeft;
                    const top = outer.top + parent.clientTop;
                    const right = left + parent.clientWidth;
                    const bottom = top + parent.clientHeight;
                    const outX = box.left < left - slack || box.right > right + slack;
                    const outY = box.top < top - slack || box.bottom > bottom + slack;
                    const scrollsX =
                        /auto|scroll/.test(style.overflowX) &&
                        parent.scrollWidth > parent.clientWidth;
                    const scrollsY =
                        /auto|scroll/.test(style.overflowY) &&
                        parent.scrollHeight > parent.clientHeight;
                    if (
                        (outX && style.overflowX !== "visible" && !scrollsX) ||
                        (outY && style.overflowY !== "visible" && !scrollsY)
                    ) {
                        const where =
                            parent.getAttribute("data-region") ??
                            (parent.className || parent.tagName.toLowerCase());
                        problems.push(`clipped: ${describe(element)} by ${String(where)}`);
                        return;
                    }
                    if ((outX && scrollsX) || (outY && scrollsY)) {
                        scrolledAway = true;
                        break;
                    }
                }
                if (
                    !scrolledAway &&
                    (box.left < -slack ||
                        box.top < -slack ||
                        box.right > window.innerWidth + slack ||
                        box.bottom > window.innerHeight + slack)
                ) {
                    problems.push(`clipped by the window: ${describe(element)}`);
                }
            });
            return problems;
        },
        { interactive: INTERACTIVE, controls: CONTROLS },
    );
}

/**
 * Brings each part of the shell that has a state of its own into view and calls `check` with a
 * name for it: the shell with every dock section expanded, the tile layer active and every
 * cell selected (the Properties panel shows Ground's custom properties); the Terrains tab of
 * the bottom panel; the Properties panel on the project, the tileset and the selected tile; the
 * context bar of every tool of the tile layer's set; one marker selected (its fields and
 * custom property); the context bar of every tool of the marker layer's set with both markers
 * selected.
 */
export async function eachShellState(
    page: Page,
    check: (name: string) => Promise<void>,
): Promise<void> {
    await loadAudit(page);
    await expandDock(page);
    await runCommand(page, "select.all");
    await check("shell, every dock section expanded");
    const terrains = region(page, "bottom-panel").getByRole("tab", { name: "Terrains" });
    await terrains.click();
    await expect(terrains).toHaveAttribute("aria-selected", "true");
    await check("bottom panel: Terrains");
    await region(page, "bottom-panel").getByRole("tab", { name: "Tilesets" }).click();
    const header = region(page, "dock").locator('[data-dock-panel="properties"]');
    await expect(header).toContainText("Layer · Ground");
    await expect(region(page, "dock").locator("[data-property-menu]")).toHaveCount(2);
    for (const [id, shown] of [
        ["properties.showProject", "Audit"],
        ["properties.showTileset", "Terrain"],
        ["properties.showTiles", "Tile · Terrain#0"],
    ] as const) {
        await runCommand(page, id);
        await expect.poll(() => commandSettled(page), id).toBe(true);
        await expect(region(page, "dock").locator('[data-dock-panel="properties"]')).toContainText(
            shown,
        );
        await settleTimers(page);
        await check(`properties: ${id}`);
    }
    await runCommand(page, "properties.showSelection");
    // A change of the map's selection ends the tile focus Show Tile Properties gave.
    await pageCall(page, "activateLayer", LAYERS.paths);
    await pageCall(page, "activateLayer", LAYERS.ground);
    await expect(header).toContainText("Layer · Ground");
    for (const [kind, layer] of [
        ["tile", LAYERS.ground],
        ["marker", LAYERS.areas],
    ] as const) {
        await pageCall(page, "activateLayer", layer);
        if (kind === "marker") {
            await pageCall(page, "selectMarkers", [1]);
            await expect(header).toContainText("exit");
            await check("properties: one marker");
            await pageCall(page, "selectMarkers", [1, 2]);
        }
        const tools = await pageCall<string[]>(page, "offeredTools");
        expect(tools.length, `tools of the ${kind} layer`).toBeGreaterThan(2);
        for (const tool of tools) {
            expect(await pageCall<boolean>(page, "selectTool", tool), tool).toBe(true);
            await expect.poll(() => pageCall<string>(page, "activeTool")).toBe(tool);
            await settleTimers(page);
            await check(`${kind} layer, tool ${tool}`);
        }
    }
    await pageCall(page, "activateLayer", LAYERS.ground);
}
