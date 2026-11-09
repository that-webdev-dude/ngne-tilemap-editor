import type { Command } from "../../core/history";
import {
    imageChoice,
    imageSizeProblem,
    layerImageCommand,
    layerRepeatCommand,
} from "../../core/images";
import type { ImageChoice, ImageRepeat } from "../../core/images";
import { newImageLayerCommand } from "../../core/layers";
import { randomId } from "../../core/model";
import type { Project } from "../../core/model";
import { readPngSize } from "../../core/tileset/pngSize";
import { commandDialogs } from "../dialogs/dialogRequests";
import { activeMap, canAddLayer } from "../layers/layers";
import { sessionStore } from "../state/session";
import type { PickedFile } from "../tilesets/import/importSources";
import { reason } from "../worker/errorReason";
import { backgroundWorker } from "../worker/client";
import type { WorkerClient } from "../worker/client";

// Image layers in the app (SPEC §7.2; TE-036). New Image Layer… asks for the image in its
// dialog: one of the project's images, or a PNG the user picks. A PNG's size is read from its
// header and checked against the pixel limits (FORMAT §2.8) before anything is decoded; within
// them it is decoded in the background worker to straight RGBA8, and a PNG whose pixels equal an
// existing image's chooses that image. The layer popover's image and repeat fields build their
// commands here (ui/layers/layerFields.ts).

/** An image of the project as the dialog and the popover list it. */
export interface ImageOption {
    id: string;
    name: string;
    width: number;
    height: number;
}

/** The project's images, in list order. */
export function imageOptions(project: Project): ImageOption[] {
    return project.images.map(({ id, name, pixels }) => ({
        id,
        name,
        width: pixels.width,
        height: pixels.height,
    }));
}

/** What reading a picked PNG gives: the image to show, or why there is none. */
export type ImageFileResult =
    { ok: true; choice: ImageChoice; option: ImageOption } | { ok: false; problem: string };

/**
 * Reads the PNG `file` for an image layer of the session's project: its size from its header,
 * refused past the pixel limits before decoding; then decoded in `worker`. The result chooses
 * the project's image with the same pixels when there is one, else a new image (not added).
 */
export async function readImageFile(
    file: PickedFile,
    worker: WorkerClient = backgroundWorker,
): Promise<ImageFileResult> {
    let bytes: Uint8Array;
    let size: { width: number; height: number };
    try {
        bytes = await file.read();
        size = readPngSize(bytes);
    } catch (error) {
        return { ok: false, problem: reason(error) };
    }
    const problem = imageSizeProblem(sessionStore.getState().session.project, size);
    if (problem) return { ok: false, problem };
    let pixels;
    try {
        pixels = await worker.run("png.decode", { bytes });
    } catch (error) {
        return { ok: false, problem: `${file.name} cannot be read: ${reason(error)}` };
    }
    const project = sessionStore.getState().session.project;
    const choice = imageChoice(project, file.name, pixels, randomId);
    const image =
        "imageId" in choice
            ? project.images.find((each) => each.id === choice.imageId)!
            : choice.image;
    const option = { id: image.id, name: image.name, width: pixels.width, height: pixels.height };
    return { ok: true, choice, option };
}

/** Adds an image layer showing `choice` above the active layer; returns its ID, or null. */
export function newImageLayer(choice: ImageChoice): number | null {
    const map = activeMap();
    if (!map) return null;
    const { session, history } = sessionStore.getState();
    history.execute(newImageLayerCommand(session.project, map.id, choice));
    return session.perMap.get(map.id)?.activeLayerId ?? null;
}

export interface NewImageLayerRequest {
    kind: "new-image-layer";
    /** The project's images when the dialog opened. */
    images: ImageOption[];
    /** Reads a PNG the user picked (`readImageFile`). */
    readFile(file: PickedFile): Promise<ImageFileResult>;
    /** The image of the new layer, or null to cancel. Closes the dialog. */
    answer(choice: ImageChoice | null): void;
}

/**
 * Layer → New Image Layer…: asks for the image (DESIGN §9), then adds the layer, one history
 * entry with the image when it is new. Resolves the new layer's ID, or null.
 */
export async function newImageLayerFromDialog(): Promise<number | null> {
    const choice = await commandDialogs.open<ImageChoice>((answer): NewImageLayerRequest => ({
        kind: "new-image-layer",
        images: imageOptions(sessionStore.getState().session.project),
        readFile: (file) => readImageFile(file),
        answer,
    }));
    if (!choice || !canAddLayer()) return null;
    return newImageLayer(choice);
}

/** The command of the popover's image field: layer `layerId` shows `choice`. */
export function imageFieldCommand(
    project: Project,
    mapId: string,
    layerId: number,
    choice: ImageChoice,
): Command {
    return layerImageCommand(project, mapId, layerId, choice);
}

/** The command of the popover's repeat field. */
export function repeatFieldCommand(
    project: Project,
    mapId: string,
    layerId: number,
    repeat: ImageRepeat,
): Command {
    return layerRepeatCommand(project, mapId, layerId, repeat);
}
