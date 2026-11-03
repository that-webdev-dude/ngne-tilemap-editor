import { describe, expect, it } from "vitest";
import { History } from "../../src/core/history";
import { createProjectSession, sequentialIds } from "../../src/core/model";
import type { Project } from "../../src/core/model";
import {
    IMPORT_TILESET_LABEL,
    TilesetImportError,
    addTilesetCommand,
    importGridPng,
} from "../../src/core/tileset";
import { expectSymmetric, snapshotProject } from "./support/symmetry";
import { tileset as fixtureTileset } from "./te-006-support";
import { emptyProject, png, positionImage } from "./te-022-support";

// TE-022: the add-tileset command (SPEC §6.1): the tileset goes to the end of the list in the
// lowest free slot, one entry; undo removes it. It passes the TE-006 symmetry harness.

async function imported(project: Project, fileName = "grass.png") {
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

/** A project with tilesets in slots 1 and 3, so slot 2 is the lowest free one. */
function withGap(): Project {
    const project = emptyProject();
    project.tilesets.push(fixtureTileset("a", 1), fixtureTileset("b", 3));
    return project;
}

describe("add-tileset command", () => {
    it("passes the do/undo symmetry harness", async () => {
        const project = withGap();
        const history = new History(createProjectSession(project));
        const tileset = await imported(project);
        const command = expectSymmetric(history, addTilesetCommand(tileset), { rounds: 2 });
        expect(command.label).toBe(IMPORT_TILESET_LABEL);
        expect(command.touched).toMatchObject({ tilesetIds: [tileset.id], structure: true });
    });

    it("adds at the end of the list in the lowest free slot; undo removes it", async () => {
        const project = withGap();
        const history = new History(createProjectSession(project));
        const tileset = await imported(project);
        history.execute(addTilesetCommand(tileset));
        expect(project.tilesets.map((t) => [t.id, t.slot])).toEqual([
            ["a", 1],
            ["b", 3],
            [tileset.id, 2],
        ]);
        history.undo();
        expect(project.tilesets.map((t) => t.id)).toEqual(["a", "b"]);
        history.redo();
        expect(project.tilesets.at(-1)).toBe(tileset);
        expect(tileset.slot).toBe(2);
    });

    it("counts the tileset's pixels as project memory and history memory", async () => {
        const project = emptyProject();
        const command = addTilesetCommand(await imported(project));
        expect(command.projectBytes).toBe(8 * 8 * 4);
        expect(command.bytes).toBeGreaterThanOrEqual(8 * 8 * 4);
    });

    it("refuses, unchanged, a tileset whose export name was taken since the import", async () => {
        const project = emptyProject();
        const history = new History(createProjectSession(project));
        const first = await imported(project);
        const second = await imported(project, "grass.png ");
        history.execute(addTilesetCommand(first));
        const before = snapshotProject(project);
        expect(() => history.execute(addTilesetCommand(second))).toThrow(TilesetImportError);
        expect(snapshotProject(project)).toStrictEqual(before);
        expect(history.undoCount).toBe(1);
    });
});
