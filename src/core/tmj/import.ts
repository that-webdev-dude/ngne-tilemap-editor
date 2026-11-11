import { CellStore, MAX_SLOT, SLOT_SHIFT, cellSlot } from "../cells";
import { compositeCommand } from "../history/command";
import type { Command } from "../history";
import { addImageCommand, findSameImage, imageNameFromFile, samePixels } from "../images";
import {
    BYTES_PER_CHUNK,
    MAX_MAPS,
    createMapSession,
    exportNames,
    randomId,
    uniqueSlug,
    walkLayers,
} from "../model";
import type {
    IdGenerator,
    Layer,
    Project,
    ProjectImage,
    ProjectMap,
    ProjectSession,
    Tileset,
} from "../model";
import { addTilesetCommand, tilesetNameOf } from "../tileset";
import type { PngDecoder } from "../tileset";
import { TmjError } from "./errors";
import { isObject, parseObject } from "./json";
import type { JsonObject } from "./json";
import { convertTmjMap } from "./map";
import { baseName, folderOf, resolveTmjPath } from "./paths";
import { formatLocation, groupReport } from "./report";
import type { TmjReportGroup, TmjReportRow } from "./report";
import { convertTmjTilesets, tmjImagePixels } from "./tileset";
import type { TmjFiles } from "./tileset";
import { tsxToJson } from "./tsx";

// File → Import Tiled Map… (SPEC §13; TE-061) as the core sees it: the files a map needs, its
// conversion with its tilesets and images into the pieces of one import (nothing of the project
// touched), the report the dialog shows, and the command that adds the import in one history
// entry. Paths are from the map's folder (`resolveTmjPath`), templates' too.

/** What a file the map needs is to it. */
export type TmjFileKind = "tileset" | "image" | "template";

/** A file the map needs, by its path from the map's folder. */
export interface TmjRequiredFile {
    readonly path: string;
    readonly kind: TmjFileKind;
}

/** The kind of file a name is, for the picking of SPEC §13 Files; null for any other file. */
export function tmjFileKind(name: string): "map" | "json" | TmjFileKind | null {
    const lower = name.toLowerCase();
    if (lower.endsWith(".tmj")) return "map";
    if (lower.endsWith(".json")) return "json";
    if (lower.endsWith(".tsj") || lower.endsWith(".tsx")) return "tileset";
    if (lower.endsWith(".tj")) return "template";
    if (lower.endsWith(".png")) return "image";
    return null;
}

/** Whether a file is a Tiled map: a `.tmj`, or JSON with `"type": "map"` (SPEC §13 Files). */
export function isTmjMapFile(name: string, text: () => string): boolean {
    const kind = tmjFileKind(name);
    if (kind === "map") return true;
    if (kind !== "json") return false;
    try {
        const value: unknown = JSON.parse(text());
        return isObject(value) && value.type === "map";
    } catch {
        return false;
    }
}

function parseQuietly(text: string): JsonObject | null {
    try {
        return text.trimStart().startsWith("<") ? tsxToJson(text, "") : parseObject(text, "");
    } catch {
        return null;
    }
}

/**
 * The files a map needs, in the order it names them: its external tilesets, the images of its
 * tilesets (those of an external tileset once its text is given), its templates and the
 * images of its image layers. A map that cannot be read needs nothing here; its conversion
 * says why it is refused.
 */
export function tmjRequiredFiles(
    mapText: string,
    files: Pick<TmjFiles, "text">,
): TmjRequiredFile[] {
    const out: TmjRequiredFile[] = [];
    const seen = new Set<string>();
    const add = (path: string, kind: TmjFileKind) => {
        if (path === "" || seen.has(path)) return;
        seen.add(path);
        out.push({ path, kind });
    };
    const map = parseQuietly(mapText);
    if (!map || map.type !== "map") return out;
    const tilesetImages = (tileset: JsonObject, folder: string) => {
        if (typeof tileset.image === "string" && tileset.image !== "") {
            add(resolveTmjPath(folder, tileset.image), "image");
        }
        for (const tile of Array.isArray(tileset.tiles) ? tileset.tiles : []) {
            if (isObject(tile) && typeof tile.image === "string" && tile.image !== "") {
                add(resolveTmjPath(folder, tile.image), "image");
            }
        }
    };
    const tilesets = Array.isArray(map.tilesets) ? map.tilesets.filter(isObject) : [];
    for (const tileset of tilesets) {
        if (typeof tileset.source !== "string") continue;
        add(resolveTmjPath("", tileset.source), "tileset");
    }
    for (const tileset of tilesets) {
        if (typeof tileset.source !== "string") {
            tilesetImages(tileset, "");
            continue;
        }
        const path = resolveTmjPath("", tileset.source);
        const text = files.text(path);
        const json = text === undefined ? null : parseQuietly(text);
        if (json) tilesetImages(json, folderOf(path));
    }
    const layerImages: string[] = [];
    const walk = (layers: unknown) => {
        for (const layer of Array.isArray(layers) ? layers.filter(isObject) : []) {
            if (layer.type === "group") walk(layer.layers);
            if (layer.type === "imagelayer" && typeof layer.image === "string") {
                layerImages.push(resolveTmjPath("", layer.image));
            }
            if (layer.type !== "objectgroup" || !Array.isArray(layer.objects)) continue;
            for (const object of layer.objects.filter(isObject)) {
                if (typeof object.template === "string") {
                    add(resolveTmjPath("", object.template), "template");
                }
            }
        }
    };
    walk(map.layers);
    for (const path of layerImages) add(path, "image");
    return out;
}

/** What the report says of the converted map (DESIGN §9: the summary). */
export interface TmjImportSummary {
    readonly name: string;
    readonly exportName: string;
    readonly width: number;
    readonly height: number;
    readonly tileWidth: number;
    readonly tileHeight: number;
    /** Layers of every kind, groups and their children included. */
    readonly layers: number;
    readonly tileLayers: number;
    readonly markerLayers: number;
    readonly imageLayers: number;
    readonly groups: number;
    /** The tilesets the map uses: new ones, and project tilesets reused. */
    readonly tilesets: readonly {
        readonly name: string;
        readonly tiles: number;
        readonly reused: boolean;
    }[];
    readonly markers: number;
    /** Images of the map's image layers. */
    readonly images: number;
}

/** One dropped or changed item of the report, its location as the dialog shows it. */
export interface TmjImportReportEntry {
    readonly detail: string;
    readonly count: number;
    readonly where: string;
}

export interface TmjImportReportGroup {
    readonly row: TmjReportRow;
    readonly title: string;
    readonly count: number;
    readonly entries: readonly TmjImportReportEntry[];
}

/** The report of SPEC §13: the summary, then every dropped or changed item by BRIEF §7 row. */
export interface TmjImportReport {
    readonly summary: TmjImportSummary;
    readonly groups: readonly TmjImportReportGroup[];
}

/** The pieces of one import, the project untouched. */
export interface TmjImport {
    /** The new map; its cells name map-local slots (`slots`' index plus one). */
    readonly map: ProjectMap;
    /** The tileset ID each map-local slot binds to: a new tileset, a project's, or null. */
    readonly slots: readonly (string | null)[];
    /** The new tilesets, in the map's order; their `slot` is set when they are added. */
    readonly tilesets: readonly Tileset[];
    /** The new images of the map's image layers. */
    readonly images: readonly ProjectImage[];
    readonly report: TmjImportReport;
}

export interface TmjImportOptions {
    /** The map's file name: the map is named after it. */
    readonly fileName: string;
    /** The files of the map's folder, by their path from it (templates included). */
    readonly files: TmjFiles;
    /** Export names the import's must differ from besides the project's. */
    readonly takenExportNames?: Iterable<string>;
    readonly decode?: PngDecoder;
    readonly newId?: IdGenerator;
}

function groupsOf(report: Parameters<typeof groupReport>[0]): TmjImportReportGroup[] {
    return groupReport(report).map((group: TmjReportGroup) => ({
        row: group.row,
        title: group.title,
        count: group.count,
        entries: group.entries.map((entry) => ({
            detail: entry.detail,
            count: entry.count,
            where: formatLocation(entry.where),
        })),
    }));
}

function summaryOf(
    map: ProjectMap,
    slots: readonly (Tileset | null)[],
    added: readonly Tileset[],
    images: number,
): TmjImportSummary {
    const counts = { tile: 0, marker: 0, image: 0, group: 0 };
    let markers = 0;
    let layers = 0;
    for (const { layer } of walkLayers(map.layers)) {
        layers += 1;
        counts[layer.type] += 1;
        if (layer.type === "marker") markers += layer.markers.length;
    }
    const tilesets: { name: string; tiles: number; reused: boolean }[] = [];
    const listed = new Set<Tileset>();
    for (const tileset of slots) {
        if (!tileset || listed.has(tileset)) continue;
        listed.add(tileset);
        tilesets.push({
            name: tileset.name,
            tiles: tileset.tiles.length,
            reused: !added.includes(tileset),
        });
    }
    return {
        name: map.name,
        exportName: map.exportName,
        width: map.width,
        height: map.height,
        tileWidth: map.tileWidth,
        tileHeight: map.tileHeight,
        layers,
        tileLayers: counts.tile,
        markerLayers: counts.marker,
        imageLayers: counts.image,
        groups: counts.group,
        tilesets,
        markers,
        images,
    };
}

/** Points every image layer of `layers` that shows an image of `from` at its image in `to`. */
function renameImages(layers: readonly Layer[], to: ReadonlyMap<string, string>): void {
    for (const { layer } of walkLayers(layers)) {
        if (layer.type !== "image") continue;
        const id = to.get(layer.imageId);
        if (id !== undefined) layer.imageId = id;
    }
}

/**
 * Imports a Tiled map: converts it, its tilesets (reusing the project's where SPEC §13 says)
 * and the images of its image layers (an image with the pixels of a project image, or of an
 * earlier one of the map, shows that one). Rejects with `TmjError` when the map is refused,
 * `missing-file` naming a file that was not given.
 */
export async function importTmj(
    project: Project,
    mapText: string,
    options: TmjImportOptions,
): Promise<TmjImport> {
    const newId = options.newId ?? randomId;
    const taken = [...exportNames(project), ...(options.takenExportNames ?? [])];
    const converted = convertTmjMap(mapText, {
        fileName: options.fileName,
        template: (path) => options.files.text(resolveTmjPath("", path)),
        takenExportNames: taken,
        newId,
    });
    const { map } = converted;
    const tilesets = await convertTmjTilesets(project, converted.tilesets, {
        fileName: options.fileName,
        files: options.files,
        takenExportNames: [...taken, map.exportName],
        ...(options.decode ? { decode: options.decode } : {}),
        newId,
    });
    const names = [...taken, map.exportName, ...tilesets.added.map((each) => each.exportName)];
    const images: ProjectImage[] = [];
    const renamed = new Map<string, string>();
    for (const ref of converted.images) {
        const path = resolveTmjPath("", ref.path);
        const bytes = options.files.bytes(path);
        if (bytes === undefined) {
            throw new TmjError("missing-file", `The image ${path} is missing.`, path);
        }
        const pixels = await tmjImagePixels(bytes, ref.transparentColor, path, options.decode);
        const same =
            findSameImage(project, pixels) ??
            images.find((image) => samePixels(image.pixels, pixels));
        if (same) {
            renamed.set(ref.id, same.id);
            continue;
        }
        const name = imageNameFromFile(baseName(path));
        const exportName = uniqueSlug(name, names, "image");
        names.push(exportName);
        images.push({ id: ref.id, name, exportName, pixels });
    }
    renameImages(map.layers, renamed);
    const groups = groupsOf([...converted.report, ...tilesets.report]);
    return {
        map,
        slots: tilesets.slots.map((tileset) => tileset?.id ?? null),
        tilesets: tilesets.added,
        images,
        report: { summary: summaryOf(map, tilesets.slots, tilesets.added, images.length), groups },
    };
}

/**
 * The import as the project is now (it may have changed since the conversion): an image with
 * the pixels of a project image shows that one instead. Changes `imported` in place.
 */
export function rebindTmjImages(project: Project, imported: TmjImport): TmjImport {
    const renamed = new Map<string, string>();
    const images = imported.images.filter((image) => {
        const same = findSameImage(project, image.pixels);
        if (same) renamed.set(image.id, same.id);
        return !same;
    });
    renameImages(imported.map.layers, renamed);
    return { ...imported, images };
}

/** The label of the history entry. */
export const IMPORT_TILED_MAP_LABEL = "Import Tiled Map";

/** Bytes the map command claims besides the cells it holds. */
const OVERHEAD_BYTES = 256;

/** The slot's bits of a cell value (SPEC §2.2: bits 20..27). */
const SLOT_MASK = MAX_SLOT << SLOT_SHIFT;

/** `value` with its slot replaced by `slot`; empty stays empty. */
function withSlot(value: number, slot: number): number {
    if (value === 0) return 0;
    return ((value & ~SLOT_MASK) | (slot << SLOT_SHIFT)) >>> 0;
}

/** A copy of `layers` whose cells name the project slots of `slots` (map-local slot → slot). */
function reboundLayers(layers: readonly Layer[], slots: ReadonlyMap<number, number>): Layer[] {
    return layers.map((layer): Layer => {
        if (layer.type === "group") return { ...layer, layers: reboundLayers(layer.layers, slots) };
        if (layer.type !== "tile") return layer;
        const chunks = Array.from(layer.cells.allChunks(), ({ cx, cy, cells }) => {
            const out = new Uint32Array(cells.length);
            for (let index = 0; index < cells.length; index += 1) {
                const value = cells[index]!;
                if (value === 0) continue;
                const slot = slots.get(cellSlot(value));
                if (slot === undefined) {
                    throw new TmjError(
                        "gid",
                        `Layer "${layer.name}" names a tileset not imported.`,
                    );
                }
                out[index] = withSlot(value, slot);
            }
            return { cx, cy, cells: out };
        });
        return { ...layer, cells: CellStore.fromChunks(chunks) };
    });
}

function cellBytes(map: ProjectMap): number {
    let bytes = 0;
    for (const { layer } of walkLayers(map.layers)) {
        if (layer.type === "tile") bytes += layer.cells.chunkCount * BYTES_PER_CHUNK;
    }
    return bytes;
}

/**
 * The command that adds the imported map at the end of the map list and shows it, its cells
 * bound to the slots its tilesets have in the project when it runs. Throws `TmjError` with the
 * session unchanged when the project holds the most maps, the export name is taken, or a
 * tileset of the map is not in the project.
 */
function addImportedMapCommand(imported: TmjImport): Command {
    const original = imported.map;
    let built: { key: string; map: ProjectMap } | null = null;
    let before = "";
    const bytes = cellBytes(original);
    return {
        label: IMPORT_TILED_MAP_LABEL,
        bytes: OVERHEAD_BYTES + bytes,
        projectBytes: bytes,
        touched: {
            mapId: original.id,
            layerIds: [],
            cellRects: [],
            tilesetIds: [],
            structure: true,
        },
        do(session) {
            const { project } = session;
            if (project.maps.length >= MAX_MAPS) {
                throw new TmjError("limit", `A project holds at most ${MAX_MAPS} maps.`);
            }
            if (exportNames(project).includes(original.exportName)) {
                throw new TmjError(
                    "limit",
                    `The export name ${JSON.stringify(original.exportName)} is taken.`,
                );
            }
            const slots = new Map<number, number>();
            imported.slots.forEach((id, index) => {
                if (id === null) return;
                const tileset = project.tilesets.find((each) => each.id === id);
                if (!tileset) {
                    throw new TmjError("gid", "A tileset of the map is no longer in the project.");
                }
                slots.set(index + 1, tileset.slot);
            });
            const key = JSON.stringify([...slots]);
            if (built?.key !== key) {
                built = {
                    key,
                    map: { ...original, layers: reboundLayers(original.layers, slots) },
                };
            }
            const { map } = built;
            before = session.activeMapId;
            project.maps.push(map);
            session.perMap.set(map.id, createMapSession(map));
            session.activeMapId = map.id;
        },
        undo(session) {
            const { maps } = session.project;
            const index = maps.findIndex((map) => map.id === original.id);
            if (index >= 0) maps.splice(index, 1);
            session.perMap.delete(original.id);
            session.activeMapId = before;
        },
    };
}

/**
 * The command that adds an import (`importTmj`, then `rebindTmjImages`) to the project in one
 * history entry: its new tilesets (each in the lowest free slot), its new images, then the map,
 * which becomes the active one. Undo removes all of them. Throws, with the session unchanged,
 * when the project has no room for a piece (FORMAT §2.8) or an ID or export name is taken.
 */
export function importTmjCommand(imported: TmjImport): Command {
    return compositeCommand(IMPORT_TILED_MAP_LABEL, [
        ...imported.tilesets.map(addTilesetCommand),
        ...imported.images.map(addImageCommand),
        addImportedMapCommand(imported),
    ]);
}

/**
 * A new project holding the import alone (Import Tiled Map with no project open): named after
 * the map, its tilesets and images added as `importTmjCommand` adds them.
 */
export function tmjImportProject(imported: TmjImport, newId: IdGenerator = randomId): Project {
    const { name } = imported.map;
    const project: Project = {
        id: newId(),
        name,
        exportName: uniqueSlug(name, [], "project"),
        maps: [],
        tilesets: [],
        images: [],
        exportSettings: { exportOnSave: false },
        properties: [],
    };
    const session: ProjectSession = { project, activeMapId: "", perMap: new Map() };
    importTmjCommand(imported).do(session);
    return project;
}

/** The name a tileset file's tilesets take in the project: reuse candidates are named so. */
export function tmjTilesetName(path: string): string {
    return tilesetNameOf(baseName(path));
}
