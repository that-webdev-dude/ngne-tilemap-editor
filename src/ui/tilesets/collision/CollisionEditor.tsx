import {
    Circle,
    Magnet,
    MousePointer2,
    Pentagon,
    Spline,
    Square,
    Trash2,
    ZoomIn,
    ZoomOut,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import {
    HANDLE_REACH,
    HANDLE_SIZE,
    handlePoints,
    hitBox,
    scaleBox,
} from "../../../app/selection/transform/handles";
import type { HandleId } from "../../../app/selection/transform/handles";
import { useSession } from "../../../app/state/session";
import { applyCollision, editedTile } from "../../../app/tilesets/collision/collisionEditor";
import type { CollisionEditorRequest } from "../../../app/tilesets/collision/collisionEditor";
import {
    dragBox,
    hitEdge,
    hitShape,
    hitVertex,
    toolPoint,
} from "../../../app/tilesets/collision/collisionTools";
import type { CollisionTool } from "../../../app/tilesets/collision/collisionTools";
import {
    MAX_COLLISION_COORD,
    MAX_COLLISION_SHAPES,
    MAX_SHAPE_POINTS,
    MIN_POLYGON_POINTS,
    absolutePoints,
    fitShape,
    insertPolygonPoint,
    movePolygonPoint,
    moveShape,
    polygonShape,
    removePolygonPoint,
    shapeBox,
} from "../../../core/model";
import type { Shape, ShapeBox, ShapePoint, Tileset } from "../../../core/model";
import type { CollisionEdit } from "../../../core/tileset";
import { runCommand } from "../../commands/runCommand";
import { PixelCanvas } from "../../import/PixelCanvas";
import {
    Button,
    Dialog,
    Icon,
    IconButton,
    NumberField,
    Toggle,
    ToolButton,
} from "../../primitives";
import { tilePixels } from "../tilePixels";
import "./collision.css";

// The Collision Editor (DESIGN §9; SPEC §6.4; TE-029), a large dialog: the tool strip (select,
// edit points, rectangle, ellipse, polygon, snap), the tile at zoom 1–32 with its shapes over
// it, and the shape list with the X/Y/W/H fields of the selected shape; Close. Every edit is a
// live command of the project history (one entry each); with several tiles selected it copies
// the list to each. While the dialog is open the app's keymap is off (it handles its own keys),
// so the editor binds Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z to the app's Undo and Redo, and the keys
// of SPEC §6.4: Enter or a click on the first point closes a polygon, Backspace removes its last
// point, Escape cancels it (or the drag); Delete removes the selected point, else the shape.

const ZOOMS = [1, 2, 4, 8, 16, 32] as const;
type Zoom = (typeof ZOOMS)[number];
/** The stage's longer side the default zoom fits, in CSS pixels. */
const STAGE_FIT = 448;

/** The handles of `se-design` §5.2: white with a black border, in both themes. */
const HANDLE_FILL = "#ffffff";
const HANDLE_BORDER = "#000000";

const TOOLS: readonly { id: CollisionTool; label: string; icon: LucideIcon }[] = [
    { id: "select", label: "Select", icon: MousePointer2 },
    { id: "points", label: "Edit Points", icon: Spline },
    { id: "rectangle", label: "Rectangle", icon: Square },
    { id: "ellipse", label: "Ellipse", icon: Circle },
    { id: "polygon", label: "Polygon", icon: Pentagon },
];

const KIND_NAMES: Record<Shape["shape"], string> = {
    rectangle: "Rectangle",
    ellipse: "Ellipse",
    polygon: "Polygon",
    polyline: "Polyline",
    point: "Point",
};

/** The room round the tile on the stage, in tile pixels: shapes may extend outside it. */
function marginOf(tileset: Tileset): number {
    return Math.ceil(Math.max(tileset.tileWidth, tileset.tileHeight) / 2);
}

function defaultZoom(tileset: Tileset): Zoom {
    const side = Math.max(tileset.tileWidth, tileset.tileHeight) + 2 * marginOf(tileset);
    return [...ZOOMS].reverse().find((zoom) => side * zoom <= STAGE_FIT) ?? 1;
}

/** The shape a rectangle or ellipse tool makes for a drag spanning `box`. */
function boxShape(kind: "rectangle" | "ellipse", box: ShapeBox): Shape {
    return { shape: kind, x: box.x, y: box.y, width: box.width, height: box.height };
}

type Drag =
    | { kind: "create"; pointerId: number; start: ShapePoint; tool: "rectangle" | "ellipse" }
    | { kind: "move"; pointerId: number; start: ShapePoint; index: number; shape: Shape }
    | { kind: "resize"; pointerId: number; index: number; handle: HandleId; shape: Shape }
    | { kind: "vertex"; pointerId: number; index: number; vertex: number; shape: Shape };

const DRAG_EDITS: Record<Drag["kind"], CollisionEdit> = {
    create: "add",
    move: "move",
    resize: "resize",
    vertex: "points",
};

const isTextTarget = (target: EventTarget) =>
    target instanceof HTMLElement &&
    (target.isContentEditable ||
        target.tagName === "TEXTAREA" ||
        (target.tagName === "INPUT" &&
            !["button", "checkbox"].includes((target as HTMLInputElement).type)));

export function CollisionEditor({ request }: { request: CollisionEditorRequest }) {
    useSession((state) => state.revision);
    const edited = editedTile(request);
    // The tileset or the tile went away (an undo of its import): the editor closes.
    useEffect(() => {
        if (!edited) request.answer(null);
    }, [edited, request]);
    if (!edited) return null;
    return (
        <CollisionEditorBody
            request={request}
            tileset={edited.tileset}
            shapes={edited.tile.collision}
        />
    );
}

function CollisionEditorBody({
    request,
    tileset,
    shapes,
}: {
    request: CollisionEditorRequest;
    tileset: Tileset;
    shapes: readonly Shape[];
}) {
    const { tileWidth: tw, tileHeight: th } = tileset;
    const margin = marginOf(tileset);
    const [tool, setTool] = useState<CollisionTool>("select");
    const [snap, setSnap] = useState(true);
    const [zoom, setZoom] = useState<Zoom>(() => defaultZoom(tileset));
    const [chosen, setChosen] = useState<number | null>(null);
    const [vertex, setVertex] = useState<number | null>(null);
    const [draft, setDraftState] = useState<Shape[] | null>(null);
    // The newest draft, also for a release handled before the page renders the last move.
    const latest = useRef<Shape[] | null>(null);
    const setDraft = (next: Shape[] | null) => {
        latest.current = next;
        setDraftState(next);
    };
    const [polygon, setPolygon] = useState<ShapePoint[] | null>(null);
    const [hover, setHover] = useState<ShapePoint | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const drag = useRef<Drag | null>(null);
    const stage = useRef<HTMLDivElement>(null);
    // The stage has the focus when the dialog opens, after the dialog's own first focus.
    useEffect(() => {
        const frame = requestAnimationFrame(() => stage.current?.focus({ preventScroll: true }));
        return () => cancelAnimationFrame(frame);
    }, []);

    const tileIndex = tileset.tiles.findIndex((tile) => tile.id === request.shownTileId);
    const { pixels: sheet, columns } = tileset;
    const pixels = useMemo(
        () => tilePixels(sheet, columns, tw, th, tileIndex),
        [sheet, columns, tw, th, tileIndex],
    );
    const shown = draft ?? shapes;
    const selected = chosen !== null && chosen < shown.length ? chosen : null;
    const selectedShape = selected === null ? null : shown[selected]!;
    const reach = HANDLE_REACH / zoom;

    /** Applies `next` as one entry; a refusal shows its reason. */
    const apply = (next: readonly Shape[], edit: CollisionEdit): boolean => {
        try {
            const changed = applyCollision(request, next, edit);
            if (changed) setMessage(null);
            return changed;
        } catch (error) {
            setMessage(error instanceof Error ? error.message : String(error));
            return false;
        }
    };

    const refuse = (text: string) => setMessage(text);

    /** The tile position under a pointer event, unsnapped. */
    const rawPoint = (event: { clientX: number; clientY: number }): ShapePoint => {
        const box = stage.current!.getBoundingClientRect();
        return [
            (event.clientX - box.left) / zoom - margin,
            (event.clientY - box.top) / zoom - margin,
        ];
    };
    const snapped = (event: { clientX: number; clientY: number; ctrlKey: boolean }): ShapePoint => {
        const [x, y] = rawPoint(event);
        return toolPoint(x, y, snap !== event.ctrlKey);
    };

    const cancelGesture = (): boolean => {
        const active = drag.current;
        if (active) {
            drag.current = null;
            if (stage.current?.hasPointerCapture(active.pointerId)) {
                stage.current.releasePointerCapture(active.pointerId);
            }
            setDraft(null);
            return true;
        }
        if (polygon) {
            setPolygon(null);
            setHover(null);
            return true;
        }
        return false;
    };

    const closePolygon = (points: readonly ShapePoint[]) => {
        setPolygon(null);
        setHover(null);
        if (points.length < MIN_POLYGON_POINTS) return;
        if (shapes.length >= MAX_COLLISION_SHAPES) {
            refuse(`A tile has at most ${MAX_COLLISION_SHAPES} collision shapes.`);
            return;
        }
        if (apply([...shapes, polygonShape(points)], "add")) setChosen(shapes.length);
    };

    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || drag.current) return;
        stage.current?.focus({ preventScroll: true });
        const raw = rawPoint(event);
        const point = snapped(event);
        const begin = (next: Drag) => {
            drag.current = next;
            event.currentTarget.setPointerCapture(event.pointerId);
        };
        switch (tool) {
            case "polygon": {
                const points = polygon ?? [];
                const first = points[0];
                if (
                    first &&
                    points.length >= MIN_POLYGON_POINTS &&
                    Math.max(Math.abs(raw[0] - first[0]), Math.abs(raw[1] - first[1])) <= reach
                ) {
                    closePolygon(points);
                    return;
                }
                if (points.length >= MAX_SHAPE_POINTS) {
                    refuse(`A polygon has at most ${MAX_SHAPE_POINTS} points.`);
                    return;
                }
                if (points.length === 0 && shapes.length >= MAX_COLLISION_SHAPES) {
                    refuse(`A tile has at most ${MAX_COLLISION_SHAPES} collision shapes.`);
                    return;
                }
                setPolygon([...points, point]);
                setHover(point);
                return;
            }
            case "rectangle":
            case "ellipse": {
                if (shapes.length >= MAX_COLLISION_SHAPES) {
                    refuse(`A tile has at most ${MAX_COLLISION_SHAPES} collision shapes.`);
                    return;
                }
                begin({ kind: "create", pointerId: event.pointerId, start: point, tool });
                setDraft([...shapes, boxShape(tool, dragBox(point, point))]);
                setChosen(shapes.length);
                return;
            }
            case "select": {
                if (selectedShape) {
                    const hit = hitBox(shapeBox(selectedShape), { x: raw[0], y: raw[1] }, zoom, 1);
                    if (hit.kind === "handle") {
                        begin({
                            kind: "resize",
                            pointerId: event.pointerId,
                            index: selected!,
                            handle: hit.handle,
                            shape: selectedShape,
                        });
                        return;
                    }
                }
                const index = hitShape(shapes, raw, reach);
                setChosen(index < 0 ? null : index);
                setVertex(null);
                if (index >= 0) {
                    begin({
                        kind: "move",
                        pointerId: event.pointerId,
                        start: point,
                        index,
                        shape: shapes[index]!,
                    });
                }
                return;
            }
            case "points": {
                if (selectedShape?.shape === "polygon") {
                    const at = hitVertex(selectedShape, raw, reach);
                    if (at >= 0) {
                        setVertex(at);
                        begin({
                            kind: "vertex",
                            pointerId: event.pointerId,
                            index: selected!,
                            vertex: at,
                            shape: selectedShape,
                        });
                        return;
                    }
                    if (hitEdge(selectedShape, raw, reach)) return;
                }
                const index = hitShape(shapes, raw, reach);
                setChosen(index < 0 ? null : index);
                setVertex(null);
                return;
            }
        }
    };

    const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
        const active = drag.current;
        if (!active) {
            if (polygon) setHover(snapped(event));
            return;
        }
        if (active.pointerId !== event.pointerId) return;
        const point = snapped(event);
        const next = [...shapes];
        switch (active.kind) {
            case "create":
                next.push(boxShape(active.tool, dragBox(active.start, point)));
                break;
            case "move":
                next[active.index] = moveShape(
                    active.shape,
                    point[0] - active.start[0],
                    point[1] - active.start[1],
                );
                break;
            case "resize": {
                const box = scaleBox(
                    shapeBox(active.shape),
                    active.handle,
                    { x: point[0], y: point[1] },
                    event.shiftKey,
                );
                next[active.index] = fitShape(active.shape, box);
                break;
            }
            case "vertex":
                if (active.shape.shape === "polygon") {
                    next[active.index] = movePolygonPoint(active.shape, active.vertex, point);
                }
                break;
        }
        setDraft(next);
    };

    const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
        const active = drag.current;
        if (!active || active.pointerId !== event.pointerId) return;
        drag.current = null;
        const next = latest.current;
        setDraft(null);
        if (!next) return;
        if (active.kind === "create") {
            // A shape with no area blocks nothing: a click, or a drag along one axis, makes
            // none (SPEC §6.4; unlike Tiled's `CreateObjectTool`, reference/tiled.md §6).
            const { width, height } = shapeBox(next[next.length - 1]!);
            if (width === 0 || height === 0) {
                setChosen(null);
                return;
            }
        }
        apply(next, DRAG_EDITS[active.kind]);
    };

    const onDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
        if (tool !== "points" || selectedShape?.shape !== "polygon") return;
        const raw = rawPoint(event);
        if (hitVertex(selectedShape, raw, reach) >= 0) return;
        const edge = hitEdge(selectedShape, raw, reach);
        if (!edge) return;
        if (selectedShape.points.length >= MAX_SHAPE_POINTS) {
            refuse(`A polygon has at most ${MAX_SHAPE_POINTS} points.`);
            return;
        }
        const at = toolPoint(edge.at[0], edge.at[1], snap !== event.ctrlKey);
        const next = [...shapes];
        next[selected!] = insertPolygonPoint(selectedShape, edge.after, at);
        if (apply(next, "points")) setVertex(edge.after + 1);
    };

    const deleteSelection = () => {
        if (selected === null || !selectedShape) return;
        if (tool === "points" && vertex !== null && selectedShape.shape === "polygon") {
            if (selectedShape.points.length <= MIN_POLYGON_POINTS) {
                refuse(`A polygon keeps at least ${MIN_POLYGON_POINTS} points.`);
                return;
            }
            const next = [...shapes];
            next[selected] = removePolygonPoint(selectedShape, vertex);
            if (apply(next, "points")) setVertex(null);
            return;
        }
        if (
            apply(
                shapes.filter((_, index) => index !== selected),
                "delete",
            )
        ) {
            setChosen(null);
            setVertex(null);
        }
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (isTextTarget(event.target)) return;
        const key = event.key;
        const ctrl = event.ctrlKey || event.metaKey;
        if (ctrl && !event.altKey && (key === "z" || key === "Z" || key === "y" || key === "Y")) {
            event.preventDefault();
            if (drag.current || polygon) return;
            const redo = key.toLowerCase() === "y" || event.shiftKey;
            if (runCommand(redo ? "edit.redo" : "edit.undo")) setMessage(null);
            return;
        }
        if (ctrl || event.altKey) return;
        const onButton = event.target instanceof HTMLButtonElement;
        if (key === "Enter" && polygon && !onButton) {
            event.preventDefault();
            closePolygon(polygon);
        } else if (key === "Backspace" && polygon) {
            event.preventDefault();
            const rest = polygon.slice(0, -1);
            setPolygon(rest.length > 0 ? rest : null);
        } else if (key === "Delete" && !polygon && !drag.current) {
            event.preventDefault();
            deleteSelection();
        }
    };

    const editFields = (box: ShapeBox) => {
        if (selected === null || !selectedShape) return;
        const current = shapeBox(selectedShape);
        const moved = box.width === current.width && box.height === current.height;
        const next = [...shapes];
        next[selected] = moved
            ? moveShape(selectedShape, box.x - current.x, box.y - current.y)
            : fitShape(selectedShape, box);
        apply(next, "change");
    };

    const stageWidth = (tw + 2 * margin) * zoom;
    const stageHeight = (th + 2 * margin) * zoom;
    const box = selectedShape ? shapeBox(selectedShape) : null;
    const several = request.tileIds.length;

    return (
        <Dialog
            open
            size="large"
            title="Collision Editor"
            onOpenChange={(open) => {
                // Escape cancels a polygon or a drag first (SPEC §6.4); then it closes.
                if (!open && !cancelGesture()) request.answer(null);
            }}
            actions={
                <Button
                    variant="primary"
                    onClick={() => request.answer(null)}
                    data-collision-close=""
                >
                    Close
                </Button>
            }
        >
            <div className="collision-editor" onKeyDown={onKeyDown} data-collision-editor="">
                <p className="collision-editor__about" data-collision-tiles={several}>
                    {tileset.name} · tile {request.shownTileId}
                    {several > 1 ? ` · edits apply to ${several} tiles` : ""}
                </p>
                <div className="collision-editor__body">
                    <div
                        className="collision-editor__strip"
                        role="toolbar"
                        aria-orientation="vertical"
                        aria-label="Collision tools"
                    >
                        {TOOLS.map((each) => (
                            <ToolButton
                                key={each.id}
                                label={each.label}
                                active={tool === each.id}
                                data-collision-tool={each.id}
                                onClick={() => {
                                    cancelGesture();
                                    setTool(each.id);
                                    setVertex(null);
                                    // The stage takes the keys of the tool (Enter, Backspace, Delete).
                                    stage.current?.focus({ preventScroll: true });
                                }}
                            >
                                <Icon icon={each.icon} />
                            </ToolButton>
                        ))}
                        <span className="collision-editor__divider" />
                        <Toggle
                            label="Snap to Pixels"
                            pressed={snap}
                            onPressedChange={setSnap}
                            data-collision-snap=""
                        >
                            <Icon icon={Magnet} />
                        </Toggle>
                        <span className="collision-editor__divider" />
                        <IconButton
                            label="Zoom Out"
                            tooltipSide="right"
                            disabled={zoom === ZOOMS[0]}
                            onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)]!)}
                        >
                            <Icon icon={ZoomOut} />
                        </IconButton>
                        <span className="collision-editor__zoom" data-collision-zoom={zoom}>
                            {zoom}×
                        </span>
                        <IconButton
                            label="Zoom In"
                            tooltipSide="right"
                            disabled={zoom === ZOOMS[ZOOMS.length - 1]}
                            onClick={() =>
                                setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)]!)
                            }
                        >
                            <Icon icon={ZoomIn} />
                        </IconButton>
                    </div>
                    <div className="collision-editor__scroller">
                        <div
                            ref={stage}
                            className="collision-editor__stage"
                            style={{ width: stageWidth, height: stageHeight }}
                            tabIndex={0}
                            role="application"
                            aria-label={`Collision shapes of tile ${request.shownTileId}`}
                            data-collision-stage=""
                            data-zoom={zoom}
                            data-margin={margin}
                            onPointerDown={onPointerDown}
                            onPointerMove={onPointerMove}
                            onPointerUp={onPointerUp}
                            onPointerCancel={() => cancelGesture()}
                            onDoubleClick={onDoubleClick}
                        >
                            <PixelCanvas
                                pixels={pixels}
                                className="collision-editor__tile"
                                style={{
                                    left: margin * zoom,
                                    top: margin * zoom,
                                    width: tw * zoom,
                                    height: th * zoom,
                                }}
                            />
                            <svg
                                className="collision-editor__shapes"
                                width={stageWidth}
                                height={stageHeight}
                                viewBox={`${-margin} ${-margin} ${tw + 2 * margin} ${th + 2 * margin}`}
                                aria-hidden="true"
                            >
                                <rect
                                    className="collision-editor__tile-edge"
                                    x={0}
                                    y={0}
                                    width={tw}
                                    height={th}
                                />
                                {shown.map((shape, index) => (
                                    <ShapeOutline
                                        key={index}
                                        shape={shape}
                                        selected={index === selected}
                                    />
                                ))}
                                {polygon ? (
                                    <PolygonDraft points={polygon} hover={hover} zoom={zoom} />
                                ) : null}
                                {selectedShape && tool === "select" ? (
                                    <BoxHandles box={shapeBox(selectedShape)} zoom={zoom} />
                                ) : null}
                                {selectedShape?.shape === "polygon" && tool === "points" ? (
                                    <Vertices shape={selectedShape} zoom={zoom} chosen={vertex} />
                                ) : null}
                            </svg>
                        </div>
                    </div>
                    <div className="collision-editor__side">
                        <ul className="collision-editor__list" aria-label="Shapes">
                            {shown.map((shape, index) => (
                                <li key={index}>
                                    <button
                                        type="button"
                                        className="collision-editor__item"
                                        aria-pressed={index === selected}
                                        data-collision-shape={index}
                                        onClick={() => {
                                            setChosen(index);
                                            setVertex(null);
                                        }}
                                    >
                                        {KIND_NAMES[shape.shape]} {index + 1}
                                        {"points" in shape
                                            ? ` · ${shape.points.length} points`
                                            : ""}
                                    </button>
                                </li>
                            ))}
                            {shown.length === 0 ? (
                                <li className="collision-editor__empty">No shapes</li>
                            ) : null}
                        </ul>
                        {box ? (
                            <div className="collision-editor__fields" data-collision-fields="">
                                <NumberField
                                    label="X"
                                    value={box.x}
                                    min={-MAX_COLLISION_COORD}
                                    max={MAX_COLLISION_COORD}
                                    precision={3}
                                    onChange={(x) => editFields({ ...box, x })}
                                />
                                <NumberField
                                    label="Y"
                                    value={box.y}
                                    min={-MAX_COLLISION_COORD}
                                    max={MAX_COLLISION_COORD}
                                    precision={3}
                                    onChange={(y) => editFields({ ...box, y })}
                                />
                                <NumberField
                                    label="W"
                                    value={box.width}
                                    min={0}
                                    max={2 * MAX_COLLISION_COORD}
                                    precision={3}
                                    onChange={(width) => editFields({ ...box, width })}
                                />
                                <NumberField
                                    label="H"
                                    value={box.height}
                                    min={0}
                                    max={2 * MAX_COLLISION_COORD}
                                    precision={3}
                                    onChange={(height) => editFields({ ...box, height })}
                                />
                                <IconButton
                                    label="Delete Shape"
                                    onClick={deleteSelection}
                                    data-collision-delete=""
                                >
                                    <Icon icon={Trash2} />
                                </IconButton>
                            </div>
                        ) : null}
                        <p
                            className="collision-editor__message"
                            role="status"
                            data-collision-message=""
                        >
                            {message ?? ""}
                        </p>
                    </div>
                </div>
            </div>
        </Dialog>
    );
}

function ShapeOutline({ shape, selected }: { shape: Shape; selected: boolean }) {
    const className = selected
        ? "collision-editor__shape collision-editor__shape--selected"
        : "collision-editor__shape";
    switch (shape.shape) {
        case "rectangle":
            return (
                <rect
                    className={className}
                    x={shape.x}
                    y={shape.y}
                    width={shape.width}
                    height={shape.height}
                />
            );
        case "ellipse":
            return (
                <ellipse
                    className={className}
                    cx={shape.x + shape.width / 2}
                    cy={shape.y + shape.height / 2}
                    rx={shape.width / 2}
                    ry={shape.height / 2}
                />
            );
        case "polygon":
            return (
                <polygon
                    className={className}
                    points={absolutePoints(shape)
                        .map(([x, y]) => `${x},${y}`)
                        .join(" ")}
                />
            );
        default:
            return null;
    }
}

function PolygonDraft({
    points,
    hover,
    zoom,
}: {
    points: readonly ShapePoint[];
    hover: ShapePoint | null;
    zoom: number;
}) {
    const path = hover ? [...points, hover] : points;
    const first = points[0]!;
    const size = HANDLE_SIZE / zoom;
    return (
        <g data-collision-draft={points.length}>
            <polyline
                className="collision-editor__draft"
                points={path.map(([x, y]) => `${x},${y}`).join(" ")}
            />
            <rect
                className="collision-editor__vertex"
                fill={HANDLE_FILL}
                stroke={HANDLE_BORDER}
                x={first[0] - size / 2}
                y={first[1] - size / 2}
                width={size}
                height={size}
            />
        </g>
    );
}

function BoxHandles({ box, zoom }: { box: ShapeBox; zoom: number }) {
    const size = HANDLE_SIZE / zoom;
    return (
        <g>
            {handlePoints(box).map(({ id, point }) => (
                <rect
                    key={id}
                    className="collision-editor__handle"
                    fill={HANDLE_FILL}
                    stroke={HANDLE_BORDER}
                    x={point.x - size / 2}
                    y={point.y - size / 2}
                    width={size}
                    height={size}
                />
            ))}
        </g>
    );
}

function Vertices({
    shape,
    zoom,
    chosen,
}: {
    shape: Extract<Shape, { shape: "polygon" }>;
    zoom: number;
    chosen: number | null;
}) {
    const size = 5 / zoom;
    return (
        <g>
            {absolutePoints(shape).map(([x, y], index) => (
                <rect
                    key={index}
                    fill={HANDLE_FILL}
                    stroke={HANDLE_BORDER}
                    className={
                        index === chosen
                            ? "collision-editor__vertex collision-editor__vertex--chosen"
                            : "collision-editor__vertex"
                    }
                    x={x - size / 2}
                    y={y - size / 2}
                    width={size}
                    height={size}
                />
            ))}
        </g>
    );
}
