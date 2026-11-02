import { test } from "@playwright/test";
import type { CellSpec, StampState } from "./te-018-support";
import { closeMenu, openMenu } from "./te-007-support";
import {
    cells,
    clickAt,
    expect,
    history,
    openEditor,
    put,
    setStamp,
    stamp,
} from "./te-018-support";

// TE-018: the stamp transforms (SPEC §4.2, §2.3) on their keys (DESIGN §10.3), the Tileset menu
// (DESIGN §5) and the stamp brush's context bar (DESIGN §7). Cells are [tile, orientation],
// the orientation the 3-bit index `H<<2 | V<<1 | D` of FORMAT §1.2.

/**
 * 2 × 3, row by row:  a b / c d / e f, each tile with another orientation, so every expected
 * stamp below shows where each cell went and what became of its flags.
 */
const BASE: CellSpec[] = [
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [0, 4],
    [1, 5],
];

/**
 * The stamp under each transform, worked by hand from SPEC §2.3: positions turned or mirrored,
 * orientations through Tiled's rotate tables (`rotateRightMask = [5, 4, 1, 0, 7, 6, 3, 2]`,
 * `rotateLeftMask = [3, 2, 7, 6, 1, 0, 5, 4]`) or with H or V toggled.
 */
const EXPECTED: Record<string, StampState> = {
    // e c a / f d b
    R: {
        width: 3,
        height: 2,
        cells: [
            [0, 7],
            [2, 1],
            [0, 5],
            [1, 6],
            [3, 0],
            [1, 4],
        ],
    },
    // b d f / a c e
    "Shift+R": {
        width: 3,
        height: 2,
        cells: [
            [1, 2],
            [3, 6],
            [1, 0],
            [0, 3],
            [2, 7],
            [0, 1],
        ],
    },
    // b a / d c / f e, H toggled
    F: {
        width: 2,
        height: 3,
        cells: [
            [1, 5],
            [0, 4],
            [3, 7],
            [2, 6],
            [1, 1],
            [0, 0],
        ],
    },
    // e f / c d / a b, V toggled
    "Shift+F": {
        width: 2,
        height: 3,
        cells: [
            [0, 6],
            [1, 7],
            [2, 0],
            [3, 1],
            [0, 2],
            [1, 3],
        ],
    },
};

/** Some cells of Ground, so that "the map is unchanged" is about real content. */
const GROUND: [number, number, CellSpec][] = [
    [3, 3, [1, 0]],
    [4, 3, [2, 5]],
    [30, 20, [3, 7]],
];

test.beforeEach(async ({ page }) => {
    await openEditor(page);
    await put(page, GROUND);
});

test("each key transforms the stamp, and the map and history are unchanged", async ({ page }) => {
    const map = await cells(page);
    for (const [key, expected] of Object.entries(EXPECTED)) {
        await setStamp(page, 2, 3, BASE);
        await page.keyboard.press(key);
        expect(await stamp(page), key).toEqual(expected);
        expect(await cells(page), key).toEqual(map);
        expect(await history(page), key).toEqual({ undo: null, redo: null });
    }
    // Four quarter turns, or two flips, give the stamp back.
    await setStamp(page, 2, 3, BASE);
    for (let i = 0; i < 4; i++) await page.keyboard.press("R");
    expect((await stamp(page))?.cells).toEqual(BASE);
    await page.keyboard.press("F");
    await page.keyboard.press("F");
    expect((await stamp(page))?.cells).toEqual(BASE);
});

test("painting a rotated 2 × 3 stamp writes a 3 × 2 block with the composed flags", async ({
    page,
}) => {
    await setStamp(page, 2, 3, BASE);
    await page.keyboard.press("R");
    // A 3 × 2 stamp has its anchor at (1, 1): the click at (10, 10) covers (9..11, 9..10).
    await clickAt(page, 10, 10);
    expect(await cells(page)).toEqual([
        "3,3:1/0",
        "4,3:2/5",
        "9,9:0/7",
        "10,9:2/1",
        "11,9:0/5",
        "9,10:1/6",
        "10,10:3/0",
        "11,10:1/4",
        "30,20:3/7",
    ]);
    expect(await history(page)).toEqual({ undo: "Stamp Brush", redo: null });

    // Then flipped: R then F is the anti-diagonal flip, a b / c d / e f → a c e / b d f with
    // D toggled.
    await page.keyboard.press("F");
    await clickAt(page, 20, 15);
    const painted = (await cells(page)).filter((cell) => /^(19|20|21),(14|15):/.test(cell));
    expect(painted).toEqual([
        "19,14:0/1",
        "20,14:2/5",
        "21,14:0/3",
        "19,15:1/0",
        "20,15:3/4",
        "21,15:1/2",
    ]);
});

test("the context bar buttons and the Tileset menu run the same transforms", async ({ page }) => {
    const bar = page.locator('[data-context-tool="stamp"]').locator("..");
    const button = (command: string) => bar.locator(`[data-tool-action="${command}"]`);

    // No stamp: the buttons and the menu items are disabled.
    for (const command of [
        "stamp.rotateLeft",
        "stamp.rotateRight",
        "stamp.flipHorizontal",
        "stamp.flipVertical",
    ]) {
        await expect(button(command)).toBeDisabled();
    }
    const menu = await openMenu(page, "Tileset");
    await expect(menu.getByRole("menuitem", { name: "Rotate Stamp Right" })).toHaveAttribute(
        "aria-disabled",
        "true",
    );
    await closeMenu(page);

    // DESIGN §7: rotate left, rotate right (icon buttons), Flip H, Flip V, then the size.
    await setStamp(page, 2, 3, BASE);
    await expect(bar.locator("[data-tool-action]")).toHaveText(["", "", "Flip H", "Flip V"]);
    await expect(button("stamp.rotateLeft")).toHaveAccessibleName("Rotate Stamp Left");
    await expect(button("stamp.rotateRight")).toHaveAccessibleName("Rotate Stamp Right");
    const map = await cells(page);
    const cases: [string, string][] = [
        ["stamp.rotateRight", "R"],
        ["stamp.rotateLeft", "Shift+R"],
        ["stamp.flipHorizontal", "F"],
        ["stamp.flipVertical", "Shift+F"],
    ];
    for (const [command, key] of cases) {
        await setStamp(page, 2, 3, BASE);
        await button(command).click();
        expect(await stamp(page), command).toEqual(EXPECTED[key]);
    }
    await expect(page.locator('[data-tool-readout="size"] output')).toHaveText("2 × 3");

    const items: [string, string][] = [
        ["Rotate Stamp Right", "R"],
        ["Rotate Stamp Left", "Shift+R"],
        ["Flip Stamp Horizontally", "F"],
        ["Flip Stamp Vertically", "Shift+F"],
    ];
    for (const [item, key] of items) {
        await setStamp(page, 2, 3, BASE);
        await (await openMenu(page, "Tileset")).getByRole("menuitem", { name: item }).click();
        expect(await stamp(page), item).toEqual(EXPECTED[key]);
    }
    expect(await cells(page)).toEqual(map);
    expect(await history(page)).toEqual({ undo: null, redo: null });
});
