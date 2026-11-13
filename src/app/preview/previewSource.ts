import { CellConversionError, assignFirstGids, valueToGid } from "../../core/cells";
import type { CellRect, GidTable } from "../../core/cells";
import { evenImage } from "../../core/export";
import type { Touched } from "../../core/history";
import { findLayer } from "../../core/model";
import type { PixelBuffer, Project, ProjectMap, Tileset } from "../../core/model";
import type { PackedTileset } from "../../core/pack";
import { invalidate } from "../../core/runtime/runtime";
import type { TileLayerData, Tilemap } from "../../core/runtime/runtime";
import { cellsFromParts, tilemapFromParts, tilemapParts } from "../../core/tilemap";
import type { TilemapParts } from "../../core/tilemap";
import type { PreviewContent, PreviewPending, PreviewTexture } from "../../engine/preview";
import type { PackFn } from "../../engine/viewport";
import { slotsInMap } from "../viewport/mapTilesets";
import type { BuildTilemapFn } from "./buildTilemap";

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
//
// A build is far longer than a frame for a large map, so no notification runs one (ENGINE §6):
// `show` and `touched` ask for it and return. It starts later (`defer`), reads the project as
// it is then, and makes the tilemap's parts off the main thread (`build`); the page makes the
// `Tilemap` of the parts, or keeps the one it has when the parts differ from it in their cells
// alone (a step that changes nothing of the tilemap, as a selection). One build runs at a time.
// A result the project changed under is dropped and the tilemap is built once more, of the
// newest project; cells written meanwhile are written into the result instead. Until the build
// ends the preview draws no frame of the tilemap it replaces (`onPending`).

/** The ID `drawTilemap` names a tileset's or an image's texture by (SPEC §11.2). */
export function previewTextureId(project: Project, exportName: string): string {
    return `ngne-tilemap:${project.exportName}/${exportName}`;
}

export interface PreviewSourceOptions {
    /** Packs a tileset (`packTileset`, in the worker or here). */
    pack: PackFn;
    /** Makes a tilemap's parts (`tilemapParts`, in the worker); by default here. */
    build?: BuildTilemapFn;
    /**
     * Runs `start` later, outside the notification that asked for a build: the app starts a
     * build after the frame of the change. By default in a task of its own.
     */
    defer?(start: () => void): void;
    /** A new content; null while there is nothing to draw. */
    onContent(content: PreviewContent | null): void;
    /** Cells of the current content's tilemap were written in place. */
    onCells(): void;
    /**
     * The content given last is older than the project and is being made again: no frame may
     * draw it until null is told. "hold" for the map it shows, "blank" for another map or
     * project. A new content is given before null is told.
     */
    onPending?(pending: PreviewPending | null): void;
    /** Why the map cannot be previewed (a pack or a build failed). */
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
    /** The parts it was made of: their text, and the packs their atlases came from. */
    readonly text: string;
    readonly packs: ReadonlyMap<string, PackedTileset>;
    readonly table: GidTable;
    /** The tile layers of the tilemap, by layer ID. */
    readonly tileLayers: ReadonlyMap<number, TileLayerData>;
    /** The animations the content plays (`content.animations` is its list). */
    readonly animations: PlacedAnimations;
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

/** A build in flight: what it read of the source when it started. */
interface Flight {
    /** `#asked` when it started: another value at its end means the project changed. */
    readonly asked: number;
    readonly generation: number;
    readonly project: Project;
    readonly map: ProjectMap;
    /** The packs of the tilesets the map's cells use, by export name. */
    readonly packs: ReadonlyMap<string, PackedTileset>;
    /** Their atlases, as the parts are made with them. */
    readonly atlases: Readonly<Record<string, unknown>>;
    /** The cell steps of the map since it started: its result lacks them. */
    readonly late: Touched[];
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

/** The GID bits of a cell value (FORMAT 1.2): the value without its flags. */
const GID_MASK = 0x0fffffff;

/**
 * The animations a tilemap shows (ENGINE §4, redraw on demand): those of the animated tiles its
 * visible tile layers place, each tile once, so a frame is asked for only when a tile that can
 * be drawn changes. `add` lists the animation of a value written later.
 */
class PlacedAnimations {
    /** The frame durations of each placed animated tile, in the order they were met. */
    readonly list: number[][] = [];
    readonly #animated: ReadonlyMap<number, number[]>;
    readonly #placed = new Set<number>();

    /** Of a tilemap's parts: its animated tiles by GID, and those its visible layers place. */
    constructor({ animated, placed }: TilemapParts) {
        this.#animated = new Map(animated);
        for (const gid of placed) this.add(gid);
    }

    /** Lists the animation of the tile `value` names when it has one not listed yet. */
    add(value: number): void {
        const gid = value & GID_MASK;
        const durations = this.#animated.get(gid);
        if (durations === undefined || this.#placed.has(gid)) return;
        this.#placed.add(gid);
        this.list.push(durations);
    }
}

export class PreviewSource {
    readonly #options: PreviewSourceOptions;
    readonly #buildParts: BuildTilemapFn;
    readonly #defer: (start: () => void) => void;
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
    /** The last build, while it is of the map shown; cells are written into its tilemap. */
    #built: Built | null = null;
    /** What `onContent` was given last. */
    #published: PreviewContent | null = null;
    #pending: PreviewPending | null = null;
    /** Counts the builds asked for. */
    #asked = 0;
    /** A build was asked for and its start is deferred. */
    #scheduled = false;
    /** A build is under way: it waits for packs, or for its parts (`#flight`). */
    #busy = false;
    #flight: Flight | null = null;
    #disposed = false;

    constructor(options: PreviewSourceOptions) {
        this.#options = options;
        // Here: the parts are made on this thread, when the build starts.
        this.#buildParts =
            options.build ?? (async (project, map, atlases) => tilemapParts(project, map, atlases));
        this.#defer = options.defer?.bind(options) ?? ((start) => void setTimeout(start, 0));
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
        } else if (mapId === this.#mapId) {
            return;
        }
        this.#mapId = mapId;
        this.#ask();
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
            this.#ask();
            return;
        }
        if (touched.mapId !== this.#mapId) return;
        if (touched.cellRects.length > 0) {
            // A build that has read the project: the cells are written into its result.
            if (this.#flight) {
                this.#flight.late.push(touched);
                return;
            }
            // A build that has not read the project yet reads these cells.
            if (this.#scheduled || this.#busy) return;
            if (this.#built && this.#writeCells(this.#built, touched)) {
                this.#options.onCells();
                return;
            }
        }
        this.#ask();
    }

    dispose(): void {
        this.#disposed = true;
    }

    /**
     * Writes the cells of `touched` into the tilemap of `built`. False when they cannot be
     * written in place (a layer the tilemap lacks, a tileset it does not list, another size):
     * the tilemap is built again instead.
     */
    #writeCells(built: Built, touched: Touched): boolean {
        const project = this.#project;
        if (!project || built.mapId !== this.#mapId) return false;
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
                            const gid = valueToGid(cells(x, y), built.table);
                            data.data[y * map.width + x] = gid;
                            if (gid !== 0 && data.visible) built.animations.add(gid);
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

    /** The map shown, when the project has it. */
    #shown(): { project: Project; map: ProjectMap } | null {
        const project = this.#project;
        const map = project?.maps.find((each) => each.id === this.#mapId);
        return project && map ? { project, map } : null;
    }

    /**
     * Asks for a build of the map shown and does none of it: from now on what was built is
     * older than the project. A build under way ends first; its result is dropped.
     */
    #ask(): void {
        if (this.#disposed) return;
        this.#asked += 1;
        const shown = this.#shown();
        if (!shown) {
            this.#publish(null);
            return;
        }
        // Another project's or map's tilemap is not drawn while this one's is made.
        const built = this.#built;
        if (built && (built.generation !== this.#generation || built.mapId !== shown.map.id)) {
            this.#built = null;
        }
        if (this.#published) this.#setPending(this.#built ? "hold" : "blank");
        if (this.#scheduled || this.#busy) return;
        this.#scheduled = true;
        this.#defer(() => {
            this.#scheduled = false;
            if (!this.#disposed && !this.#busy) this.#start();
        });
    }

    /** Starts the build of the map shown, as the project is now: its packs, then its parts. */
    #start(): void {
        this.#busy = false;
        const shown = this.#shown();
        if (!shown) {
            this.#publish(null);
            return;
        }
        const { project, map } = shown;
        // The tilesets the map's cells may use; the tilemap lists those inside the map.
        const slots = slotsInMap(map);
        const packs = new Map<string, PackedTileset>();
        const waiting: Promise<PackedTileset>[] = [];
        for (const tileset of project.tilesets) {
            if (!slots.has(tileset.slot)) continue;
            const entry = this.#pack(tileset);
            if (entry.failed) {
                // Reported when it failed; nothing is drawn until the tileset changes.
                this.#publish(null);
                return;
            }
            if (entry.value) packs.set(tileset.exportName, entry.value);
            else waiting.push(entry.promise);
        }
        this.#busy = true;
        if (waiting.length > 0) {
            // It starts over once they are made: the project may change meanwhile.
            void Promise.allSettled(waiting).then(() => {
                if (!this.#disposed) this.#start();
            });
            return;
        }
        const atlases: Record<string, unknown> = {};
        for (const [name, packed] of packs) atlases[name] = packed.atlas;
        const flight: Flight = {
            asked: this.#asked,
            generation: this.#generation,
            project,
            map,
            packs,
            atlases,
            late: [],
        };
        this.#flight = flight;
        // A build that throws as it starts fails as one that rejects.
        const parts = (async () => this.#buildParts(project, map, atlases))();
        parts.then(
            (result) => this.#landed(flight, result, undefined),
            (error: unknown) => this.#landed(flight, null, error),
        );
    }

    /** A build's parts arrived, or it failed with `error`. */
    #landed(flight: Flight, parts: TilemapParts | null, error: unknown): void {
        if (this.#flight === flight) this.#flight = null;
        if (this.#disposed) return;
        // The project changed under it: the newest project is built instead.
        if (flight.asked !== this.#asked) {
            this.#start();
            return;
        }
        let built: Built | null = null;
        let failure = error;
        if (parts) {
            try {
                built = this.#finish(flight, parts);
            } catch (thrown) {
                failure = thrown;
            }
        }
        if (!built) {
            // Cells written since it started may be what it failed on: it is tried with them.
            if (flight.late.length > 0) {
                this.#start();
                return;
            }
            this.#options.onError(failure instanceof Error ? failure.message : String(failure));
            this.#busy = false;
            this.#publish(null);
            return;
        }
        for (const touched of flight.late) {
            if (!this.#writeCells(built, touched)) {
                // The result cannot take the cells written since it started.
                this.#start();
                return;
            }
        }
        this.#busy = false;
        this.#built = built;
        this.#publish(built.content);
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

    /**
     * Makes what a build's parts show: the tilemap, its textures and its key. The tilemap of the
     * last build is kept, with the cells of the parts written into it, when the parts differ
     * from its own in their cells alone; otherwise it is read from the parts.
     */
    #finish(flight: Flight, parts: TilemapParts): Built {
        const { project, map, generation, packs, atlases } = flight;
        const last = this.#built;
        const kept =
            last !== null &&
            last.generation === generation &&
            last.mapId === map.id &&
            last.text === parts.text &&
            last.packs.size === packs.size &&
            [...packs].every(([name, packed]) => last.packs.get(name) === packed);
        let tilemap: Tilemap;
        if (kept) {
            tilemap = last.content.tilemap;
            cellsFromParts(parts, tilemap);
        } else {
            tilemap = tilemapFromParts(parts, atlases);
        }
        const byName = new Map(project.tilesets.map((tileset) => [tileset.exportName, tileset]));
        const listed: Tileset[] = [];
        const textures: PreviewTexture[] = [];
        const key: string[] = [`${generation}`];
        for (const { name } of tilemap.tilesets) {
            const tileset = byName.get(name);
            const packed = packs.get(name);
            if (!tileset || !packed) {
                throw new Error(`The tilemap names a tileset ${name} the project lacks.`);
            }
            listed.push(tileset);
            const id = previewTextureId(project, name);
            textures.push({ id, pixels: packed.image });
            key.push(`${id}#${this.#revisions.get(tileset.id) ?? 0}`);
        }
        const images = new Set<string>();
        for (const layer of tilemap.layers) {
            if (layer.type !== "image") continue;
            const name = layer.image.slice(0, -".png".length);
            if (images.has(name)) continue;
            images.add(name);
            const image = project.images.find((each) => each.exportName === name);
            if (!image) throw new Error(`The tilemap names an image ${name} the project lacks.`);
            const id = previewTextureId(project, name);
            textures.push({ id, pixels: evenImage(image.pixels) });
            key.push(`${id}#${this.#versionOf(image.pixels)}`);
        }
        const animations = new PlacedAnimations(parts);
        return {
            content: {
                tilemap,
                texturesKey: key.join("\n"),
                textures,
                animations: animations.list,
            },
            generation,
            mapId: map.id,
            width: map.width,
            height: map.height,
            text: parts.text,
            packs,
            table: assignFirstGids(listed),
            tileLayers: tileLayersOf(tilemap),
            animations,
        };
    }

    #versionOf(pixels: PixelBuffer): number {
        let version = this.#imageVersions.get(pixels);
        if (version === undefined) {
            version = ++this.#imageVersion;
            this.#imageVersions.set(pixels, version);
        }
        return version;
    }

    /** Gives the preview its content (null: nothing can be drawn); no build is pending. */
    #publish(content: PreviewContent | null): void {
        if (content === null) this.#built = null;
        if (content !== this.#published) {
            this.#published = content;
            this.#options.onContent(content);
        }
        this.#setPending(null);
    }

    #setPending(pending: PreviewPending | null): void {
        if (pending === this.#pending) return;
        this.#pending = pending;
        this.#options.onPending?.(pending);
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
