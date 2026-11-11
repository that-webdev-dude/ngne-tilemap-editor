import { CellConversionError, assignFirstGids, valueToGid } from "../../core/cells";
import type { CellRect, GidTable } from "../../core/cells";
import { evenImage } from "../../core/export";
import type { Touched } from "../../core/history";
import { findLayer } from "../../core/model";
import type { PixelBuffer, Project, ProjectMap, Tileset } from "../../core/model";
import type { PackedTileset } from "../../core/pack";
import { invalidate, readTilemap } from "../../core/runtime/runtime";
import type { TileLayerData, Tilemap } from "../../core/runtime/runtime";
import { tilemapFor } from "../../core/tilemap";
import type { PreviewContent, PreviewTexture } from "../../engine/preview";
import type { PackFn } from "../../engine/viewport";
import { slotsInMap } from "../viewport/mapTilesets";

// What the game preview draws (SPEC §12): one `Tilemap` of the current map, built by
// `tilemapFor` and `readTilemap` as a game loads it, with its tilesets packed in memory by
// `core/pack` (no files) and its images as the export writes them. A command's `touched` (SPEC
// §3) updates it before the next preview frame:
//
// - cells of the current map: written into the layer's `data` (as GIDs), the layer
//   `invalidate`d;
// - any other change of the map (layers, groups, markers, properties, size) or of the project:
//   the `Tilemap` is built again;
// - a tileset change: built again with the tileset packed again, under a new textures key, so
//   the preview restarts its scene with the new pixels.

/** The ID `drawTilemap` names a tileset's or an image's texture by (SPEC §11.2). */
export function previewTextureId(project: Project, exportName: string): string {
    return `ngne-tilemap:${project.exportName}/${exportName}`;
}

export interface PreviewSourceOptions {
    /** Packs a tileset (`packTileset`, in the worker or here). */
    pack: PackFn;
    /** A new content; null while there is nothing to draw. */
    onContent(content: PreviewContent | null): void;
    /** Cells of the current content's tilemap were written in place. */
    onCells(): void;
    /** Why the map cannot be previewed (a pack or a read failed). */
    onError(message: string): void;
}

/** What the source keeps of its last build. */
interface Built {
    readonly content: PreviewContent;
    /** The project (`#generation`) and map it was built from. */
    readonly generation: number;
    readonly mapId: string;
    readonly width: number;
    readonly height: number;
    readonly table: GidTable;
    /** The tile layers of the tilemap, by layer ID. */
    readonly tileLayers: ReadonlyMap<number, TileLayerData>;
}

interface PackEntry {
    readonly revision: number;
    /** The tileset's animations when it was packed (`animationKey`): the atlas holds them. */
    readonly animations: string;
    readonly promise: Promise<PackedTileset>;
    value: PackedTileset | null;
    /** The pack failed: it is tried again when the tileset changes, not at every build. */
    failed: boolean;
}

/**
 * The animations of a tileset's tiles, as text. Their commands change no pixels and name no
 * tileset in `touched` (`core/tileset/animationCommands.ts`), but the atlas `drawTilemap` plays
 * them from is made by the pack, so a change of this text packs the tileset again.
 */
function animationKey(tileset: Tileset): string {
    const animated = tileset.tiles.filter((tile) => tile.animation.length > 0);
    return JSON.stringify(animated.map((tile) => [tile.id, tile.animation]));
}

/** The tile layers of `tilemap` by ID. */
function tileLayersOf(tilemap: Tilemap): Map<number, TileLayerData> {
    const layers = new Map<number, TileLayerData>();
    for (const layer of tilemap.layers) if (layer.type === "tile") layers.set(layer.id, layer);
    return layers;
}

/** The frame durations of every animated tile of `tilesets`. */
function animationsOf(tilesets: readonly Tileset[]): number[][] {
    const out: number[][] = [];
    for (const tileset of tilesets) {
        for (const tile of tileset.tiles) {
            if (tile.animation.length > 1) out.push(tile.animation.map((frame) => frame.ms));
        }
    }
    return out;
}

export class PreviewSource {
    readonly #options: PreviewSourceOptions;
    #project: Project | null = null;
    #mapId: string | null = null;
    /** Counts projects: textures keys of another project never match. */
    #generation = 0;
    /** Per tileset ID, how often its pixels or tiles changed. */
    readonly #revisions = new Map<string, number>();
    readonly #packs = new Map<string, PackEntry>();
    /** Numbers image pixel buffers, which change identity when an image changes. */
    readonly #imageVersions = new WeakMap<PixelBuffer, number>();
    #imageVersion = 0;
    #built: Built | null = null;
    /** A build waits for packs; it reads the project when they are done. */
    #waiting = false;
    #disposed = false;

    constructor(options: PreviewSourceOptions) {
        this.#options = options;
    }

    /** The content of the last build; null before one or while nothing can be drawn. */
    get content(): PreviewContent | null {
        return this.#built?.content ?? null;
    }

    /**
     * Shows map `mapId` of `project` (null: none). Another project starts over: its tilesets
     * are packed again and its textures keys are new.
     */
    show(project: Project | null, mapId: string | null): void {
        if (project !== this.#project) {
            this.#project = project;
            this.#generation += 1;
            this.#revisions.clear();
            this.#packs.clear();
            this.#mapId = mapId;
            this.#build();
            return;
        }
        if (mapId === this.#mapId) return;
        this.#mapId = mapId;
        this.#build();
    }

    /** A step of the project's history, or cells a stroke wrote (SPEC §3). */
    touched(touched: Touched): void {
        const project = this.#project;
        if (!project || this.#disposed) return;
        for (const id of touched.tilesetIds) {
            this.#revisions.set(id, (this.#revisions.get(id) ?? 0) + 1);
            this.#packs.delete(id);
        }
        if (touched.structure || touched.tilesetIds.length > 0 || touched.mapId === null) {
            this.#build();
            return;
        }
        if (touched.mapId !== this.#mapId) return;
        if (touched.cellRects.length > 0 && this.#writeCells(touched)) {
            this.#options.onCells();
            return;
        }
        this.#build();
    }

    dispose(): void {
        this.#disposed = true;
    }

    /**
     * Writes the cells of `touched` into the tilemap's layers. False when they cannot be
     * written in place (a layer the tilemap lacks, a tileset it does not list, a build waiting):
     * the tilemap is built again instead.
     */
    #writeCells(touched: Touched): boolean {
        const built = this.#built;
        const project = this.#project;
        if (!built || !project || this.#waiting || built.mapId !== this.#mapId) return false;
        const map = project.maps.find((each) => each.id === built.mapId);
        if (!map || map.width !== built.width || map.height !== built.height) return false;
        const ids = touched.layerIds.length > 0 ? touched.layerIds : [...built.tileLayers.keys()];
        const writes: { cells: (x: number, y: number) => number; data: TileLayerData }[] = [];
        for (const id of ids) {
            const data = built.tileLayers.get(id);
            const layer = findLayer(map, id)?.layer;
            if (!data || layer?.type !== "tile") return false;
            writes.push({ cells: (x, y) => layer.cells.get(x, y), data });
        }
        const rects = touched.cellRects.map((rect) => clip(rect, map));
        try {
            for (const { cells, data } of writes) {
                for (const rect of rects) {
                    if (!rect) continue;
                    for (let y = rect.y; y < rect.y + rect.height; y += 1) {
                        for (let x = rect.x; x < rect.x + rect.width; x += 1) {
                            data.data[y * map.width + x] = valueToGid(cells(x, y), built.table);
                        }
                    }
                }
                invalidate(built.content.tilemap, data);
            }
        } catch (error) {
            if (error instanceof CellConversionError) return false;
            throw error;
        }
        return true;
    }

    /** Builds the content of the current map, once the packs it needs are ready. */
    #build(): void {
        if (this.#disposed) return;
        const project = this.#project;
        const map = project?.maps.find((each) => each.id === this.#mapId);
        if (!project || !map) {
            this.#publish(null);
            return;
        }
        // The tilesets the map's cells may use; the tilemap lists those inside the map.
        const slots = slotsInMap(map);
        const used = project.tilesets.filter((tileset) => slots.has(tileset.slot));
        const pending: Promise<PackedTileset>[] = [];
        for (const tileset of used) {
            const entry = this.#pack(tileset);
            if (entry.failed) {
                // Reported when it failed; nothing is drawn until the tileset changes.
                this.#publish(null);
                return;
            }
            if (!entry.value) pending.push(entry.promise);
        }
        if (pending.length > 0) {
            // Another project's or map's tilemap is not shown while this one's packs are made.
            const built = this.#built;
            if (built && (built.generation !== this.#generation || built.mapId !== map.id)) {
                this.#publish(null);
            }
            if (this.#waiting) return;
            this.#waiting = true;
            void Promise.allSettled(pending).then(() => {
                this.#waiting = false;
                this.#build();
            });
            return;
        }
        try {
            this.#finish(project, map);
        } catch (error) {
            this.#options.onError(error instanceof Error ? error.message : String(error));
            this.#publish(null);
        }
    }

    /** The pack of `tileset` at its current revision, started when needed. */
    #pack(tileset: Tileset): PackEntry {
        const revision = this.#revisions.get(tileset.id) ?? 0;
        const animations = animationKey(tileset);
        const known = this.#packs.get(tileset.id);
        if (known && known.revision === revision && known.animations === animations) return known;
        const entry: PackEntry = {
            revision,
            animations,
            value: null,
            failed: false,
            promise: this.#options.pack(tileset).then(
                (packed) => {
                    entry.value = packed;
                    return packed;
                },
                (error: unknown) => {
                    entry.failed = true;
                    this.#options.onError(error instanceof Error ? error.message : String(error));
                    throw error;
                },
            ),
        };
        entry.promise.catch(() => undefined);
        this.#packs.set(tileset.id, entry);
        return entry;
    }

    /** Makes the tilemap, its textures and its key from the packs (all ready). */
    #finish(project: Project, map: ProjectMap): void {
        const json = JSON.parse(tilemapFor(project, map)) as {
            tilesets: { name: string }[];
            layers: { type: string; image?: string }[];
        };
        const byName = new Map(project.tilesets.map((tileset) => [tileset.exportName, tileset]));
        const listed: Tileset[] = [];
        const atlases: Record<string, unknown> = {};
        const textures: PreviewTexture[] = [];
        const key: string[] = [`${this.#generation}`];
        for (const { name } of json.tilesets) {
            const tileset = byName.get(name);
            const packed = tileset ? this.#packs.get(tileset.id)?.value : null;
            if (!tileset || !packed) {
                // A tileset the scan above missed: pack it and build again.
                if (tileset) {
                    this.#pack(tileset);
                    this.#build();
                    return;
                }
                throw new Error(`The tilemap names a tileset ${name} the project lacks.`);
            }
            listed.push(tileset);
            atlases[name] = packed.atlas;
            const id = previewTextureId(project, name);
            textures.push({ id, pixels: packed.image });
            key.push(`${id}#${this.#revisions.get(tileset.id) ?? 0}`);
        }
        const images = new Set<string>();
        for (const layer of json.layers) {
            if (layer.type !== "image" || layer.image === undefined) continue;
            const name = layer.image.slice(0, -".png".length);
            if (images.has(name)) continue;
            images.add(name);
            const image = project.images.find((each) => each.exportName === name);
            if (!image) throw new Error(`The tilemap names an image ${name} the project lacks.`);
            const id = previewTextureId(project, name);
            textures.push({ id, pixels: evenImage(image.pixels) });
            key.push(`${id}#${this.#versionOf(image.pixels)}`);
        }
        const tilemap = readTilemap(json, atlases);
        this.#built = {
            content: {
                tilemap,
                texturesKey: key.join("\n"),
                textures,
                animations: animationsOf(listed),
            },
            generation: this.#generation,
            mapId: map.id,
            width: map.width,
            height: map.height,
            table: assignFirstGids(listed),
            tileLayers: tileLayersOf(tilemap),
        };
        this.#options.onContent(this.#built.content);
    }

    #versionOf(pixels: PixelBuffer): number {
        let version = this.#imageVersions.get(pixels);
        if (version === undefined) {
            version = ++this.#imageVersion;
            this.#imageVersions.set(pixels, version);
        }
        return version;
    }

    #publish(content: null): void {
        const had = this.#built !== null;
        this.#built = null;
        if (had) this.#options.onContent(content);
    }
}

/** `rect` inside `map`; null when it lies outside. */
function clip(rect: CellRect, map: ProjectMap): CellRect | null {
    const x0 = Math.max(rect.x, 0);
    const y0 = Math.max(rect.y, 0);
    const x1 = Math.min(rect.x + rect.width, map.width);
    const y1 = Math.min(rect.y + rect.height, map.height);
    if (x1 <= x0 || y1 <= y0) return null;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
