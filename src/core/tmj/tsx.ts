import { TmjError } from "./errors";
import type { JsonObject } from "./json";
import { parseXml } from "./xml";
import type { XmlElement } from "./xml";

// A TSX tileset (Tiled's XML, `mapreader.cpp` / `mapwriter.cpp` v1.12.2) as the JSON object a
// TSJ of the same tileset holds (reference/tiled.md §5), so that both go through one conversion
// and convert identically (TE-060). Attributes Tiled leaves out stay out, so the JSON reader's
// defaults apply to both alike.

type Converter = (value: string, what: string) => unknown;

function number(value: string, what: string): number {
    const parsed = value.trim() === "" ? Number.NaN : Number(value);
    if (!Number.isFinite(parsed)) throw new TmjError("format", `${what} is not a number.`);
    return parsed;
}

const text: Converter = (value) => value;
const flag: Converter = (value) => value === "1" || value === "true";

/** Copies the attributes named in `keys` onto `into`, converted, under the JSON key. */
function copy(
    element: XmlElement,
    into: JsonObject,
    keys: Readonly<Record<string, readonly [string, Converter]>>,
    what: string,
): void {
    for (const [attribute, [key, convert]] of Object.entries(keys)) {
        const value = element.attributes[attribute];
        if (value !== undefined) into[key] = convert(value, `${what}: ${attribute}`);
    }
}

const child = (element: XmlElement, name: string): XmlElement | undefined =>
    element.children.find((entry) => entry.name === name);

const childrenNamed = (element: XmlElement, name: string): XmlElement[] =>
    element.children.filter((entry) => entry.name === name);

/** A property's value as the JSON writes it: numbers, booleans, members, list items. */
function propertyValue(element: XmlElement, type: string, what: string): unknown {
    const raw = element.attributes.value ?? element.text;
    switch (type) {
        case "int":
        case "float":
        case "object": {
            const parsed = Number(raw);
            return raw.trim() !== "" && Number.isFinite(parsed) ? parsed : raw;
        }
        case "bool":
            return raw === "true" ? true : raw === "false" ? false : raw;
        case "class":
            return Object.fromEntries(
                properties(child(element, "properties"), what).map((property) => [
                    property.name,
                    property.value,
                ]),
            );
        case "list":
            return childrenNamed(element, "item").map((item) => {
                const itemType = item.attributes.type ?? "string";
                return { type: itemType, value: propertyValue(item, itemType, what) };
            });
        default:
            return raw;
    }
}

function properties(element: XmlElement | undefined, what: string): JsonObject[] {
    if (!element) return [];
    return childrenNamed(element, "property").map((property) => {
        const type = property.attributes.type ?? "string";
        const out: JsonObject = { name: property.attributes.name ?? "", type };
        if (property.attributes.propertytype !== undefined) {
            out.propertytype = property.attributes.propertytype;
        }
        out.value = propertyValue(property, type, what);
        return out;
    });
}

/** Sets `properties` when the element has a `<properties>` child. */
function copyProperties(element: XmlElement, into: JsonObject, what: string): void {
    const list = child(element, "properties");
    if (list) into.properties = properties(list, what);
}

function points(value: string, what: string): JsonObject[] {
    return value
        .trim()
        .split(/\s+/)
        .map((pair) => {
            const [x, y, extra] = pair.split(",");
            if (x === undefined || y === undefined || extra !== undefined) {
                throw new TmjError("format", `${what}: "${pair}" is not a point.`);
            }
            return { x: number(x, what), y: number(y, what) };
        });
}

function object(element: XmlElement, what: string): JsonObject {
    const out: JsonObject = {};
    copy(
        element,
        out,
        {
            id: ["id", number],
            name: ["name", text],
            type: ["type", text],
            class: ["class", text],
            x: ["x", number],
            y: ["y", number],
            width: ["width", number],
            height: ["height", number],
            rotation: ["rotation", number],
            gid: ["gid", number],
            visible: ["visible", flag],
            template: ["template", text],
        },
        what,
    );
    for (const shape of element.children) {
        if (shape.name === "ellipse" || shape.name === "point" || shape.name === "capsule") {
            out[shape.name] = true;
        } else if (shape.name === "polygon" || shape.name === "polyline") {
            out[shape.name] = points(shape.attributes.points ?? "", `${what}: ${shape.name}`);
        } else if (shape.name === "text") {
            out.text = { text: shape.text };
        }
    }
    copyProperties(element, out, what);
    return out;
}

function image(element: XmlElement, into: JsonObject, what: string): void {
    copy(
        element,
        into,
        { source: ["image", text], width: ["imagewidth", number], height: ["imageheight", number] },
        what,
    );
    const trans = element.attributes.trans;
    if (trans !== undefined && trans !== "") {
        into.transparentcolor = trans.startsWith("#") ? trans : `#${trans}`;
    }
}

function tile(element: XmlElement, what: string): JsonObject {
    const out: JsonObject = {};
    copy(
        element,
        out,
        {
            id: ["id", number],
            type: ["type", text],
            class: ["class", text],
            probability: ["probability", number],
            x: ["x", number],
            y: ["y", number],
            width: ["width", number],
            height: ["height", number],
        },
        what,
    );
    const at = `${what}, tile ${element.attributes.id ?? "?"}`;
    const picture = child(element, "image");
    if (picture) {
        const fields: JsonObject = {};
        image(picture, fields, at);
        // A tile image has no colour key of its own in the JSON.
        delete fields.transparentcolor;
        Object.assign(out, fields);
    }
    const group = child(element, "objectgroup");
    if (group) {
        const collision: JsonObject = { type: "objectgroup" };
        copy(group, collision, { draworder: ["draworder", text] }, at);
        collision.objects = childrenNamed(group, "object").map((entry) => object(entry, at));
        out.objectgroup = collision;
    }
    const animation = child(element, "animation");
    if (animation) {
        out.animation = childrenNamed(animation, "frame").map((frame) => {
            const entry: JsonObject = {};
            copy(frame, entry, { tileid: ["tileid", number], duration: ["duration", number] }, at);
            return entry;
        });
    }
    copyProperties(element, out, at);
    return out;
}

function wangSet(element: XmlElement, what: string): JsonObject {
    const out: JsonObject = {};
    copy(
        element,
        out,
        {
            name: ["name", text],
            class: ["class", text],
            type: ["type", text],
            tile: ["tile", number],
        },
        what,
    );
    const at = `${what}, terrain set ${element.attributes.name ?? "?"}`;
    out.colors = childrenNamed(element, "wangcolor").map((color) => {
        const entry: JsonObject = {};
        copy(
            color,
            entry,
            {
                name: ["name", text],
                class: ["class", text],
                color: ["color", text],
                tile: ["tile", number],
                probability: ["probability", number],
            },
            at,
        );
        copyProperties(color, entry, at);
        return entry;
    });
    out.wangtiles = childrenNamed(element, "wangtile").map((entry) => {
        const wangId = (entry.attributes.wangid ?? "").split(",").map((v) => number(v, at));
        return { tileid: number(entry.attributes.tileid ?? "", `${at}: tileid`), wangid: wangId };
    });
    copyProperties(element, out, at);
    return out;
}

/** The TSJ object of the TSX `text`. Throws `TmjError` ("format") when it is not a tileset. */
export function tsxToJson(text: string, what: string): JsonObject {
    const root = parseXml(text, what);
    if (root.name !== "tileset") throw new TmjError("format", `${what} is not a Tiled tileset.`);
    const out: JsonObject = { type: "tileset" };
    copy(
        root,
        out,
        {
            name: ["name", (value) => value],
            class: ["class", (value) => value],
            tilewidth: ["tilewidth", number],
            tileheight: ["tileheight", number],
            spacing: ["spacing", number],
            margin: ["margin", number],
            tilecount: ["tilecount", number],
            columns: ["columns", number],
            objectalignment: ["objectalignment", (value) => value],
            tilerendersize: ["tilerendersize", (value) => value],
            fillmode: ["fillmode", (value) => value],
            backgroundcolor: ["backgroundcolor", (value) => value],
        },
        what,
    );
    const picture = child(root, "image");
    if (picture) image(picture, out, what);
    const offset = child(root, "tileoffset");
    if (offset) {
        const entry: JsonObject = {};
        copy(offset, entry, { x: ["x", number], y: ["y", number] }, `${what}: tileoffset`);
        out.tileoffset = entry;
    }
    const transformations = child(root, "transformations");
    if (transformations) {
        const entry: JsonObject = {};
        copy(
            transformations,
            entry,
            {
                hflip: ["hflip", flag],
                vflip: ["vflip", flag],
                rotate: ["rotate", flag],
                preferuntransformed: ["preferuntransformed", flag],
            },
            what,
        );
        out.transformations = entry;
    }
    copyProperties(root, out, what);
    const tiles = childrenNamed(root, "tile");
    if (tiles.length > 0) out.tiles = tiles.map((entry) => tile(entry, what));
    const wangSets = child(root, "wangsets");
    if (wangSets) {
        out.wangsets = childrenNamed(wangSets, "wangset").map((entry) => wangSet(entry, what));
    }
    return out;
}
