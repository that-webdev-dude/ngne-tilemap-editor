import { describe, expect, it } from "vitest";
import { cellSlot, cellTileId, cellValue } from "../../src/core/cells";
import { History } from "../../src/core/history";
import {
    assertInvariants,
    createProject,
    createProjectSession,
    walkLayers,
} from "../../src/core/model";
import type { Project, ProjectMap, TileLayer, Tileset } from "../../src/core/model";
import { importGridPng } from "../../src/core/tileset";
import {
    IMPORT_TILED_MAP_LABEL,
    TmjError,
    importTmjCommand,
    isTmjMapFile,
    rebindTmjImages,
    tmjFileKind,
    tmjImportProject,
    tmjRequiredFiles,
} from "../../src/core/tmj";
import { importFromWire, importToWire } from "../../src/app/worker/tasks/tmj.task";
import { fileSetOf, findTmjFile, folderSetOf, withAddedFiles } from "../../src/app/tmj/tmjFiles";
import { expectSymmetric, snapshotProject } from "./support/symmetry";
import { png, positionImage } from "./te-022-support";
import { fixtureFiles, fixtureText, importFixture } from "./te-061-support";

// TE-061: the import of a Tiled map into a project (SPEC §13 Into the current project): the
// files a map needs, the one-entry command (do/undo symmetry, cells bound to the slots its
// tilesets take, reused tilesets and images), the new project made with no project open, the
// worker's wire form, and how picked files are found (by path in a folder, else by base name).

function tileLayers(map: ProjectMap): TileLayer[] {
    return [...walkLayers(map.layers)]
        .map((entry) => entry.layer)
        .filter((layer): layer is TileLayer => layer.type === "tile");
}

/** The cells of a map as `x,y → tileset name:tile ID:orientation`, through `project`'s slots. */
function cellsByTileset(project: Project, map: ProjectMap): string[] {
    const bySlot = new Map(project.tilesets.map((tileset) => [tileset.slot, tileset.name]));
    const out: string[] = [];
    for (const layer of tileLayers(map)) {
        for (const chunk of layer.cells.allChunks()) {
            chunk.cells.forEach((value, index) => {
                if (value === 0) return;
                const x = chunk.cx * 32 + (index % 32);
                const y = chunk.cy * 32 + Math.floor(index / 32);
                out.push(
                    `${layer.name} ${x},${y} ${bySlot.get(cellSlot(value))}:${cellTileId(value)}:${value >>> 29}`,
                );
            });
        }
    }
    return out.sort();
}

/** A project of one 4 × 4 map with a grid PNG tileset "other" in slot 1, one cell painted. */
async function projectWithTileset(): Promise<Project> {
    const project = createProject({ name: "Host" });
    const { tileset } = await importGridPng(project, png(positionImage(32, 32)), {
        fileName: "other.png",
        tileWidth: 16,
        tileHeight: 16,
        margin: 0,
        spacing: 0,
    });
    tileset.slot = 1;
    project.tilesets.push(tileset);
    tileLayers(project.maps[0]!)[0]!.cells.set(0, 0, cellValue(1, 2));
    return project;
}

describe("files a map needs", () => {
    it("lists external tilesets, their images, templates and image-layer images", () => {
        expect(tmjRequiredFiles(fixtureText("collection-uniform.tmj"), fixtureFiles())).toEqual([
            { path: "props.tsj", kind: "tileset" },
            { path: "tiles.tsj", kind: "tileset" },
            { path: "images/crate.png", kind: "image" },
            { path: "images/barrel.png", kind: "image" },
            { path: "images/bush.png", kind: "image" },
            { path: "tiles.png", kind: "image" },
        ]);
        expect(tmjRequiredFiles(fixtureText("transparent-color.tmj"), fixtureFiles())).toEqual([
            { path: "keyed.png", kind: "image" },
            { path: "images/backdrop.png", kind: "image" },
        ]);
    });

    it("lists a tileset's images only once its text is given", () => {
        const required = tmjRequiredFiles(
            fixtureText("tileset-tsj.tmj"),
            fixtureFiles(["tiles.tsj"]),
        );
        expect(required).toEqual([{ path: "tiles.tsj", kind: "tileset" }]);
    });

    it("needs nothing of a file that is not a map", () => {
        expect(tmjRequiredFiles("not json", fixtureFiles())).toEqual([]);
        expect(tmjRequiredFiles(fixtureText("tiles.tsj"), fixtureFiles())).toEqual([]);
    });

    it("tells maps from other files by name, and a .json by its type", () => {
        expect(tmjFileKind("Level.TMJ")).toBe("map");
        expect(tmjFileKind("a.tsx")).toBe("tileset");
        expect(tmjFileKind("a.tj")).toBe("template");
        expect(tmjFileKind("a.png")).toBe("image");
        expect(tmjFileKind("a.txt")).toBeNull();
        expect(isTmjMapFile("level.json", () => fixtureText("flips.tmj"))).toBe(true);
        expect(isTmjMapFile("tiles.json", () => fixtureText("tiles.tsj"))).toBe(false);
        expect(isTmjMapFile("broken.json", () => "{")).toBe(false);
    });

    it("refuses an import whose tileset is missing, naming its path", async () => {
        const error = await importFixture(
            "tileset-tsj.tmj",
            undefined,
            fixtureFiles(["tiles.tsj"]),
        ).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(TmjError);
        expect((error as TmjError).code).toBe("missing-file");
        expect((error as TmjError).path).toBe("tiles.tsj");
    });
});

describe("import command", () => {
    it("adds the tilesets, images and map in one entry; undo removes them (symmetry)", async () => {
        const project = await projectWithTileset();
        const history = new History(createProjectSession(project));
        const imported = rebindTmjImages(project, await importFixture("transparent-color.tmj"));
        const command = expectSymmetric(history, importTmjCommand(imported), { rounds: 2 });
        expect(command.label).toBe(IMPORT_TILED_MAP_LABEL);
        expect(history.undoCount).toBe(1);
        expect(project.maps.map((map) => map.name)).toEqual(["Map 1", "transparent-color"]);
        expect(project.tilesets.map((tileset) => [tileset.name, tileset.slot])).toEqual([
            ["other", 1],
            ["keyed", 2],
        ]);
        expect(project.images.map((image) => image.name)).toEqual(["backdrop"]);
        expect(history.session.activeMapId).toBe(imported.map.id);
        history.undo();
        expect(project.maps).toHaveLength(1);
        expect(project.tilesets.map((tileset) => tileset.name)).toEqual(["other"]);
        expect(project.images).toEqual([]);
        expect(history.session.activeMapId).toBe(project.maps[0]!.id);
    });

    it("binds the map's cells to the slots its tilesets take in the project", async () => {
        const alone = tmjImportProject(await importFixture("encoding-csv.tmj"));
        const project = await projectWithTileset();
        const history = new History(createProjectSession(project));
        history.execute(importTmjCommand(await importFixture("encoding-csv.tmj")));
        const map = project.maps.at(-1)!;
        expect(cellsByTileset(project, map)).toEqual(cellsByTileset(alone, alone.maps[0]!));
        // The host's own cell still names its own tileset.
        expect(cellsByTileset(project, project.maps[0]!)).toEqual(["Tile Layer 1 0,0 other:2:0"]);
    });

    it("reuses a tileset imported from the same file before; the map uses its slot", async () => {
        const project = await projectWithTileset();
        const history = new History(createProjectSession(project));
        history.execute(importTmjCommand(await importFixture("tileset-tsj.tmj", project)));
        expect(project.tilesets).toHaveLength(2);
        const second = await importFixture("encoding-csv.tmj", project, fixtureFiles(), "j");
        expect(second.tilesets).toEqual([]);
        expect(second.report.summary.tilesets).toEqual([
            { name: "tiles", tiles: 32, reused: true },
        ]);
        expectSymmetric(history, importTmjCommand(second));
        expect(project.tilesets).toHaveLength(2);
        const map = project.maps.at(-1)!;
        expect(
            new Set(cellsByTileset(project, map).map((cell) => cell.split(" ")[2]!.split(":")[0])),
        ).toEqual(new Set(["tiles"]));
    });

    it("an image with the pixels of a project image shows that one", async () => {
        const project = tmjImportProject(await importFixture("transparent-color.tmj"));
        expect(project.images).toHaveLength(1);
        const again = rebindTmjImages(
            project,
            await importFixture("transparent-color.tmj", project, fixtureFiles(), "j"),
        );
        expect(again.images).toEqual([]);
        const history = new History(createProjectSession(project));
        expectSymmetric(history, importTmjCommand(again));
        const layers = [...walkLayers(project.maps.at(-1)!.layers)].map((entry) => entry.layer);
        const image = layers.find((layer) => layer.type === "image");
        expect(image?.type === "image" && image.imageId).toBe(project.images[0]!.id);
    });

    it("refuses with the project unchanged when an export name was taken since", async () => {
        const project = await projectWithTileset();
        const imported = await importFixture("encoding-csv.tmj", project);
        project.maps[0]!.exportName = imported.map.exportName;
        const before = snapshotProject(project);
        const history = new History(createProjectSession(project));
        expect(() => history.execute(importTmjCommand(imported))).toThrow(TmjError);
        expect(snapshotProject(project)).toStrictEqual(before);
        expect(history.undoCount).toBe(0);
    });
});

describe("import with no project open", () => {
    it.each(["dungeon.tmj", "overworld.tmj", "collection-uniform.tmj", "properties.tmj"])(
        "%s becomes a valid project named after the map",
        async (name) => {
            const imported = await importFixture(name);
            const project = tmjImportProject(imported);
            assertInvariants(project);
            expect(project.name).toBe(imported.map.name);
            expect(project.maps).toEqual([imported.map]);
            expect(project.tilesets.map((tileset: Tileset) => tileset.slot)).toEqual(
                project.tilesets.map((_, index) => index + 1),
            );
        },
    );
});

describe("worker wire form", () => {
    it("carries an import to the page and back unchanged", async () => {
        const imported = await importFixture("overworld.tmj");
        const back = importFromWire(structuredClone(importToWire(imported)));
        const project = tmjImportProject(back);
        const direct = tmjImportProject(await importFixture("overworld.tmj"));
        expect(cellsByTileset(project, project.maps[0]!)).toEqual(
            cellsByTileset(direct, direct.maps[0]!),
        );
        expect(back.report).toEqual(imported.report);
    });
});

describe("picked files", () => {
    const file = (name: string) => ({ name, read: async () => new Uint8Array() });

    it("finds a folder's files by their path from the map, then added files by base name", () => {
        const folder = folderSetOf("Game", [
            { path: "maps/level.tmj", file: file("level.tmj") },
            { path: "tilesets/tiles.tsj", file: file("tiles.tsj") },
            { path: "maps/tiles.tsj", file: file("tiles.tsj") },
            { path: "notes.txt", file: file("notes.txt") },
        ]);
        expect(folder.label).toBe("Folder “Game”");
        expect([...folder.byPath.keys()]).not.toContain("notes.txt");
        expect(findTmjFile(folder, "maps/level.tmj", "../tilesets/tiles.tsj")?.path).toBe(
            "tilesets/tiles.tsj",
        );
        expect(findTmjFile(folder, "maps/level.tmj", "tiles.tsj")?.path).toBe("maps/tiles.tsj");
        expect(findTmjFile(folder, "maps/level.tmj", "../art/tiles.png")).toBeUndefined();
        // As on Windows, where Tiled opens a path whatever its letter case.
        expect(findTmjFile(folder, "maps/level.tmj", "../TileSets/Tiles.tsj")?.path).toBe(
            "tilesets/tiles.tsj",
        );
        const added = withAddedFiles(folder, [file("tiles.png")]);
        expect(findTmjFile(added, "maps/level.tmj", "../art/tiles.png")?.path).toBe("tiles.png");
    });

    it("finds picked or dropped files by base name, whatever their folder in the map", () => {
        const set = fileSetOf([file("level.tmj"), file("Tiles.TSJ"), file("readme.md")]);
        expect(set.label).toBe("2 files");
        expect(findTmjFile(set, "level.tmj", "../shared/tiles.tsj")?.file.name).toBe("Tiles.TSJ");
        expect(findTmjFile(set, "level.tmj", "door.tj")).toBeUndefined();
    });
});
