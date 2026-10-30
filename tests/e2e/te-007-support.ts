import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../src/app/testing/testHooks";
import { openApp } from "./support/wait";
import { region } from "./te-003-support";

// Shared helpers of the TE-007 specs that drive the real app through its test hook. Adapted
// from the sprite editor's se-007-support.ts: one project per window, so a command runs on the
// app's history instead of a document opened by the test.

/** Opens the app and waits for the shell and the test hook. */
export async function openEditor(page: Page): Promise<void> {
    await openApp(page);
    await expect(region(page, "viewport")).toBeVisible();
    await page.waitForFunction(() => window.__ngneTest !== undefined);
}

/**
 * Executes an undoable test command on the project's history: it renames the project, and
 * undo restores the previous name. `label` is what the Edit menu shows after "Undo".
 */
export function rename(page: Page, name: string, label: string): Promise<void> {
    return page.evaluate(
        ({ name, label }) => {
            const { history } = window.__ngneTest!.session.getState();
            let previous = "";
            history.execute({
                label,
                bytes: 0,
                touched: {
                    mapId: null,
                    layerIds: [],
                    cellRects: [],
                    tilesetIds: [],
                    structure: false,
                },
                do(session) {
                    previous = session.project.name;
                    session.project.name = name;
                },
                undo(session) {
                    session.project.name = previous;
                },
            });
        },
        { name, label },
    );
}

/** What a spec reads of the project and its history. */
export interface ProjectSnapshot {
    name: string;
    canUndo: boolean;
    canRedo: boolean;
    undoLabel: string | null;
    redoLabel: string | null;
    position: number;
}

export function snapshot(page: Page): Promise<ProjectSnapshot> {
    return page.evaluate(() => {
        const { session, history } = window.__ngneTest!.session.getState();
        return {
            name: session.project.name,
            canUndo: history.canUndo,
            canRedo: history.canRedo,
            undoLabel: history.undoLabel,
            redoLabel: history.redoLabel,
            position: history.position,
        };
    });
}

/** A menu of the menu bar, opened by its trigger. */
export async function openMenu(page: Page, name: string): Promise<Locator> {
    await menuTrigger(page, name).click();
    const menu = page.getByRole("menu", { name });
    await expect(menu).toBeVisible();
    return menu;
}

export function menuTrigger(page: Page, name: string): Locator {
    return region(page, "menu-bar").getByRole("menuitem", { name, exact: true });
}

export async function closeMenu(page: Page): Promise<void> {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
}

/** The item of a command in the open menu. */
export function menuItem(page: Page, commandId: string): Locator {
    return page.locator(`[role="menuitem"][data-command="${commandId}"]`);
}

/** Adds a text field to a region of the shell (or to the page) and returns it. */
export async function addTextField(page: Page, regionId?: string): Promise<Locator> {
    await page.evaluate((regionId) => {
        const field = document.createElement("input");
        field.setAttribute("aria-label", "Test field");
        field.dataset.testid = "test-field";
        const parent = regionId ? document.querySelector(`[data-region="${regionId}"]`) : null;
        (parent ?? document.body).append(field);
    }, regionId);
    return page.getByTestId("test-field");
}

/**
 * Adds the viewport's focus element (`data-viewport-focus`, which TE-013's viewport host
 * renders) to the viewport region and returns it, so a key bound for "viewport focused" can
 * be pressed there.
 */
export async function addViewportFocus(page: Page): Promise<Locator> {
    await page.evaluate(() => {
        const target = document.createElement("div");
        target.tabIndex = 0;
        target.dataset.testid = "viewport-focus";
        target.dataset.viewportFocus = "";
        target.style.cssText = "width: 100%; height: 100%;";
        document.querySelector('[data-region="viewport"]')?.append(target);
    });
    return page.getByTestId("viewport-focus");
}

/** Lets the timers Radix sets after a menu closes (focus return) run. */
export function settleTimers(page: Page): Promise<void> {
    return page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
}
