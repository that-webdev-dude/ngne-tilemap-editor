import { beforeEach, describe, expect, it } from "vitest";
import { clipboardContent, copyCellsToClipboard } from "../../src/app/clipboard/clipboard";
import { sessionStore } from "../../src/app/state/session";
import { currentStamp, setCurrentStamp } from "../../src/app/tools/stamp/currentStamp";
import { cellValue } from "../../src/core/cells";
import type { Stamp } from "../../src/core/cells";
import { createProjectSession, sequentialIds } from "../../src/core/model";
import type { Tileset } from "../../src/core/model";
import { addTilesetCommand, importGridPng } from "../../src/core/tileset";
import { tileset as fixtureTileset } from "./te-006-support";
import { emptyProject, png, positionImage } from "./te-022-support";

// TE-022: removed tiles (SPEC §4.2). The current stamp and the clipboard hold slots and tile
// IDs; undoing an add-tileset removes the tileset, so their cells on it become empty, a stamp
// left with none is no stamp, and a later add that reuses the freed slot gives them nothing
// back.

const OTHER = 1;
const other = (tile: number) => cellValue(OTHER, tile);
const added = (tile: number) => cellValue(2, tile);
const stamp = (cells: number[]): Stamp => ({
    width: cells.length,
    height: 1,
    cells: Uint32Array.from(cells),
});

async function grid(fileName: string): Promise<Tileset> {
    const { project } = sessionStore.getState().session;
    const options = {
        fileName,
        tileWidth: 4,
        tileHeight: 4,
        margin: 0,
        spacing: 0,
        newId: sequentialIds(fileName.replace(/[^A-Za-z0-9]/g, "-")),
    };
    return (await importGridPng(project, png(positionImage(8, 8)), options)).tileset;
}

/** Adds an imported tileset through the app's history; it takes slot 2. */
async function addGrid(fileName = "added.png"): Promise<Tileset> {
    const tileset = await grid(fileName);
    sessionStore.getState().history.execute(addTilesetCommand(tileset));
    expect(tileset.slot).toBe(2);
    return tileset;
}

const history = () => sessionStore.getState().history;
const cells = (value: Stamp | null | undefined) => (value ? [...value.cells] : null);

beforeEach(() => {
    const project = emptyProject();
    project.tilesets.push(fixtureTileset("other", OTHER));
    sessionStore.getState().replace(createProjectSession(project));
    setCurrentStamp(null);
});

describe("removed tiles", () => {
    it("undoing an add empties the added tileset's cells in the stamp and the clipboard", async () => {
        await addGrid();
        setCurrentStamp(stamp([added(0), other(1), 0, added(3), other(0)]));
        copyCellsToClipboard(stamp([other(0), added(2), added(1), other(1)]));

        history().undo();
        expect(cells(currentStamp())).toEqual([0, other(1), 0, 0, other(0)]);
        expect(cells(clipboardContent()?.stamp)).toEqual([other(0), 0, 0, other(1)]);
        expect(currentStamp()!.width).toBe(5);
        expect(clipboardContent()!.stamp.width).toBe(4);
    });

    it("leaves no stamp and no clipboard when only the added tileset's cells were held", async () => {
        await addGrid();
        setCurrentStamp(stamp([added(0), 0, added(1)]));
        copyCellsToClipboard(stamp([added(3)]));
        history().undo();
        expect(currentStamp()).toBeNull();
        expect(clipboardContent()).toBeNull();
    });

    it("gives nothing back when a later add reuses the freed slot", async () => {
        await addGrid();
        setCurrentStamp(stamp([added(0), other(1)]));
        copyCellsToClipboard(stamp([added(1), other(0)]));
        history().undo();
        const keptStamp = currentStamp();
        const keptClipboard = clipboardContent();

        await addGrid("later.png");
        expect(currentStamp()).toBe(keptStamp);
        expect(clipboardContent()).toBe(keptClipboard);
        expect(cells(currentStamp())).toEqual([0, other(1)]);
        expect(cells(clipboardContent()?.stamp)).toEqual([0, other(0)]);
    });

    it("leaves the stamp and the clipboard as they are while their tiles exist", async () => {
        setCurrentStamp(stamp([other(0), other(1)]));
        copyCellsToClipboard(stamp([other(1)]));
        const before = [currentStamp(), clipboardContent()];
        await addGrid();
        history().undo();
        history().redo();
        expect([currentStamp(), clipboardContent()]).toEqual(before);
        expect(currentStamp()).toBe(before[0]);
    });
});
