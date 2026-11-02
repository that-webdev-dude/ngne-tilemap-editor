# TE-017 goldens: a line-by-line transliteration of Tiled v1.12.2 (src/tiled/geometry.cpp
# pointsOnLine and pointsOnEllipse, src/tiled/stampbrush.cpp drawPreviewLayer,
# src/libtiled/tilelayer.cpp TileLayer::merge) that shares no code with the editor. It prints the
# cell lists of te-017-goldens.ts as JSON:
#
#     python te-017-tiled-golden.py
#
# C semantics: integer division of non-negative values only; `err += dx += k` evaluated as C.
import json

W, H = 40, 30

def points_on_line(x0, y0, x1, y1):
    ret = []
    steep = abs(y1 - y0) > abs(x1 - x0)
    if steep:
        x0, y0 = y0, x0
        x1, y1 = y1, x1
    reverse = x0 > x1
    if reverse:
        x0, x1 = x1, x0
        y0, y1 = y1, y0
    deltax = x1 - x0
    deltay = abs(y1 - y0)
    error = deltax // 2
    y = y0
    ystep = 1 if y0 < y1 else -1
    for x in range(x0, x1 + 1):
        ret.append((y, x) if steep else (x, y))
        error = error - deltay
        if error < 0:
            y = y + ystep
            error = error + deltax
    if reverse:
        ret.reverse()
    return ret

def points_on_ellipse(xm, ym, a, b):
    ret = []
    x = -a
    y = 0
    e2 = b
    dx = (1 + 2 * x) * e2 * e2
    dy = x * x
    err = dx + dy
    while True:
        ret.append((xm - x, ym + y))
        ret.append((xm + x, ym + y))
        ret.append((xm + x, ym - y))
        ret.append((xm - x, ym - y))
        e2 = 2 * err
        if e2 >= dx:
            x += 1
            dx += 2 * b * b
            err += dx
        if e2 <= dy:
            y += 1
            dy += 2 * a * a
            err += dy
        if not (x <= 0):
            break
    while True:
        cond = y < b
        y += 1
        if not cond:
            break
        ret.append((xm, ym + y))
        ret.append((xm, ym - y))
    return ret

def stamp_region(stamp):
    w, h, cells = stamp
    return [(x, y) for y in range(h) for x in range(w) if cells[y * w + x] != 0]

def draw_preview(stamp, points):
    """drawPreviewLayer's non-random branch: accepted operations (top-left positions)."""
    w, h, cells = stamp
    painted = set()
    ops = []
    region = stamp_region(stamp)
    for (px, py) in points:
        cx, cy = px - w // 2, py - h // 2
        translated = {(cx + x, cy + y) for (x, y) in region}
        if painted & translated:
            continue
        painted |= translated
        ops.append((cx, cy))
    return ops

def merge(layer, stamp, pos):
    w, h, cells = stamp
    for y in range(h):
        for x in range(w):
            tx, ty = pos[0] + x, pos[1] + y
            if not (0 <= tx < W and 0 <= ty < H):
                continue
            v = cells[y * w + x]
            if v != 0:
                layer[(tx, ty)] = v

def paint_ops(layer, stamp, ops):
    for op in ops:
        merge(layer, stamp, op)

def single(stamp, p):
    w, h, _ = stamp
    return [(p[0] - w // 2, p[1] - h // 2)]

S1 = (1, 1, [1])
S2 = (2, 2, [1, 2, 3, 4])
S3 = (3, 2, [1, 0, 2, 0, 3, 0])

def case_line(stamp, start, rest):
    layer = {}
    paint_ops(layer, stamp, single(stamp, start))  # the free click: the last painted point
    ref = start
    for p in rest:
        paint_ops(layer, stamp, draw_preview(stamp, points_on_line(ref[0], ref[1], p[0], p[1])))
        ref = p
    return layer

def case_ellipse(stamp, centre, through):
    layer = {}
    paint_ops(layer, stamp, single(stamp, centre))
    pts = points_on_ellipse(centre[0], centre[1], abs(centre[0] - through[0]), abs(centre[1] - through[1]))
    paint_ops(layer, stamp, draw_preview(stamp, pts))
    return layer

def listing(layer):
    return [f"{x},{y}:{v - 1}" for (x, y), v in sorted(layer.items(), key=lambda kv: (kv[0][1], kv[0][0]))]

cases = {
    "line-1x1": case_line(S1, (3, 4), [(17, 9), (10, 20)]),
    "ellipse-1x1": case_ellipse(S1, (20, 14), (27, 18)),
    "ellipse-flat": case_ellipse(S1, (5, 15), (6, 22)),
    "line-2x2": case_line(S2, (4, 4), [(12, 7)]),
    "ellipse-3x2": case_ellipse(S3, (20, 15), (28, 20)),
}
print(json.dumps({k: listing(v) for k, v in cases.items()}))
