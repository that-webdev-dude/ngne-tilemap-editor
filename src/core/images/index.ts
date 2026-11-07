// The project's images and the commands of image layers (SPEC §7.2).

export {
    IMAGE_LABELS,
    ImageEditError,
    addImageCommand,
    choiceImageId,
    findSameImage,
    imageChoice,
    imageLayerOf,
    imageNameFromFile,
    imagePixels,
    imageSizeProblem,
    imagesOfLayers,
    layerImageCommand,
    layerRepeatCommand,
    removeUnusedImagesCommand,
    samePixels,
    usedImages,
    withUnusedImagesRemoved,
} from "./images";
export type { ImageChoice, ImageEditErrorCode, ImageRepeat } from "./images";
