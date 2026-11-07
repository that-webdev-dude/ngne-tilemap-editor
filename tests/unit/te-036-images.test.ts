import { describe, expect, it } from "vitest";
import type { History } from "../../src/core/history";
import {
    IMAGE_LABELS,
    ImageEditError,
    addImageCommand,
    findSameImage,
    imageChoice,
    imageNameFromFile,
    imageSizeProblem,
    layerImageCommand,
    layerRepeatCommand,
    samePixels,
} from "../../src/core/images";
import type { ImageChoice } from "../../src/core/images";
import {
    LAYER_LABELS,
    deleteLayersCommand,
    groupLayersCommand,
    newImageLayerCommand,
    newLayerName,
} from "../../src/core/layers";
import { deleteMapCommand, duplicateMapCommand, MAP_LABELS } from "../../src/core/maps";
import {
    MAX_IMAGES,
    MAX_IMAGE_PIXELS,
    findLayer,
    sequentialIds,
    walkLayers,
} from "../../src/core/model";
import type { ImageLayer, PixelBuffer, Project, ProjectImage } from "../../src/core/model";
import { expectSymmetric, snapshotProject } from "./support/symmetry";
import { MAP, execute, redo, setup, undo } from "./te-006-support";

// TE-036: the project's images (SPEC §7.2, FORMAT §2.4): a PNG whose pixels equal an existing
// image's reuses it; an image that no layer of any map uses any more is removed by the command
// that removed its last use, and undo restores both; every command passes the TE-006 symmetry
// harness. The map of `setup` is 8 × 8 with one tile layer (ID 1), active.

/** A `width × height` image whose pixels depend on `seed`. */
function pixels(width: number, height: number, seed = 0): PixelBuffer {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 1) data[i] = (i * 7 + seed * 31) & 255;
    return { width, height, data };
}

/** A new image for `project` from a PNG named `fileName` with `buffer` (not added). */
function newImage(project: Project, fileName: string, buffer: PixelBuffer): ProjectImage {
    const choice = imageChoice(project, fileName, buffer, sequentialIds("img"));
    if (!("image" in choice)) throw new Error("expected a new image");
    return choice.image;
}

function images(history: History): string[] {
    return history.session.project.images.map((image) => image.name);
}

function imageLayers(history: History, mapIndex = 0): ImageLayer[] {
    const map = history.session.project.maps[mapIndex]!;
    return [...walkLayers(map.layers)]
        .map((entry) => entry.layer)
        .filter((layer): layer is ImageLayer => layer.type === "image");
}

/** Adds an image layer showing a new image named `name`; returns the layer's ID. */
function addImageLayer(history: History, name: string, seed: number, mapId = MAP): number {
    const { project } = history.session;
    const choice: ImageChoice = { image: newImage(project, `${name}.png`, pixels(4, 3, seed)) };
    execute(history, newImageLayerCommand(project, mapId, choice));
    return history.session.perMap.get(mapId)!.activeLayerId;
}

describe("images: names, limits and dedupe by pixels", () => {
    it("names an image after its file and makes its export name a unique slug", () => {
        expect(imageNameFromFile("Far Hills.png")).toBe("Far Hills");
        expect(imageNameFromFile("C:\\art\\sky.PNG")).toBe("sky");
        expect(imageNameFromFile(".png")).toBe("Image");
        const history = setup();
        const { project } = history.session;
        // The map's export name is "map-1": a file named as the map gets "map-1-2".
        expect(project.maps[0]!.exportName).toBe("map-1");
        const image = newImage(project, "Map 1.png", pixels(2, 2));
        expect(image.name).toBe("Map 1");
        expect(image.exportName).toBe("map-1-2");
    });

    it("a PNG whose pixels equal an existing image's chooses that image", () => {
        const history = setup();
        addImageLayer(history, "hills", 1);
        const { project } = history.session;
        const [hills] = project.images;
        // The same pixels in another buffer, at an offset that is not a multiple of 4.
        const copy = new Uint8ClampedArray(hills!.pixels.data.length + 1);
        copy.set(hills!.pixels.data, 1);
        const shifted: PixelBuffer = { width: 4, height: 3, data: copy.subarray(1) };
        expect(samePixels(shifted, hills!.pixels)).toBe(true);
        expect(findSameImage(project, shifted)).toBe(hills);
        expect(imageChoice(project, "other name.png", shifted, sequentialIds("x"))).toEqual({
            imageId: hills!.id,
        });

        // One byte differs, or the same bytes in another shape: a new image.
        const changed = pixels(4, 3, 1);
        changed.data[5] = (changed.data[5]! + 1) & 255;
        expect(findSameImage(project, changed)).toBeNull();
        expect(findSameImage(project, { ...pixels(4, 3, 1), width: 3, height: 4 })).toBeNull();
        expect("image" in imageChoice(project, "b.png", changed, sequentialIds("x"))).toBe(true);
    });

    it("a second image layer from the same PNG adds no image", () => {
        const history = setup();
        addImageLayer(history, "hills", 1);
        const { project } = history.session;
        const choice = imageChoice(project, "hills.png", pixels(4, 3, 1), sequentialIds("y"));
        expectSymmetric(history, newImageLayerCommand(project, MAP, choice));
        expect(images(history)).toEqual(["hills"]);
        expect(imageLayers(history).map((layer) => layer.imageId)).toEqual([
            project.images[0]!.id,
            project.images[0]!.id,
        ]);
    });

    it("checks the pixel limits of FORMAT §2.8 from the size alone", () => {
        const { project } = setup().session;
        expect(imageSizeProblem(project, { width: 8192, height: 8192 })).toBeNull();
        expect(imageSizeProblem(project, { width: 8193, height: 16 })).toBe(
            "The image is 8193 × 16 px; an image is at most 8192 px a side.",
        );
        expect(imageSizeProblem(project, { width: 16, height: 9000 })).toContain("8192 px a side");
        // All images together: at most 64 MP.
        project.images.push({
            id: "big",
            name: "big",
            exportName: "big",
            pixels: { width: 8192, height: 8191, data: new Uint8ClampedArray(0) },
        });
        expect(imageSizeProblem(project, { width: 8192, height: 1 })).toBeNull();
        expect(imageSizeProblem(project, { width: 8192, height: 2 })).toBe(
            `All images together would hold ${(MAX_IMAGE_PIXELS + 8192).toLocaleString("en")} px; ` +
                `the most is ${MAX_IMAGE_PIXELS.toLocaleString("en")} px.`,
        );
        project.images.length = 0;
        for (let i = 0; i < MAX_IMAGES; i += 1) {
            project.images.push({
                id: `i${i}`,
                name: "i",
                exportName: `i${i}`,
                pixels: { width: 1, height: 1, data: new Uint8ClampedArray(4) },
            });
        }
        expect(imageSizeProblem(project, { width: 1, height: 1 })).toBe(
            "The project holds 256 images, the most it can.",
        );
    });

    it("refuses an image that cannot join the project, with the project unchanged", () => {
        const history = setup();
        const { project } = history.session;
        const image = newImage(project, "a.png", pixels(2, 2));
        const before = snapshotProject(project);
        const taken = { ...image, exportName: project.maps[0]!.exportName };
        expect(() => history.execute(addImageCommand(taken))).toThrow(ImageEditError);
        const sameId = { ...image, id: project.maps[0]!.id.toUpperCase() };
        expect(() => history.execute(addImageCommand(sameId))).toThrow(/is taken/);
        const huge = {
            ...image,
            pixels: { width: 9000, height: 1, data: new Uint8ClampedArray(36000) },
        };
        expect(() => history.execute(addImageCommand(huge))).toThrow(/8192 px a side/);
        expect(snapshotProject(project)).toStrictEqual(before);
    });
});

describe("New Image Layer", () => {
    it("adds the layer above the active one with its new image, one step that undo removes", () => {
        const history = setup();
        const { project } = history.session;
        const image = newImage(project, "sky.png", pixels(4, 3, 2));
        const command = expectSymmetric(history, newImageLayerCommand(project, MAP, { image }));
        expect(command.label).toBe(IMAGE_LABELS.newImageLayer);
        expect(history.undoLabel).toBe("New Image Layer");
        expect(images(history)).toEqual(["sky"]);
        const map = project.maps[0]!;
        // Tiled's `newLayerName`: "Image Layer N".
        expect(map.layers.map((layer) => [layer.type, layer.name])).toEqual([
            ["tile", "Tile Layer 1"],
            ["image", "Image Layer 1"],
        ]);
        const layer = map.layers[1] as ImageLayer;
        expect(layer).toMatchObject({ imageId: image.id, repeatX: false, repeatY: false });
        expect(history.session.perMap.get(MAP)!.activeLayerId).toBe(layer.id);
        expect(newLayerName(map, "image")).toBe("Image Layer 2");

        undo(history);
        expect(images(history)).toEqual([]);
        expect(map.layers).toHaveLength(1);
        redo(history);
        expect(images(history)).toEqual(["sky"]);
    });

    it("with an image of the project, adds no image", () => {
        const history = setup();
        addImageLayer(history, "sky", 2);
        const { project } = history.session;
        const id = project.images[0]!.id;
        expectSymmetric(history, newImageLayerCommand(project, MAP, { imageId: id }));
        expect(images(history)).toEqual(["sky"]);
        expect(imageLayers(history).map((layer) => layer.name)).toEqual([
            "Image Layer 1",
            "Image Layer 2",
        ]);
    });

    it("refuses an image the project does not have, with the project unchanged", () => {
        const history = setup();
        const { project } = history.session;
        const before = snapshotProject(project);
        expect(() =>
            history.execute(newImageLayerCommand(project, MAP, { imageId: "nothing" })),
        ).toThrow();
        expect(snapshotProject(project)).toStrictEqual(before);
    });
});

describe("an image is removed with its last use", () => {
    it("Delete Layer of the last layer that shows it removes it; undo restores both", () => {
        const history = setup();
        const sky = addImageLayer(history, "sky", 2);
        const hills = addImageLayer(history, "hills", 3);
        const { project } = history.session;
        expect(images(history)).toEqual(["sky", "hills"]);
        const command = expectSymmetric(history, deleteLayersCommand(project, MAP, [sky]));
        expect(command.label).toBe(LAYER_LABELS.delete);
        expect(images(history)).toEqual(["hills"]);
        expect(imageLayers(history).map((layer) => layer.id)).toEqual([hills]);
        undo(history);
        // Back at its place in the list.
        expect(images(history)).toEqual(["sky", "hills"]);
        expect(findLayer(project.maps[0]!, sky)).toBeDefined();
    });

    it("keeps an image another layer still shows, in this map or another", () => {
        const history = setup();
        const first = addImageLayer(history, "sky", 2);
        const { project } = history.session;
        const id = project.images[0]!.id;
        execute(history, newImageLayerCommand(project, MAP, { imageId: id }));
        expectSymmetric(history, deleteLayersCommand(project, MAP, [first]));
        expect(images(history)).toEqual(["sky"]);

        // A copy of the map shows it too: deleting the original map keeps the image.
        execute(history, duplicateMapCommand(project, MAP, sequentialIds("copy")));
        const command = expectSymmetric(history, deleteMapCommand(project, MAP));
        expect(command.label).toBe(MAP_LABELS.delete);
        expect(images(history)).toEqual(["sky"]);
    });

    it("Delete Layer of a group removes the images only its children showed", () => {
        const history = setup();
        const sky = addImageLayer(history, "sky", 2);
        const hills = addImageLayer(history, "hills", 3);
        const { project } = history.session;
        execute(history, groupLayersCommand(MAP, [sky, hills]));
        const group = project.maps[0]!.layers.find((layer) => layer.type === "group")!;
        expectSymmetric(history, deleteLayersCommand(project, MAP, [group.id]));
        expect(images(history)).toEqual([]);
        undo(history);
        expect(images(history)).toEqual(["sky", "hills"]);
    });

    it("Delete Map removes the images only that map showed", () => {
        const history = setup();
        const { project } = history.session;
        execute(history, duplicateMapCommand(project, MAP, sequentialIds("copy")));
        const other = project.maps[1]!.id;
        addImageLayer(history, "sky", 2, other);
        addImageLayer(history, "sea", 4, MAP);
        expectSymmetric(history, deleteMapCommand(project, other));
        expect(images(history)).toEqual(["sea"]);
        undo(history);
        expect(images(history)).toEqual(["sky", "sea"]);
    });

    it("a new image of a layer removes the one it showed when nothing else uses it", () => {
        const history = setup();
        const layerId = addImageLayer(history, "sky", 2);
        const { project } = history.session;
        const sky = project.images[0]!;
        const sea = newImage(project, "sea.png", pixels(5, 5, 9));
        const command = expectSymmetric(
            history,
            layerImageCommand(project, MAP, layerId, { image: sea }),
        );
        expect(command.label).toBe(IMAGE_LABELS.image);
        expect(images(history)).toEqual(["sea"]);
        expect(imageLayers(history)[0]!.imageId).toBe(sea.id);
        undo(history);
        expect(project.images).toEqual([sky]);
        expect(imageLayers(history)[0]!.imageId).toBe(sky.id);
        redo(history);

        // Back to an image of the project that another layer keeps: nothing is removed.
        const keeper = addImageLayer(history, "dune", 5);
        const dune = project.images.find((image) => image.name === "dune")!;
        expectSymmetric(history, layerImageCommand(project, MAP, layerId, { imageId: dune.id }));
        expect(images(history)).toEqual(["dune"]);
        expect(findLayer(project.maps[0]!, keeper)).toBeDefined();
    });

    it("Repeat X and Y are one step each way", () => {
        const history = setup();
        const layerId = addImageLayer(history, "sky", 2);
        const { project } = history.session;
        const command = expectSymmetric(
            history,
            layerRepeatCommand(project, MAP, layerId, { repeatX: true, repeatY: false }),
        );
        expect(command.label).toBe(IMAGE_LABELS.repeat);
        expect(command.touched).toEqual({
            mapId: MAP,
            layerIds: [layerId],
            cellRects: [],
            tilesetIds: [],
            structure: false,
        });
        expect(imageLayers(history)[0]).toMatchObject({ repeatX: true, repeatY: false });
        expectSymmetric(
            history,
            layerRepeatCommand(project, MAP, layerId, { repeatX: true, repeatY: true }),
        );
        expect(imageLayers(history)[0]).toMatchObject({ repeatX: true, repeatY: true });
        expect(() => layerRepeatCommand(project, MAP, 1, { repeatX: true, repeatY: true })).toThrow(
            ImageEditError,
        );
    });
});
