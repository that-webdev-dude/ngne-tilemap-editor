import { imageAsset, type SceneDefinition, type Sprite } from "@ngne/core";
import {
    ATLAS_URLS,
    IMAGE_URLS,
    TILEMAP_URLS,
    TilemapError,
    assetsFor,
    classAt,
    collisionRects,
    collisionShapes,
    drawTilemap,
    findLayer,
    grid,
    invalidate,
    loadTilemap,
    markers,
    propertyAt,
    readTilemap,
    setCell,
    tileAt,
    validateTilemap,
    type Rect,
    type SpriteLike,
    type TileLayerData,
    type Tilemap,
} from "./ngne-tilemap";

// TE-052: a game that uses the generated runtime (SPEC 11.4). It only has to compile; the compat
// script writes it into each engine folder, with that folder's engine package name in the import
// above (fixture.ts), and builds it there under the settings of BRIEF 6.

/**
 * The engine contract: every sprite field the runtime sets is a field of the engine's `Sprite`
 * that takes the runtime's value. A field the engine renames or retypes stops this compiling.
 */
export function engineSprite(sprite: SpriteLike): Required<Pick<Sprite, keyof SpriteLike>> {
    return sprite;
}

/** The first tile layer of that name, or an error. */
function tileLayer(tilemap: Tilemap, name: string): TileLayerData {
    const layer = findLayer(tilemap, name);
    if (layer === undefined || layer.type !== "tile") throw new Error(`No tile layer ${name}.`);
    return layer;
}

/** Reads a tilemap from JSON the game holds, and reports why it is refused. */
export function readMeadow(json: unknown, atlases: Readonly<Record<string, unknown>>): Tilemap {
    try {
        validateTilemap(json, atlases);
        return readTilemap(json, atlases);
    } catch (error) {
        if (error instanceof TilemapError) {
            throw new Error(`Refused at ${error.path} (${error.code}): ${error.message}`, {
                cause: error,
            });
        }
        throw error;
    }
}

/** The files of the export folder, as the game may list them for a loading screen. */
export const FILES: readonly string[] = [
    TILEMAP_URLS.meadow,
    ATLAS_URLS.grass.json,
    ATLAS_URLS.grass.png,
    ...Object.values(IMAGE_URLS),
];

/** Whether a point is inside a rectangle. */
function inside(rect: Rect, x: number, y: number): boolean {
    return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}

/** The meadow scene: the map with a player between its layers. */
export async function meadowScene(signal?: AbortSignal): Promise<SceneDefinition> {
    const tilemap = await loadTilemap("meadow", signal);
    const ground = tileLayer(tilemap, "ground");
    const spawn = markers(tilemap, { layer: "spawns", name: "player" })[0];
    const player = { x: spawn?.x ?? 0, y: spawn?.y ?? 0 };
    return {
        id: "meadow",
        assets: assetsFor(tilemap, imageAsset),
        setup(scene) {
            let elapsedMs = 0;
            scene.system((context) => {
                elapsedMs += context.dt * 1000;
                const cellX = Math.floor(player.x / tilemap.tileWidth);
                const cellY = Math.floor(player.y / tilemap.tileHeight);
                const at = cellY * tilemap.width + cellX;
                const solid = grid(tilemap, ground, "solid");
                const water = grid(tilemap, ground, (tile) => tile.class === "water");
                const walls = collisionRects(tilemap, ground);
                const slopes = collisionShapes(tilemap, ground).filter(
                    (shape) => shape.shape === "polygon" && shape.cellX === cellX,
                );
                const blocked = walls.some((wall) => inside(wall, player.x, player.y));
                if (solid[at] === 1 || water[at] === 1 || blocked || slopes.length > 0) return;
                const tile = tileAt(tilemap, ground, cellX, cellY);
                const kind = classAt(tilemap, ground, cellX, cellY);
                const speed = propertyAt(tilemap, ground, cellX, cellY, "speed");
                if (tile !== null && !tile.flipD && kind === "grass" && typeof speed === "number") {
                    player.x += speed * context.dt;
                    setCell(tilemap, ground, cellX, cellY, 0);
                    ground.data[at + 1] = 0;
                    invalidate(tilemap, ground);
                }
            });
            scene.render((frame) => {
                drawTilemap(frame, tilemap, scene.camera, {
                    elapsedMs,
                    viewWidth: 480,
                    viewHeight: 270,
                    assets: scene.assets,
                    scale: 1,
                    layer: 0,
                    depth: 0,
                    alpha: 1,
                    color: 0xffffff,
                    layers: (layer, index) => layer.visible && index >= 0,
                    report: (message) => console.warn(message),
                });
                frame.sprite({ x: player.x, y: player.y, width: 16, height: 16, depth: 1.5 });
            });
        },
    };
}
