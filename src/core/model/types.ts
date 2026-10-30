import type { CellStore } from "../cells";

// The in-memory project (SPEC §2.1) and the session types of SPEC §3. Every member is
// persisted by FORMAT §2 unless marked session-only. `Command` is TE-006's.

/** A property of FORMAT §1.4. `type` is stored because JSON writes `2.0` and `2` alike. */
export type Property =
    | { name: string; type: "bool"; value: boolean }
    | { name: string; type: "int"; value: number }
    | { name: string; type: "float"; value: number }
    | { name: string; type: "string"; value: string }
    | { name: string; type: "color"; value: string }
    | { name: string; type: "file"; value: string };

export type PropertyType = Property["type"];

/** A point of a polygon or polyline, relative to the shape's `x, y`. */
export type ShapePoint = [number, number];

/** The geometry of a marker or a collision shape (FORMAT §1.5), in pixels, x right, y down. */
export type Shape =
    | { shape: "rectangle"; x: number; y: number; width: number; height: number }
    | { shape: "ellipse"; x: number; y: number; width: number; height: number }
    | { shape: "point"; x: number; y: number }
    | { shape: "polygon"; x: number; y: number; points: ShapePoint[] }
    | { shape: "polyline"; x: number; y: number; points: ShapePoint[] };

export type ShapeKind = Shape["shape"];

/** Straight (not premultiplied) RGBA8 pixels, rows top to bottom. */
export interface PixelBuffer {
    width: number;
    height: number;
    data: Uint8ClampedArray;
}

export interface Project {
    /** FORMAT ID. */
    id: string;
    name: string;
    /** Slug. */
    exportName: string;
    /** List order is the project's map list. */
    maps: ProjectMap[];
    /** List order is the Tilesets panel and assigns `firstGid` on write. */
    tilesets: Tileset[];
    images: ProjectImage[];
    exportSettings: { exportOnSave: boolean };
    properties: Property[];
}

export type TilesetSourceKind = "image" | "sprite" | "atlas" | "collection";

/** Where a tileset's pixels came from (FORMAT §2.4 Source). */
export interface TilesetSource {
    kind: TilesetSourceKind;
    fileName: string;
    /** 0 unless `kind` is `"image"` or `"sprite"`. */
    margin: number;
    spacing: number;
}

/** Where a tile is in its tileset's source, by the source's `kind` (FORMAT §2.4). */
export type TileSourceKey = [number, number] | [string, number, number] | string;

export interface Tile {
    /** 0..1 048 575, stable, never reused. */
    id: number;
    /** `null` for a tile kept after it went missing from the source. */
    sourceKey: TileSourceKey | null;
    /** 64 lowercase hexadecimal digits: SHA-256 of the tile's pixels (FORMAT §2.4). */
    fingerprint: string;
    class: string;
    /** In tile pixels, untransformed; rectangles, ellipses and polygons only. */
    collision: Shape[];
    /** Empty: not animated. */
    animation: AnimationFrame[];
    properties: Property[];
}

export interface AnimationFrame {
    /** The `id` of a tile of the same tileset. */
    tile: number;
    /** 1..65 535. */
    ms: number;
}

export type TerrainSetType = "corner" | "edge" | "mixed";

export interface TerrainColor {
    name: string;
    /** `#rrggbbaa`. */
    color: string;
    /** Icon of the terrain: the `id` of a tile of the tileset, or none. */
    tile: number | null;
}

export interface TerrainTile {
    tile: number;
    /** Eight entries clockwise from the top; each 0 (no terrain) or `1..colors.length`. */
    wangId: number[];
}

export interface TerrainSet {
    name: string;
    type: TerrainSetType;
    /** Terrain `n` is `colors[n − 1]`. */
    colors: TerrainColor[];
    tiles: TerrainTile[];
}

export interface Tileset {
    id: string;
    name: string;
    exportName: string;
    class: string;
    /** 1..255, session-only (SPEC §2.2). */
    slot: number;
    tileWidth: number;
    tileHeight: number;
    /** Tile offset when drawn (FORMAT §1.3). */
    offsetX: number;
    offsetY: number;
    /** Tiles per row of the stored image. */
    columns: number;
    /** Straight RGBA8, tiles in list order on a grid of `columns`. */
    pixels: PixelBuffer;
    nextTileId: number;
    source: TilesetSource;
    /** Display order; tile `k` is at grid position `k`. */
    tiles: Tile[];
    terrainSets: TerrainSet[];
    properties: Property[];
}

export interface ProjectMap {
    id: string;
    name: string;
    exportName: string;
    class: string;
    orientation: "orthogonal";
    /** In cells. */
    width: number;
    height: number;
    /** Grid cell size in pixels. */
    tileWidth: number;
    tileHeight: number;
    /** `0xRRGGBBAA`, or none. */
    backgroundColor: number | null;
    parallaxOriginX: number;
    parallaxOriginY: number;
    nextLayerId: number;
    nextMarkerId: number;
    /** Bottom to top; groups hold their children. */
    layers: Layer[];
    properties: Property[];
}

export type LayerType = "tile" | "marker" | "image" | "group";

export interface LayerBase {
    id: number;
    name: string;
    class: string;
    visible: boolean;
    locked: boolean;
    /** 0..255. */
    opacity: number;
    /** Pixels, +x right, +y down. */
    offsetX: number;
    offsetY: number;
    /** Parallax factor; 1 moves with the map. */
    parallaxX: number;
    parallaxY: number;
    properties: Property[];
}

export interface TileLayer extends LayerBase {
    type: "tile";
    cells: CellStore;
}

export interface MarkerLayer extends LayerBase {
    type: "marker";
    /** `0xRRGGBBAA`: how the editor draws the markers. */
    color: number;
    markers: Marker[];
}

export interface ImageLayer extends LayerBase {
    type: "image";
    /** The `id` of an image of the project. */
    imageId: string;
    repeatX: boolean;
    repeatY: boolean;
}

export interface GroupLayer extends LayerBase {
    type: "group";
    /** Bottom to top. */
    layers: Layer[];
}

export type Layer = TileLayer | MarkerLayer | ImageLayer | GroupLayer;

export type Marker = Shape & {
    id: number;
    name: string;
    class: string;
    properties: Property[];
};

export interface ProjectImage {
    id: string;
    name: string;
    exportName: string;
    pixels: PixelBuffer;
}

// Sessions (SPEC §3). None of this is persisted.

/** A cell mask with its bounds: the tile selection of a map. */
export interface Region {
    /** Bounds in cells. */
    x: number;
    y: number;
    width: number;
    height: number;
    /** One byte per cell of the bounds, row by row; non-zero is selected. */
    mask: Uint8Array;
}

export interface MapView {
    centreX: number;
    centreY: number;
    zoom: number;
}

export interface MapSession {
    activeLayerId: number;
    tileSelection: Region | null;
    /** Marker IDs. */
    markerSelection: number[];
    view: MapView;
}

/** One per window. */
export interface ProjectSession {
    project: Project;
    activeMapId: string;
    perMap: Map<string, MapSession>;
}
