// The command module's value import, not `core/history`'s index, which reads `import.meta.env`.
import { compositeCommand } from "../history/command";
import type { Command, Touched } from "../history";
import {
    MAX_IMAGES,
    MAX_IMAGE_PIXELS,
    MAX_IMAGE_SIDE,
    MAX_TEXT_LENGTH,
    exportNames,
    findLayer,
    idKey,
    isId,
    isSlug,
    pixelBytes,
    uniqueSlug,
    walkLayers,
} from "../model";
import type {
    IdGenerator,
    ImageLayer,
    Layer,
    PixelBuffer,
    Project,
    ProjectImage,
    ProjectMap,
} from "../model";

// The project's images (SPEC §7.2, FORMAT §2.4 Image): what image layers draw. An image comes from
// a PNG decoded to straight RGBA8; a PNG whose pixels equal an existing image's reuses that image,
// so the project holds each picture once. An image that no layer of any map uses any more is
// removed by the command that removed its last use, and undo puts it back (`withUnusedImagesRemoved`).
//
// Images are not drawn by the chunk tier's chunks, so adding or removing one is not a structural
// change of a map (`Touched.structure`): the image layers that show it name themselves.

export type ImageEditErrorCode =
    /** The command names a map, layer or image that does not exist, or a layer of another kind. */
    | "missing"
    /** The image would break a limit of FORMAT §2.8: side, count, pixels of all images, names. */
    | "limit";

export class ImageEditError extends Error {
    override readonly name = "ImageEditError";
    readonly code: ImageEditErrorCode;

    constructor(code: ImageEditErrorCode, message: string) {
        super(message);
        this.code = code;
    }
}

/** Labels of the history entries. */
export const IMAGE_LABELS = {
    newImageLayer: "New Image Layer",
    image: "Layer Image",
    repeat: "Layer Repeat",
    addImage: "Add Image",
} as const;

/** Bytes a command claims besides the pixels it holds. */
const OVERHEAD_BYTES = 256;

function touched(mapId: string | null, layerIds: number[] = []): Touched {
    return { mapId, layerIds, cellRects: [], tilesetIds: [], structure: false };
}

function format(value: number): string {
    return value.toLocaleString("en");
}

/** Pixels of all images of the project. */
export function imagePixels(project: Project): number {
    let total = 0;
    for (const image of project.images) total += image.pixels.width * image.pixels.height;
    return total;
}

/**
 * Why an image of `size` cannot join `project` (FORMAT §2.8): a side above 8192 px, the
 * project's 256 images, or all images together past 64 MP. Checked from the PNG's header,
 * before any pixel is decoded; null when it can join.
 */
export function imageSizeProblem(
    project: Project,
    size: { width: number; height: number },
): string | null {
    const { width, height } = size;
    if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) {
        return `The image is ${width} × ${height} px; an image is at most ${MAX_IMAGE_SIDE} px a side.`;
    }
    if (project.images.length >= MAX_IMAGES) {
        return `The project holds ${MAX_IMAGES} images, the most it can.`;
    }
    const total = imagePixels(project) + width * height;
    if (total > MAX_IMAGE_PIXELS) {
        return (
            `All images together would hold ${format(total)} px; ` +
            `the most is ${format(MAX_IMAGE_PIXELS)} px.`
        );
    }
    return null;
}

/** The name of an image made from file `fileName`: the name without its `.png`. */
export function imageNameFromFile(fileName: string): string {
    const base = fileName.split(/[\\/]/).pop() ?? "";
    const name = base.replace(/\.png$/i, "").trim();
    return (name === "" ? "Image" : name).slice(0, MAX_TEXT_LENGTH);
}

/** Whether two pixel buffers hold the same pixels: the same size and the same bytes. */
export function samePixels(a: PixelBuffer, b: PixelBuffer): boolean {
    if (a === b) return true;
    if (a.width !== b.width || a.height !== b.height) return false;
    const { data: x } = a;
    const { data: y } = b;
    if (x.length !== y.length) return false;
    if (x.byteOffset % 4 === 0 && y.byteOffset % 4 === 0) {
        const words = x.length >> 2;
        const wx = new Uint32Array(x.buffer, x.byteOffset, words);
        const wy = new Uint32Array(y.buffer, y.byteOffset, words);
        for (let i = 0; i < words; i += 1) if (wx[i] !== wy[i]) return false;
        for (let i = words << 2; i < x.length; i += 1) if (x[i] !== y[i]) return false;
        return true;
    }
    for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return false;
    return true;
}

/** The project's image with exactly `pixels`; null when none has them. */
export function findSameImage(project: Project, pixels: PixelBuffer): ProjectImage | null {
    return project.images.find((image) => samePixels(image.pixels, pixels)) ?? null;
}

/**
 * What a new image layer, or a new image of a layer, shows: an image of the project by its ID,
 * or a new image to add with it.
 */
export type ImageChoice = { imageId: string } | { image: ProjectImage };

/** The ID of the image a choice shows. */
export function choiceImageId(choice: ImageChoice): string {
    return "imageId" in choice ? choice.imageId : choice.image.id;
}

/**
 * The choice for a decoded PNG named `fileName`: the project's image with the same pixels, else
 * a new image (not added) named from the file, its export name the name's slug made unique
 * among the project's export names, its ID from `newId` and unused by the project.
 */
export function imageChoice(
    project: Project,
    fileName: string,
    pixels: PixelBuffer,
    newId: IdGenerator,
): ImageChoice {
    const same = findSameImage(project, pixels);
    if (same) return { imageId: same.id };
    const taken = new Set([
        idKey(project.id),
        ...project.maps.map((map) => idKey(map.id)),
        ...project.tilesets.map((tileset) => idKey(tileset.id)),
        ...project.images.map((image) => idKey(image.id)),
    ]);
    let id = newId();
    while (taken.has(idKey(id))) id = newId();
    const name = imageNameFromFile(fileName);
    return {
        image: {
            id,
            name,
            exportName: uniqueSlug(name, exportNames(project), "image"),
            pixels,
        },
    };
}

/** Throws `ImageEditError` ("limit") when `image` cannot join `project` (FORMAT §2.4, §2.8). */
function checkNewImage(project: Project, image: ProjectImage): void {
    const { width, height, data } = image.pixels;
    if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width < 1 ||
        height < 1 ||
        data.length !== width * height * 4
    ) {
        throw new ImageEditError("limit", `The image's pixels are not ${width} × ${height} px.`);
    }
    const problem = imageSizeProblem(project, image.pixels);
    if (problem) throw new ImageEditError("limit", problem);
    if (!isId(image.id)) throw new ImageEditError("limit", `"${image.id}" is not an ID.`);
    const key = idKey(image.id);
    const ids = [
        project.id,
        ...project.maps.map((map) => map.id),
        ...project.tilesets.map((tileset) => tileset.id),
        ...project.images.map((each) => each.id),
    ];
    if (ids.some((id) => idKey(id) === key)) {
        throw new ImageEditError("limit", `The ID "${image.id}" is taken.`);
    }
    if (!isSlug(image.exportName) || exportNames(project).includes(image.exportName)) {
        throw new ImageEditError(
            "limit",
            `The export name ${JSON.stringify(image.exportName)} is taken or not a slug.`,
        );
    }
    if (image.name.trim() === "" || image.name.length > MAX_TEXT_LENGTH) {
        throw new ImageEditError("limit", "An image's name is non-blank text.");
    }
}

/**
 * The command that adds `image` at the end of the project's images. Its `do` throws
 * `ImageEditError` ("limit") with the project unchanged when the image cannot join it.
 */
export function addImageCommand(image: ProjectImage): Command {
    const bytes = pixelBytes(image.pixels);
    return {
        label: IMAGE_LABELS.addImage,
        bytes: OVERHEAD_BYTES + bytes,
        projectBytes: bytes,
        touched: touched(null),
        do(session) {
            checkNewImage(session.project, image);
            session.project.images.push(image);
        },
        undo(session) {
            const { images } = session.project;
            const index = images.indexOf(image);
            if (index >= 0) images.splice(index, 1);
        },
    };
}

/** The IDs of the images the image layers of `layers` (and their children) show. */
export function imagesOfLayers(layers: readonly Layer[]): Set<string> {
    const ids = new Set<string>();
    for (const { layer } of walkLayers(layers)) {
        if (layer.type === "image") ids.add(layer.imageId);
    }
    return ids;
}

/** The IDs of the images some image layer of some map of the project shows. */
export function usedImages(project: Project): Set<string> {
    const ids = new Set<string>();
    for (const map of project.maps) for (const id of imagesOfLayers(map.layers)) ids.add(id);
    return ids;
}

/**
 * The command that removes the images of `candidates` that no layer of any map uses (SPEC §7.2).
 * Its `do` looks at the project as it is then; undo puts the removed images back at their
 * places. Only the candidates are looked at: the images whose last use the command it follows
 * may have removed.
 */
export function removeUnusedImagesCommand(project: Project, candidates: Iterable<string>): Command {
    const ids = new Set(candidates);
    let bytes = 0;
    for (const image of project.images) if (ids.has(image.id)) bytes += pixelBytes(image.pixels);
    let removed: { index: number; image: ProjectImage }[] = [];
    return {
        label: "Remove Unused Images",
        bytes: OVERHEAD_BYTES + bytes,
        touched: touched(null),
        do(session) {
            const { images } = session.project;
            const used = usedImages(session.project);
            removed = [];
            for (let index = images.length - 1; index >= 0; index -= 1) {
                const image = images[index]!;
                if (!ids.has(image.id) || used.has(image.id)) continue;
                removed.unshift({ index, image });
                images.splice(index, 1);
            }
        },
        undo(session) {
            const { images } = session.project;
            for (const { index, image } of removed) images.splice(index, 0, image);
            removed = [];
        },
    };
}

/**
 * `command` followed by the removal of the images of `candidates` it leaves unused, one step
 * under `command`'s label. `candidates` are the images whose last use `command` may remove;
 * without any, `command` itself.
 */
export function withUnusedImagesRemoved(
    project: Project,
    command: Command,
    candidates: Iterable<string>,
): Command {
    const ids = [...candidates];
    if (ids.length === 0) return command;
    return compositeCommand(command.label, [command, removeUnusedImagesCommand(project, ids)]);
}

function mapOf(project: Project, id: string): ProjectMap {
    const map = project.maps.find((each) => each.id === id);
    if (!map) throw new ImageEditError("missing", `The project has no map "${id}".`);
    return map;
}

/** Image layer `layerId` of map `mapId`; throws `ImageEditError` ("missing") without one. */
export function imageLayerOf(project: Project, mapId: string, layerId: number): ImageLayer {
    const layer = findLayer(mapOf(project, mapId), layerId)?.layer;
    if (!layer || layer.type !== "image") {
        throw new ImageEditError("missing", `The map has no image layer ${layerId}.`);
    }
    return layer;
}

/** The command that sets the image of image layer `layerId`, an image of the project at `do`. */
function setLayerImageCommand(mapId: string, layerId: number, imageId: string): Command {
    let before: string | null = null;
    return {
        label: IMAGE_LABELS.image,
        bytes: OVERHEAD_BYTES,
        touched: touched(mapId, [layerId]),
        do(session) {
            const layer = imageLayerOf(session.project, mapId, layerId);
            if (!session.project.images.some((image) => image.id === imageId)) {
                throw new ImageEditError("missing", `The project has no image "${imageId}".`);
            }
            before = layer.imageId;
            layer.imageId = imageId;
        },
        undo(session) {
            if (before === null) return;
            imageLayerOf(session.project, mapId, layerId).imageId = before;
        },
    };
}

/**
 * The command that makes image layer `layerId` of map `mapId` show `choice`, one step: the new
 * image added first when it is one, the layer changed, and the image it showed removed when no
 * layer uses it any more. Throws `ImageEditError` ("missing") without such a layer.
 */
export function layerImageCommand(
    project: Project,
    mapId: string,
    layerId: number,
    choice: ImageChoice,
): Command {
    const layer = imageLayerOf(project, mapId, layerId);
    const parts: Command[] = [];
    if ("image" in choice) parts.push(addImageCommand(choice.image));
    parts.push(setLayerImageCommand(mapId, layerId, choiceImageId(choice)));
    parts.push(removeUnusedImagesCommand(project, [layer.imageId]));
    return compositeCommand(IMAGE_LABELS.image, parts);
}

/** Whether an image layer repeats its image along x and y (FORMAT §3.4). */
export interface ImageRepeat {
    repeatX: boolean;
    repeatY: boolean;
}

/** The command that sets `repeat` on image layer `layerId` of map `mapId`. */
export function layerRepeatCommand(
    project: Project,
    mapId: string,
    layerId: number,
    repeat: ImageRepeat,
): Command {
    imageLayerOf(project, mapId, layerId);
    let before: ImageRepeat | null = null;
    return {
        label: IMAGE_LABELS.repeat,
        bytes: OVERHEAD_BYTES,
        touched: touched(mapId, [layerId]),
        do(session) {
            const layer = imageLayerOf(session.project, mapId, layerId);
            before = { repeatX: layer.repeatX, repeatY: layer.repeatY };
            layer.repeatX = repeat.repeatX;
            layer.repeatY = repeat.repeatY;
        },
        undo(session) {
            if (!before) return;
            Object.assign(imageLayerOf(session.project, mapId, layerId), before);
        },
    };
}
