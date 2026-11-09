import { strFromU8, unzipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    MAX_CONTENT_BYTES,
    MAX_IMAGE_PIXELS,
    MAX_MANIFEST_BYTES,
    MAX_MAP_JSON_BYTES,
    MAX_PROJECT_JSON_BYTES,
    MAX_TILESET_PIXELS,
    MIGRATIONS,
    ProjectError,
    deserialize,
    maxPngBytes,
    serialize,
} from "../../src/core/project";
import type { ProjectErrorCode } from "../../src/core/project";
import { readProjectFile } from "../../src/core/project/deserialize";
import type * as Fflate from "fflate";
import type * as SpritePng from "../../src/core/sprite/png";
import { encodeJson } from "../../src/core/project/json";
import { migrate } from "../../src/core/project/migrations";
import { encodePng } from "../../src/core/sprite/png";
import { everyMemberProject, rawZip } from "./te-046-support";
import type { RawEntry, RawOptions } from "./te-046-support";

// TE-046: every refusal of the reader (FORMAT §2.1 container rules, §2.2 JSON rules, §2.8
// limits, §2.9 steps), each with its error code and the entry at fault. The inflater and the
// PNG decoder are spies: a limit is refused before what it bounds is inflated or decoded.

const spies = vi.hoisted(() => ({ inflates: 0, decodes: 0 }));

vi.mock("fflate", async (importOriginal) => {
    const actual = await importOriginal<typeof Fflate>();
    class Inflate extends actual.Inflate {
        constructor(...args: ConstructorParameters<typeof actual.Inflate>) {
            super(...args);
            spies.inflates += 1;
        }
    }
    return { ...actual, Inflate };
});

vi.mock("../../src/core/sprite/png", async (importOriginal) => {
    const actual = await importOriginal<typeof SpritePng>();
    return {
        ...actual,
        decodePng: (...args: Parameters<typeof actual.decodePng>) => {
            spies.decodes += 1;
            return actual.decodePng(...args);
        },
    };
});

beforeEach(() => {
    spies.inflates = 0;
    spies.decodes = 0;
});

/** The every-member project's entries, as written. */
const BASE = unzipSync(serialize(everyMemberProject()));
const TOWN = "maps/map-town.json";
const DUNGEON = "maps/map-dungeon.json";
const TILESET = "tilesets/TS-image.png";

type Files = Record<string, Uint8Array>;
// Parsed JSON is edited freely in these tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

function json(files: Files, name: string): Json {
    return JSON.parse(strFromU8(files[name]!));
}

/** Changes the JSON entry `name` in place. */
function editJson(files: Files, name: string, edit: (value: Json) => void): void {
    const value = json(files, name);
    edit(value);
    files[name] = encodeJson(value);
}

interface FileOptions {
    edit?: (files: Files) => void;
    /** Raw entry overrides by name; `deflate` defaults to false so no inflater runs. */
    raw?: Record<string, Partial<RawEntry>>;
    zip?: RawOptions;
    /** Entries added at the end, after the project's own. */
    extra?: RawEntry[];
}

/** A project file built from the every-member project, all entries stored unless asked. */
function file(options: FileOptions = {}): Uint8Array {
    const files: Files = { ...BASE };
    options.edit?.(files);
    const entries: RawEntry[] = Object.entries(files).map(([name, data]) => ({
        name,
        data,
        ...options.raw?.[name],
    }));
    return rawZip([...entries, ...(options.extra ?? [])], options.zip);
}

interface Expected {
    code: ProjectErrorCode;
    entry: string | undefined;
    message?: RegExp;
    /** Inflater runs and decoder calls allowed before the refusal; 0 unless stated. */
    inflates?: number;
    decodes?: number;
}

async function refused(
    bytes: Uint8Array,
    expected: Expected,
    read = deserialize,
): Promise<ProjectError> {
    const error = await read(bytes).then(
        () => null,
        (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(ProjectError);
    const projectError = error as ProjectError;
    expect({ code: projectError.code, entry: projectError.entry }).toEqual({
        code: expected.code,
        entry: expected.entry,
    });
    if (expected.message) expect(projectError.message).toMatch(expected.message);
    expect(spies.inflates).toBe(expected.inflates ?? 0);
    expect(spies.decodes).toBe(expected.decodes ?? 0);
    return projectError;
}

describe("the files these cases start from", () => {
    it("read when stored, deflated, in another order or with unnamed entries", async () => {
        await expect(deserialize(file())).resolves.toBeDefined();
        const reversed = Object.entries(BASE)
            .reverse()
            .map(([name, data]) => ({ name, data, deflate: name.endsWith(".json") }));
        await expect(deserialize(rawZip(reversed))).resolves.toBeDefined();
        const extra = { name: "notes/readme.txt", data: new Uint8Array([1, 2]) };
        await expect(deserialize(file({ extra: [extra] }))).resolves.toBeDefined();
    });
});

describe("FORMAT §2.1 container rules", () => {
    it("one disk", async () => {
        await refused(file({ zip: { disk: 1 } }), {
            code: "unsupported-zip",
            entry: undefined,
            message: /several disks/,
        });
    });

    it("no zip64 records", async () => {
        await refused(file({ zip: { zip64Locator: true } }), {
            code: "unsupported-zip",
            entry: undefined,
            message: /zip64/,
        });
    });

    it("at most 65 534 entries", async () => {
        await refused(rawZip([], { count: 0xffff }), {
            code: "unsupported-zip",
            entry: undefined,
            message: /65 535/,
        });
    });

    it("the central directory ends where the end record starts", async () => {
        await refused(file({ zip: { gap: new Uint8Array(4) } }), {
            code: "not-a-zip",
            entry: undefined,
            message: /does not end where its end record starts/,
        });
    });

    it("the end record with its comment ends the file", async () => {
        await refused(file({ zip: { trailer: new Uint8Array([0, 0, 0]) } }), {
            code: "not-a-zip",
            entry: undefined,
            message: /end-of-central-directory/,
        });
    });

    it("an entry that is read is not encrypted", async () => {
        await refused(file({ raw: { "manifest.json": { flags: 1 } } }), {
            code: "unsupported-zip",
            entry: "manifest.json",
            message: /encrypted/,
        });
    });

    it("an entry that is read is stored or deflated", async () => {
        await refused(file({ raw: { "project.json": { method: 14 } } }), {
            code: "unsupported-zip",
            entry: "project.json",
            message: /method 14/,
        });
    });

    it("no two entries have the same name", async () => {
        const again = { name: TOWN, data: BASE[TOWN]! };
        await refused(file({ extra: [again] }), {
            code: "unsupported-zip",
            entry: TOWN,
            message: /two entries/,
        });
    });

    it("the local header carries the central directory's name", async () => {
        await refused(file({ raw: { "project.json": { localName: "project.jsoN" } } }), {
            code: "not-a-zip",
            entry: "project.json",
            message: /local header/,
        });
    });

    it("every entry read has a matching CRC-32", async () => {
        await refused(file({ raw: { [TOWN]: { crc: 0x1234 } } }), {
            code: "corrupt-entry",
            entry: TOWN,
            message: /checksum/,
        });
    });

    it("every entry read has exactly its stated uncompressed size", async () => {
        const stored = BASE["project.json"]!.length;
        await refused(file({ raw: { "project.json": { size: stored - 1 } } }), {
            code: "corrupt-entry",
            entry: "project.json",
            message: /states/,
        });
        await refused(file({ raw: { "project.json": { deflate: true, size: stored + 5 } } }), {
            code: "corrupt-entry",
            entry: "project.json",
            message: /inflates to/,
            inflates: 1,
        });
    });
});

describe("FORMAT §2.2 entries and JSON rules", () => {
    it("every entry but the thumbnails is required", async () => {
        const without = (name: string) => file({ edit: (files) => delete files[name] });
        await refused(without("manifest.json"), {
            code: "missing-manifest",
            entry: "manifest.json",
        });
        await refused(without("project.json"), { code: "missing-entry", entry: "project.json" });
        await refused(without(DUNGEON), { code: "missing-entry", entry: DUNGEON });
        await refused(without(TILESET), { code: "missing-entry", entry: TILESET });
        await refused(without("images/img-2.png"), {
            code: "missing-entry",
            entry: "images/img-2.png",
            decodes: 5,
        });
    });

    it("a missing member is refused", async () => {
        const bytes = file({
            edit: (files) =>
                editJson(files, "project.json", (value) => delete value.exportSettings),
        });
        await refused(bytes, {
            code: "invalid-project",
            entry: "project.json",
            message: /no member `exportSettings`/,
        });
    });

    it("an unknown member is refused", async () => {
        const bytes = file({
            edit: (files) => editJson(files, TOWN, (value) => (value.layers[0].extra = 1)),
        });
        await refused(bytes, {
            code: "invalid-map",
            entry: TOWN,
            message: /`layers\[0\]` has an unknown member "extra"/,
        });
    });

    it("a member name repeated in an object is refused", async () => {
        const text = strFromU8(BASE["project.json"]!).replace(
            '"name": "Every member",',
            '"name": "A", "name": "B",',
        );
        const bytes = file({
            edit: (files) => (files["project.json"] = new TextEncoder().encode(text)),
        });
        await refused(bytes, {
            code: "corrupt-entry",
            entry: "project.json",
            message: /two members of the same name/,
        });
    });

    it("a byte order mark is skipped", async () => {
        const bom = (data: Uint8Array) => new Uint8Array([0xef, 0xbb, 0xbf, ...data]);
        const bytes = file({
            edit: (files) => {
                files["manifest.json"] = bom(files["manifest.json"]!);
                files["project.json"] = bom(files["project.json"]!);
                files[TOWN] = bom(files[TOWN]!);
            },
        });
        await expect(deserialize(bytes)).resolves.toBeDefined();
    });

    it("text that is not UTF-8 JSON is refused", async () => {
        const bytes = file({ edit: (files) => (files[TOWN] = new TextEncoder().encode("{ nope")) });
        await refused(bytes, { code: "corrupt-entry", entry: TOWN, message: /not valid JSON/ });
        const latin = file({ edit: (files) => (files[TOWN] = new Uint8Array([0x7b, 0xff, 0x7d])) });
        await refused(latin, { code: "corrupt-entry", entry: TOWN, message: /not UTF-8/ });
    });

    it("null is accepted only where a row allows it", async () => {
        const bytes = file({
            edit: (files) => editJson(files, TOWN, (value) => (value.class = null)),
        });
        await refused(bytes, {
            code: "invalid-map",
            entry: TOWN,
            message: /`class` must be a string/,
        });
    });
});

/** A project.json edit that must be refused as "invalid-project" naming the limit. */
async function projectLimit(edit: (value: Json) => void, message: RegExp): Promise<void> {
    const bytes = file({ edit: (files) => editJson(files, "project.json", edit) });
    await refused(bytes, { code: "invalid-project", entry: "project.json", message });
}

/** A map edit that must be refused as "invalid-map" naming the limit. */
async function mapLimit(name: string, edit: (value: Json) => void, message: RegExp): Promise<void> {
    const bytes = file({ edit: (files) => editJson(files, name, edit) });
    await refused(bytes, { code: "invalid-map", entry: name, message });
}

const many = (count: number, item: unknown = 0) => new Array<unknown>(count).fill(item);

function markerLayer(id: number): Json {
    return {
        id,
        type: "marker",
        name: "",
        class: "",
        visible: true,
        locked: false,
        opacity: 255,
        offsetX: 0,
        offsetY: 0,
        parallaxX: 1,
        parallaxY: 1,
        properties: [],
        color: "#ffffffff",
        markers: [],
    };
}

describe("FORMAT §1.2 tilesets of a map", () => {
    it("reads a tileset listed twice, each span naming its tiles (only overlapping spans are refused)", async () => {
        const bytes = file({
            edit: (files) =>
                editJson(files, DUNGEON, (m) => {
                    m.tilesets.push({ tileset: "ts_collection", firstGid: 100 });
                    m.layers[0].data[1] = 102; // tile 2 through the second span
                }),
        });
        const project = await deserialize(bytes);
        const layer = project.maps[1]!.layers[0]!;
        expect(layer.type === "tile" && layer.cells.get(1, 0)).toBe((4 << 20) | 2);
    });
});

describe("FORMAT §2.8 count limits, before decoding", () => {
    it("maps: 256", () =>
        projectLimit((p) => (p.maps = many(257)), /`maps` holds 257 items; at most 256/));
    it("tilesets: 255", () =>
        projectLimit((p) => (p.tilesets = many(256)), /`tilesets` holds 256 items; at most 255/));
    it("images: 256", () =>
        projectLimit((p) => (p.images = many(257)), /`images` holds 257 items; at most 256/));
    it("tiles per tileset: 65 536", () =>
        projectLimit(
            (p) => (p.tilesets[0].tiles = many(65_537)),
            /`tilesets\[0\]\.tiles` holds 65537 items; at most 65536/,
        ));
    it("tile ID: 1 048 575", () =>
        projectLimit(
            (p) => (p.tilesets[0].tiles[0].id = 1_048_576),
            /`tilesets\[0\]\.tiles\[0\]\.id` must be an integer from 0 to 1048575/,
        ));
    it("tiles in all tilesets: 262 144", () =>
        projectLimit((p) => {
            for (let i = 0; i < 4; i += 1) p.tilesets[i].tiles = many(65_536);
            p.tilesets[0].tiles.push(0);
        }, /hold more than 262144 tiles together/));
    it("animation frames per tile: 1024", () =>
        projectLimit(
            (p) => (p.tilesets[0].tiles[0].animation = many(1025)),
            /animation` holds 1025 items; at most 1024/,
        ));
    it("animation frames per tileset: 65 536", () =>
        projectLimit((p) => {
            const tile = p.tilesets[0].tiles[0];
            const frames = many(1024, { tile: 0, ms: 1 });
            p.tilesets[0].nextTileId = 100;
            p.tilesets[0].columns = 64;
            p.tilesets[0].source.kind = "atlas";
            p.tilesets[0].source.margin = 0;
            p.tilesets[0].source.spacing = 0;
            p.tilesets[0].tiles = Array.from({ length: 65 }, (_, id) => ({
                ...tile,
                id,
                source: `f${id}`,
                animation: id === 64 ? many(1, { tile: 0, ms: 1 }) : frames,
            }));
            p.tilesets[0].terrainSets = [];
        }, /hold more than 65536 animation frames together/));
    it("collision shapes per tile: 64", () =>
        projectLimit(
            (p) => (p.tilesets[0].tiles[0].collision = many(65)),
            /collision` holds 65 items; at most 64/,
        ));
    it("points per shape: 1024", () =>
        projectLimit(
            (p) => (p.tilesets[0].tiles[0].collision[2].points = many(1025, [0, 0])),
            /points` holds 1025 items; at most 1024/,
        ));
    it("terrain sets per tileset: 256", () =>
        projectLimit(
            (p) => (p.tilesets[0].terrainSets = many(257)),
            /terrainSets` holds 257 items; at most 256/,
        ));
    it("terrains per set: 254", () =>
        projectLimit(
            (p) => (p.tilesets[0].terrainSets[2].colors = many(255)),
            /colors` holds 255 items; at most 254/,
        ));
    it("properties per list: 256", () =>
        projectLimit(
            (p) => (p.properties = many(257)),
            /`properties` holds 257 items; at most 256/,
        ));
    it("length of an ID: 64", () =>
        projectLimit((p) => (p.id = "a".repeat(65)), /`id` must be an ID of 1 to 64 characters/));
    it("length of a slug: 64", () =>
        projectLimit(
            (p) => (p.exportName = "a".repeat(65)),
            /`exportName` must be a slug of 1 to 64 characters/,
        ));
    it("length of a text: 255 UTF-16 code units", async () => {
        await projectLimit(
            (p) => (p.name = "\u{1F600}".repeat(127) + "ab"),
            /`name` must be at most 255 UTF-16 code units long, got 256/,
        );
        // 255 code units are allowed.
        const bytes = file({
            edit: (files) =>
                editJson(files, "project.json", (p) => (p.name = "\u{1F600}".repeat(127) + "a")),
        });
        await expect(deserialize(bytes)).resolves.toBeDefined();
    });
    it("map side: 4096", () =>
        mapLimit(TOWN, (m) => (m.width = 4097), /`width` must be an integer from 1 to 4096/));
    it("cells per tile layer: 1 048 576", () =>
        mapLimit(
            TOWN,
            (m) => {
                m.width = 1024;
                m.height = 1025;
            },
            /makes 1049600 cells a layer; at most 1048576/,
        ));
    it("layers per map: 256", () =>
        mapLimit(
            TOWN,
            (m) => {
                // One group of 256: 257 in the whole tree.
                const group = { ...markerLayer(1), type: "group" };
                delete group.color;
                delete group.markers;
                group.layers = Array.from({ length: 256 }, (_, i) => markerLayer(i + 2));
                m.layers = [group];
                m.nextLayerId = 1000;
            },
            /`layers\[0\]\.layers\[255\]` is one layer more than the 256/,
        ));
    it("group depth: 16", () =>
        mapLimit(
            TOWN,
            (m) => {
                let layers: Json[] = [];
                for (let depth = 17; depth >= 1; depth -= 1) {
                    layers = [
                        {
                            ...markerLayer(100 + depth),
                            type: "group",
                            color: undefined,
                            markers: undefined,
                            layers,
                        },
                    ];
                    delete layers[0].color;
                    delete layers[0].markers;
                }
                m.layers = layers;
                m.nextLayerId = 1000;
            },
            /nests groups 17 deep; at most 16/,
        ));
    it("markers per map: 16 384", () =>
        mapLimit(TOWN, (m) => (m.layers[2].markers = many(16_385)), /more than 16384 markers/));
    it("marker points per map: 262 144", () =>
        mapLimit(
            TOWN,
            (m) => (m.layers[2].markers = many(257, { points: many(1021) })),
            /more than 262144 marker points/,
        ));
    it("cells of all tile layers of a map: 4 194 304", { timeout: 60_000 }, async () => {
        // Compact JSON: five full 1024 × 1024 layers stay under the entry limit.
        const bytes = file({
            edit: (files) => {
                const map = json(files, DUNGEON);
                map.width = 1024;
                map.height = 1024;
                const layer = map.layers[0];
                map.layers = Array.from({ length: 5 }, (_, i) => ({
                    ...layer,
                    id: i + 1,
                    data: many(1_048_576, 1),
                }));
                map.nextLayerId = 6;
                files[DUNGEON] = new TextEncoder().encode(JSON.stringify(map));
            },
        });
        await refused(bytes, {
            code: "invalid-map",
            entry: DUNGEON,
            message: /`layers\[4\]\.data` make more than 4194304 cells/,
        });
    });
});

describe("FORMAT §2.8 pixel limits (§2.9 step 5), before any PNG is read", () => {
    /**
     * Tilesets or images stating 64 MP and more. Their PNG entries stay (at their old sizes), so
     * a decode that ran before step 5 would show on the spy.
     */
    function overLimit(kind: "tilesets" | "images"): Uint8Array {
        return file({
            edit: (files) => {
                editJson(files, "project.json", (p) => {
                    if (kind === "images") {
                        p.images[0].width = 8192;
                        p.images[0].height = 8192;
                        p.images[1].width = 1;
                        p.images[1].height = 1;
                        return;
                    }
                    // 32 × 32 tiles of 256 px: 8192 × 8192, and one 1 × 1 tile more elsewhere.
                    const set = p.tilesets[0];
                    const tile = set.tiles[0];
                    Object.assign(set, {
                        tileWidth: 256,
                        tileHeight: 256,
                        columns: 32,
                        nextTileId: 1024,
                        terrainSets: [],
                    });
                    set.source = { kind: "atlas", fileName: "big.png", margin: 0, spacing: 0 };
                    set.tiles = Array.from({ length: 1024 }, (_, id) => ({
                        ...tile,
                        id,
                        source: `f${id}`,
                        collision: [],
                        animation: [],
                    }));
                    Object.assign(p.tilesets[2], { tileWidth: 1, tileHeight: 1, columns: 1 });
                    p.tilesets[2].tiles = [p.tilesets[2].tiles[0]];
                });
                // The town map names tiles the changed tilesets no longer have.
                editJson(files, TOWN, (m) => {
                    m.tilesets = [];
                    m.layers = [markerLayer(1)];
                });
            },
        });
    }

    it(`tileset pixels: ${MAX_TILESET_PIXELS}`, async () => {
        await refused(overLimit("tilesets"), {
            code: "too-large",
            entry: "project.json",
            message: /tileset images of the project hold 67109261 pixels; the limit is 67108864/,
        });
    });

    it(`image pixels: ${MAX_IMAGE_PIXELS}`, async () => {
        await refused(overLimit("images"), {
            code: "too-large",
            entry: "project.json",
            message: /images of the project hold 67108865 pixels; the limit is 67108864/,
        });
    });
});

describe("FORMAT §2.8 size limits, before inflating or decoding", () => {
    // Each oversized entry is deflated and states its size: nothing may inflate it.
    it(`manifest.json: ${MAX_MANIFEST_BYTES} bytes`, async () => {
        await refused(
            file({ raw: { "manifest.json": { deflate: true, size: MAX_MANIFEST_BYTES + 1 } } }),
            {
                code: "too-large",
                entry: "manifest.json",
                message: /65537 bytes; the limit is 65536/,
            },
        );
    });

    it(`project.json: ${MAX_PROJECT_JSON_BYTES} bytes`, async () => {
        await refused(
            file({ raw: { "project.json": { deflate: true, size: MAX_PROJECT_JSON_BYTES + 1 } } }),
            {
                code: "too-large",
                entry: "project.json",
            },
        );
    });

    it(`one map: ${MAX_MAP_JSON_BYTES} bytes`, async () => {
        await refused(
            file({ raw: { [DUNGEON]: { deflate: true, size: MAX_MAP_JSON_BYTES + 1 } } }),
            {
                code: "too-large",
                entry: DUNGEON,
            },
        );
    });

    it("one PNG: height × (4 × width + 1) + 65 536 bytes", async () => {
        // TS-image is 9 × 2 tiles... 3 columns of 8 px by 2 rows of 6 px: 24 × 12.
        const limit = maxPngBytes(24, 12);
        expect(limit).toBe(12 * 97 + 65_536);
        await refused(file({ raw: { [TILESET]: { deflate: true, size: limit + 1 } } }), {
            code: "too-large",
            entry: TILESET,
            message: new RegExp(`${limit + 1} bytes; the limit is ${limit}`),
        });
    });

    it(`all entries together: ${MAX_CONTENT_BYTES} bytes`, async () => {
        expect(MAX_CONTENT_BYTES).toBe(2 ** 31);
        // The reader is given a smaller total: the entries read up to project.json pass it.
        const total = BASE["manifest.json"]!.length + BASE["project.json"]!.length - 1;
        await refused(
            file(),
            { code: "too-large", entry: "project.json", message: /more than \d+ bytes/ },
            (bytes) => readProjectFile(bytes, total),
        );
    });
});

describe("FORMAT §2.9 reading order", () => {
    it("step 1: the container", async () => {
        await refused(new TextEncoder().encode("not a zip at all"), {
            code: "not-a-zip",
            entry: undefined,
        });
    });

    it("step 2: manifest.json, before project.json", async () => {
        const manifest = (value: unknown) =>
            file({
                edit: (files) => {
                    files["manifest.json"] = encodeJson(value);
                    delete files["project.json"];
                },
            });
        await refused(manifest({ format: "ngne-sprite-project", version: 1, generator: "" }), {
            code: "invalid-manifest",
            entry: "manifest.json",
            message: /not a tilemap project/,
        });
        await refused(manifest({ format: "ngne-tilemap-project", version: 0, generator: "" }), {
            code: "invalid-manifest",
            entry: "manifest.json",
        });
        await refused(manifest({ format: "ngne-tilemap-project", version: 1 }), {
            code: "invalid-manifest",
            entry: "manifest.json",
            message: /no member `generator`/,
        });
        // A newer version is refused naming both versions, without reading its other members.
        await refused(manifest({ format: "ngne-tilemap-project", version: 3, future: true }), {
            code: "newer-version",
            entry: "manifest.json",
            message: /version 3.*up to version 1/,
        });
    });

    it("step 3: project.json, its references and its distinct IDs and export names", async () => {
        await projectLimit(
            (p) => (p.tilesets[0].tiles[1].animation[0].tile = 1),
            /animation\[0\]\.tile` names tile 1, which is not in the tileset/,
        );
        await projectLimit(
            (p) => (p.tilesets[0].tiles[1].id = 9),
            /`tilesets\[0\]\.tiles\[1\]\.id` is 9, not below the tileset's nextTileId 8/,
        );
        await projectLimit((p) => (p.tilesets[0].tiles[1].id = 0), /repeats the tile ID 0/);
        await projectLimit(
            (p) => (p.tilesets[0].terrainSets[0].tiles[0].wangId[1] = 3),
            /wangId\[1\]` must be an integer from 0 to 2/,
        );
        await projectLimit(
            (p) => (p.tilesets[0].terrainSets[0].tiles[0].wangId[0] = 1),
            /wangId\[0\]` must be an integer from 0 to 0/,
        );
        await projectLimit(
            (p) => (p.images[1].id = "ts-ATLAS"),
            /is the ID "ts-ATLAS" of tilesets\[2\] as well/,
        );
        await projectLimit(
            (p) => (p.maps[1].id = "MAP-TOWN"),
            /is the ID "MAP-TOWN" of maps\[0\] as well/,
        );
        await projectLimit(
            (p) => (p.images[0].exportName = "tileset-2"),
            /export name of tilesets\[1\] as well/,
        );
        await projectLimit(
            (p) => (p.tilesets[1].tiles[1].source = p.tilesets[1].tiles[0].source),
            /repeats the source key/,
        );
        await projectLimit(
            (p) => (p.tilesets[2].source.margin = 1),
            /`tilesets\[2\]\.source\.margin` must be an integer from 0 to 0/,
        );
    });

    it("step 4: every map, its tilesets, layers, markers and cells", async () => {
        await mapLimit(
            TOWN,
            (m) => (m.id = "map-dungeon"),
            /`id` is map-dungeon; the project lists this map as map-town/,
        );
        await mapLimit(
            DUNGEON,
            (m) => (m.exportName = "hills"),
            /export name of images\[1\] as well/,
        );
        await mapLimit(
            TOWN,
            (m) => (m.layers[0].data = m.layers[0].data.slice(1)),
            /holds 44 cells; the map has 45/,
        );
        await mapLimit(
            TOWN,
            (m) => (m.layers[0].data[0] = 30),
            /is GID 30, in the span of no tileset/,
        );
        await mapLimit(
            TOWN,
            (m) => (m.layers[0].data[0] = 2),
            /names tile 1 of tileset TS-image, which it lacks/,
        );
        await mapLimit(
            TOWN,
            (m) => (m.layers[0].data[0] = 0x80000000),
            /sets a flag on an empty cell/,
        );
        await mapLimit(TOWN, (m) => (m.layers[0].data[0] = 0x10000001), /sets the reserved bit 28/);
        await mapLimit(
            TOWN,
            (m) => (m.layers[0].data[0] = -1),
            /must be an integer from 0 to 4294967295/,
        );
        await mapLimit(
            TOWN,
            (m) => (m.tilesets[1].firstGid = 8),
            /starts a span inside the span before it/,
        );
        await mapLimit(
            TOWN,
            (m) => (m.tilesets[2].tileset = "nope"),
            /names the tileset nope, which the project lacks/,
        );
        await mapLimit(
            TOWN,
            (m) => (m.nextLayerId = 14),
            /`nextLayerId` is 14, not above the layer ID 14/,
        );
        await mapLimit(TOWN, (m) => (m.layers[1].id = 1), /repeats the layer ID 1/);
        await mapLimit(TOWN, (m) => (m.layers[2].markers[1].id = 3), /repeats the marker ID 3/);
        await mapLimit(TOWN, (m) => (m.nextMarkerId = 39), /is 39, not below nextMarkerId 39/);
        await mapLimit(
            TOWN,
            (m) => (m.layers[3].image = "img-3"),
            /names the image img-3, which the project lacks/,
        );
        await mapLimit(
            TOWN,
            (m) => {
                m.layers[4].offsetX = 1_048_576;
                m.layers[4].layers[0].offsetX = 1;
            },
            /`layers\[4\]\.layers\[0\]` has the effective offset \(1048577/,
        );
        await mapLimit(TOWN, (m) => (m.layers = []), /holds no layer/);
    });

    it("step 6: every PNG, its header before its pixels", async () => {
        const png = (edit: (bytes: Uint8Array) => Uint8Array) =>
            file({ edit: (files) => (files[TILESET] = edit(new Uint8Array(files[TILESET]!))) });
        await refused(
            png(() => new Uint8Array([1, 2, 3])),
            {
                code: "corrupt-entry",
                entry: TILESET,
                message: /not a PNG file/,
            },
        );
        await refused(
            png(() =>
                encodePng({ width: 24, height: 13, data: new Uint8ClampedArray(24 * 13 * 4) }),
            ),
            {
                code: "image-size",
                entry: TILESET,
                message: /24×13 pixels; tileset TS-image states 24×12/,
            },
        );
        await refused(
            png((bytes) => {
                bytes[25] = 2; // colour type RGB
                return bytes;
            }),
            { code: "image-format", entry: TILESET, message: /colour type 2/ },
        );
        await refused(
            png((bytes) => {
                bytes[24] = 16; // 16 bits per sample
                return bytes;
            }),
            { code: "image-format", entry: TILESET, message: /16 bits/ },
        );
        await refused(
            png((bytes) => {
                bytes[28] = 1; // Adam7
                return bytes;
            }),
            { code: "image-format", entry: TILESET, message: /interlaced/ },
        );
        // A sound header and broken pixel data reach the decoder, which refuses them.
        await refused(
            png((bytes) => bytes.subarray(0, 40)),
            {
                code: "corrupt-entry",
                entry: TILESET,
                decodes: 1,
            },
        );
    });

    it("stops at the first problem: a step 3 problem hides a step 6 one", async () => {
        const bytes = file({
            edit: (files) => {
                delete files[TILESET];
                editJson(files, "project.json", (p) => (p.name = " "));
            },
        });
        await refused(bytes, {
            code: "invalid-project",
            entry: "project.json",
            message: /must not be blank/,
        });
    });
});

describe("migrations (FORMAT §2.10)", () => {
    it("version 1 has the identity step", () => {
        expect(MIGRATIONS).toHaveLength(1);
        const value = { any: "thing" };
        expect(MIGRATIONS[0]!.project(value)).toBe(value);
        expect(MIGRATIONS[0]!.map(value)).toBe(value);
        expect(migrate("project", value, 1)).toBe(value);
    });

    it("an older version runs every step from its own on", () => {
        const steps = [
            { project: (v: unknown) => ({ step1: v }), map: (v: unknown) => v },
            { project: (v: unknown) => ({ step2: v }), map: (v: unknown) => v },
        ];
        expect(migrate("project", "x", 1, steps)).toEqual({ step2: { step1: "x" } });
        expect(migrate("project", "x", 2, steps)).toEqual({ step2: "x" });
    });

    it("a newer version is refused naming both", () => {
        expect(() => migrate("map", {}, 2)).toThrow(/version 2.*up to version 1/);
    });
});

describe("the writer refuses what it could not read back, naming the entry", () => {
    function refusedWrite(
        edit: (project: ReturnType<typeof everyMemberProject>) => void,
        code: ProjectErrorCode,
        entry: string,
        message?: RegExp,
    ) {
        const project = everyMemberProject();
        edit(project);
        let error: unknown = null;
        try {
            serialize(project);
        } catch (caught) {
            error = caught;
        }
        expect(error).toBeInstanceOf(ProjectError);
        expect({
            code: (error as ProjectError).code,
            entry: (error as ProjectError).entry,
        }).toEqual({ code, entry });
        if (message) expect((error as ProjectError).message).toMatch(message);
    }

    it("a project break", () => {
        refusedWrite((p) => (p.name = ""), "invalid-project", "project.json", /must not be blank/);
        refusedWrite(
            (p) => (p.tilesets[0]!.tiles[0]!.animation = [{ tile: 99, ms: 5 }]),
            "invalid-project",
            "project.json",
        );
    });

    it("a map break", () => {
        refusedWrite((p) => (p.maps[1]!.nextLayerId = 1), "invalid-map", DUNGEON, /nextLayerId/);
        refusedWrite(
            (p) => {
                const layer = p.maps[1]!.layers[0]!;
                if (layer.type === "tile") layer.cells.set(0, 0, (4 << 20) | 1); // tile 1 was deleted
            },
            "invalid-map",
            DUNGEON,
            /names tile 1/,
        );
        refusedWrite(
            (p) => {
                const layer = p.maps[1]!.layers[0]!;
                if (layer.type === "tile") layer.cells.set(0, 0, (9 << 20) | 1); // no tileset in slot 9
            },
            "invalid-map",
            DUNGEON,
        );
    });

    it("pixels that do not have the stated size", () => {
        refusedWrite(
            (p) =>
                (p.tilesets[0]!.pixels = {
                    width: 24,
                    height: 13,
                    data: new Uint8ClampedArray(24 * 13 * 4),
                }),
            "image-size",
            TILESET,
        );
    });

    it("a JSON entry over its size limit", () => {
        refusedWrite(
            (p) => {
                const map = p.maps[1]!;
                map.properties = Array.from({ length: 256 }, (_, i) => ({
                    name: `p${String(i).padStart(3, "0")}`,
                    type: "string" as const,
                    value: "\u0001".repeat(65_535),
                }));
                // 256 × 65 535 × 6 escaped bytes: about 100 MB.
            },
            "too-large",
            DUNGEON,
            /the limit is 67108864 bytes/,
        );
    });
});
