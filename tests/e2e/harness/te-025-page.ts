// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { appCommands } from "../../../src/app/commands/appCommands";
import { tilesetPanelStore } from "../../../src/app/tilesets/panel/tilesetPanel";
import { toolState } from "../../../src/app/tools/activeTool";
import { currentStamp, setCurrentStamp } from "../../../src/app/tools/stamp/currentStamp";
import { resetStampBrush } from "../../../src/app/tools/stamp/stamp.tools";
import { currentViewMapping, zoomTo } from "../../../src/app/view/viewNavigation";
import { viewPreferences } from "../../../src/app/view/viewPreferences";
import { cellSlot, cellTileId } from "../../../src/core/cells";
import { createProject, createProjectSession, sequentialIds } from "../../../src/core/model";
import type { Project, Tile, Tileset, TileLayer } from "../../../src/core/model";
import { sha256Hex } from "../../support/sha256";
import { MAP, TILESETS, tileColour } from "./te-025-map";
import type { TilesetFixture } from "./te-025-map";

// TE-025 page module: the specs import it into the running editor, so it shares the app's
// stores. It loads a project with the tilesets of te-025-map.ts, reads the current stamp, the
// map's cells and the panel's canvas back.

function tileset(newId: () => string, fixture: TilesetFixture, index: number, slot: number) {
    const { size, columns, count } = fixture;
    const rows = Math.ceil(count / columns);
    const width = columns * size;
    const data = new Uint8ClampedArray(width * rows * size * 4);
    const tiles: Tile[] = [];
    for (let id = 0; id < count; id++) {
        const own = new Uint8ClampedArray(size * size * 4);
        const [r, g, b] = tileColour(index, id);
        for (let i = 0; i < size * size; i++) own.set([r, g, b, 255], i * 4);
        const left = (id % columns) * size;
        const top = Math.floor(id / columns) * size;
        for (let y = 0; y < size; y++) {
            data.set(
                own.subarray(y * size * 4, (y + 1) * size * 4),
                ((top + y) * width + left) * 4,
            );
        }
        const marks = fixture.marks[id] ?? {};
        tiles.push({
            id,
            sourceKey: [left / size, top / size],
            fingerprint: sha256Hex(own),
            class: marks.class ?? "",
            collision: marks.collision
                ? [{ shape: "rectangle", x: 0, y: 0, width: size, height: size }]
                : [],
            animation: marks.animated
                ? [
                      { tile: id, ms: 100 },
                      { tile: 0, ms: 100 },
                  ]
                : [],
            properties: marks.property ? [{ name: "hp", type: "int", value: 3 }] : [],
        });
    }
    const result: Tileset = {
        id: newId(),
        name: fixture.name,
        exportName: fixture.name.toLowerCase(),
        class: "",
        slot,
        tileWidth: size,
        tileHeight: size,
        offsetX: 0,
        offsetY: 0,
        columns,
        pixels: { width, height: rows * size, data },
        nextTileId: count,
        source: { kind: "image", fileName: `${fixture.name}.png`, margin: 0, spacing: 0 },
        tiles,
        terrainSets: [],
        properties: [],
    };
    return result;
}

/** Replaces the project with the test project; the bottom panel at its default state. */
export function load(): string[] {
    const newId = sequentialIds();
    const project: Project = createProject({
        newId,
        map: { width: MAP.width, height: MAP.height, tileWidth: MAP.tile, tileHeight: MAP.tile },
    });
    TILESETS.forEach((fixture, index) =>
        project.tilesets.push(tileset(newId, fixture, index, index + 1)),
    );
    window.__ngneTest!.session.getState().replace(createProjectSession(project));
    setCurrentStamp(null);
    resetStampBrush();
    toolState.select("eraser");
    if (viewPreferences.getState().grid) viewPreferences.setState({ grid: false });
    zoomTo(0.5);
    return project.tilesets.map((each) => each.id);
}

/** The current stamp: its size and its cells as "slot:tile", "" for an empty cell. */
export function stamp(): { width: number; height: number; cells: string[] } | null {
    const value = currentStamp();
    if (!value) return null;
    return {
        width: value.width,
        height: value.height,
        cells: [...value.cells].map((cell) =>
            cell === 0 ? "" : `${cellSlot(cell)}:${cellTileId(cell)}`,
        ),
    };
}

export function selectedTool(): string {
    return toolState.selectedId();
}

/** The non-empty cells of the first tile layer, as "x,y:slot:tile", row by row. */
export function cells(): string[] {
    const { session } = window.__ngneTest!.session.getState();
    const map = session.project.maps.find((each) => each.id === session.activeMapId)!;
    const layer = map.layers[0] as TileLayer;
    const found: string[] = [];
    for (let y = 0; y < MAP.height; y++) {
        for (let x = 0; x < MAP.width; x++) {
            const value = layer.cells.get(x, y);
            if (value !== 0) found.push(`${x},${y}:${cellSlot(value)}:${cellTileId(value)}`);
        }
    }
    return found;
}

/** The client position of the centre of map cell `(x, y)`. */
export function cellClient(x: number, y: number): { x: number; y: number } {
    const mapping = currentViewMapping()!;
    return mapping.mapToClient((x + 0.5) * MAP.tile, (y + 0.5) * MAP.tile);
}

/** The panel's state the specs read. */
export function panel(): { active: string | null; zoom: number; filter: string } {
    const state = tilesetPanelStore.getState();
    return { active: state.activeTilesetId, zoom: state.zoom, filter: state.filter };
}

/** The panel canvas's pixel at device `(x, y)`, as RGBA. */
export function canvasPixel(x: number, y: number): number[] {
    const canvas = document.querySelector<HTMLCanvasElement>("[data-tile-canvas]")!;
    return [...canvas.getContext("2d")!.getImageData(x, y, 1, 1).data];
}

/** A colour token of the page as RGB. */
export function token(name: string): number[] {
    const text = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const value = parseInt(text.replace("#", ""), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Registers a command in the tile menu; returns its id. */
export function addTileCommand(title: string): string {
    const id = "test.tileCommand";
    const runs = window as unknown as { __tileCommandRuns: number };
    runs.__tileCommandRuns = 0;
    appCommands.register({
        id,
        title,
        contextMenus: [{ menu: "tile" }],
        run: () => void runs.__tileCommandRuns++,
    });
    return id;
}

export function tileCommandRuns(): number {
    return (window as unknown as { __tileCommandRuns: number }).__tileCommandRuns;
}
