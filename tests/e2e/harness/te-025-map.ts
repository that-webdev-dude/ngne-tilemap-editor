// The TE-025 test project, shared by the page module and the specs: a 30 × 20 map of 16 px
// cells and two tilesets. "Terrain" has 12 tiles of 16 px on a grid of 4 columns, some with a
// class, a property, an animation or collision; "Props" has 3 tiles of 8 px on 3 columns.

export const MAP = { width: 30, height: 20, tile: 16 } as const;

export interface TileMarkFixture {
    class?: string;
    property?: boolean;
    animated?: boolean;
    collision?: boolean;
}

export interface TilesetFixture {
    name: string;
    size: number;
    columns: number;
    count: number;
    marks: Readonly<Record<number, TileMarkFixture>>;
}

export const TILESETS: readonly TilesetFixture[] = [
    {
        name: "Terrain",
        size: 16,
        columns: 4,
        count: 12,
        marks: {
            1: { class: "solid" },
            2: { class: "Solid wall" },
            5: { animated: true },
            6: { collision: true },
            9: { property: true },
        },
    },
    { name: "Props", size: 8, columns: 3, count: 3, marks: {} },
];

/** The colour of tile `id` of tileset fixture `index` (its slot less one), as RGB. */
export function tileColour(index: number, id: number): [number, number, number] {
    return [40 + index * 100, 20 + id * 17, 200 - id * 13];
}
