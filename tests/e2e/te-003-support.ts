import { AxeBuilder } from "@axe-core/playwright";
import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { openApp } from "./support/wait";

// Shared helpers of the TE-003 specs, adapted from the sprite editor's se-006-support.ts.

/** The seven regions of DESIGN §2, by their `data-region` value. */
export const REGIONS = [
    "menu-bar",
    "tool-rail",
    "context-bar",
    "viewport",
    "dock",
    "bottom-panel",
    "status-bar",
] as const;
export type Region = (typeof REGIONS)[number];

export const THEME_KEY = "ngne-tilemap-editor.theme";

export interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

export function region(page: Page, id: Region): Locator {
    return page.locator(`[data-region="${id}"]`);
}

export async function boxOf(locator: Locator): Promise<Box> {
    return locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
}

export async function regionBoxes(page: Page): Promise<Record<Region, Box>> {
    const entries = [];
    for (const id of REGIONS) entries.push([id, await boxOf(region(page, id))] as const);
    return Object.fromEntries(entries) as Record<Region, Box>;
}

/** Area shared by two boxes, in square pixels. */
export function overlap(a: Box, b: Box): number {
    const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return Math.max(0, width) * Math.max(0, height);
}

/** Opens the app at `size` and waits for the shell. */
export async function openShell(page: Page, size?: { width: number; height: number }) {
    if (size) await page.setViewportSize(size);
    await openApp(page);
    await expect(region(page, "viewport")).toBeVisible();
}

/** Opens the gallery with transitions off, so colours are final when they are read. */
export async function openGallery(page: Page) {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openApp(page, "/gallery");
    await expect(page.getByRole("heading", { name: "Interface gallery" })).toBeVisible();
}

/**
 * Records uncaught errors and console errors of the page. The dev server has no favicon, and
 * Chrome logs that missing resource; it is not an application error.
 */
export function collectErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(`uncaught: ${error.message}`));
    page.on("console", (message) => {
        if (message.type() !== "error") return;
        if (message.location().url.endsWith("/favicon.ico")) return;
        errors.push(`console: ${message.text()}`);
    });
    return errors;
}

/** Serious and critical axe violations (WCAG 2.1 A and AA) on the page, one line per node. */
export async function seriousViolations(page: Page): Promise<string[]> {
    const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
    return results.violations
        .filter((rule) => rule.impact === "serious" || rule.impact === "critical")
        .flatMap((rule) =>
            rule.nodes.map(
                (node) => `${rule.id}: ${node.target.join(" ")} — ${node.failureSummary}`,
            ),
        );
}
