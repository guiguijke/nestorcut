"""Conversion of polygons with holes into simple (hole-free) polygons.

jagua-rs has no native holed-item support: `SPolygon` is a single ring and the
collision engine only knows solid shapes. The upstream-endorsed workaround
(jagua-rs issue #5) is to open every hole to the exterior with a degenerate
hairline channel, turning the part into one simply-connected polygon:

  * the channel is CHANNEL_WIDTH mm wide by default — far below any real part
    dimension, so no other part can ever pass through it, and its area cost is
    negligible;
  * the part remains a single piece (exactly what cutting requires);
  * the hole region becomes ordinary free space, so the MAIN solve can nest
    small parts inside cutouts instead of wasting them;
  * the channel only exists in the collision geometry — result DXFs are
    rebuilt from the original DXF entities, untouched by this conversion.

IMPORTANT (min_item_separation interaction): jagua-rs enforces the requested
gap by INFLATING every item by space/2. An inflation larger than half the
channel width seals the channel shut, making holes unreachable again. When a
separation `space` is requested, the channel must therefore be widened to
space + margin (see `channel_width_for_space`). Trade-off: a part edge can
then approach the material along the channel path within ~space/2 — a sliver
of a few mm², only along the channel, vs. holes completely unusable.

Which holes get a channel: a hole is opened only if its channel is
harmless, otherwise it stays closed (the engine then sees solid material
there, which is always safe, only the room inside that hole is not used).
The channel itself is unchanged: a rectangle along the shortest path from
the hole to the exterior, extended by twice its width at both ends. The
holes are examined in plain input order, each one against the holes already
opened, and kept closed when:

  * `small`: the hole is no wider than twice the channel width (a channel
    that wide would leave nothing of the hole, and no part fits in it), or it
    is degenerate: fewer than 3 distinct vertices, or an absolute area of at
    most DEGENERATE_HOLE_MM2 (a line, a point). A degenerate ring is never
    given to a polygon constructor, and a closed and an unclosed copy of the
    same ring give the same decision;
  * `flush`: the hole touches the exterior (channel shorter than 0.01 mm);
  * `conflict`: its channel or the hole itself comes within 0.01 mm of the
    channel or the hole of one already opened, and two channels come within
    max(0.01 mm, 0.55 times the channel width) of each other. Two channels
    crossing each other's hole or running side by side would cut a piece off
    the part, and the engine would ignore that piece and could put parts on
    it. The wider distance between two channels keeps `deep` valid for the
    whole part: the check below looks at one hole alone, and with the
    channels more than 0.55 w apart the nearest material that remains is
    never inside another channel;
  * `deep`: opening it alone would erase material farther than 0.55 times
    the channel width from what remains (a thin wall next to a hole corner,
    a tongue, a thin stroke of a letter), so a part could be accepted
    inside real material. The check samples a grid across the channel and
    also the ring edges that cross it, so a wall thinner than the grid step
    is seen too.

As a last safety net the result must be ONE simple ring: if the opening
splits the part and the dropped pieces exceed SLIVER_MAX_MM2, or the ring is
not simple, the exterior ring is returned and every hole stays closed.
Validation, drawing and export always use the true geometry (exterior minus
holes), never this ring.

Requires the `narrow_concavity_cutoff` fix from jagua-rs 0.7.0 (#73/#74) and
concavity closing disabled for holed instances (see build_engine_config),
otherwise the channel would be sealed shut again.
"""

import math

import numpy as np
import shapely
from shapely import set_precision, unary_union
from shapely.geometry import LineString, Polygon, box
from shapely.ops import nearest_points

from worker_common.logger import setup_logger

logger = setup_logger("holed_polygons")

# Width of the channel connecting a hole to the part's exterior. Must stay
# above the solver's poly_simpl_tolerance (0.001) to survive simplification,
# and far below any real feature size so it never admits another part.
CHANNEL_WIDTH = 0.01

# Extra clearance added to the channel width when a separation is requested:
# jagua inflates items by space/2 on EACH side, so a channel of exactly
# `space` would still be sealed; the margin keeps it open.
CHANNEL_SEPARATION_MARGIN = 0.1

# Hard cap on the channel width. The channel is SUBTRACTED from the
# collision polygon: parts may legitimately be placed over it, intruding
# into real material by up to half its width. Wide channels also mutilate
# ornate parts (severed arms) and can create degenerate self-intersecting
# rings that jagua's importer rejects. When the requested spacing exceeds
# (cap - margin), the channel simply gets sealed by the separation
# inflation — holes go unused, which is a safe degradation, never a
# correctness risk.
CHANNEL_MAX_WIDTH = 2.5

# Rules deciding which holes get a channel (see module docstring). Same names
# and values as the Rust twin (nest-preprocess).
# H0: a hole whose smaller bounding-box side is <= SMALL_HOLE_FACTOR * width
# stays closed.
SMALL_HOLE_FACTOR = 2.0
# H0: a hole closer than this to the exterior (channel length) stays closed.
FLUSH_MIN = 0.01
# H1: distance (mm) at or under which two channels / holes are in conflict.
# Channel against channel uses max(CONFLICT_TOL, DEPTH_FACTOR * width).
CONFLICT_TOL = 0.01
# H2: a channel may erase material only within DEPTH_FACTOR * width of what
# remains; the check samples the channel on a grid of width / DEPTH_GRID, and
# the ring edges inside the channel at the same step. The grid has at most
# DEPTH_MAX_STEPS steps along the channel axis.
DEPTH_FACTOR = 0.55
DEPTH_GRID = 8
DEPTH_MAX_STEPS = 4096
# H3: area (mm2) of pieces that may be dropped when a result is split.
SLIVER_MAX_MM2 = 0.05
# H0: a hole ring with fewer than 3 distinct vertices, or an absolute area at
# or under this (mm2), is degenerate: closed as "small", never built into a
# polygon.
DEGENERATE_HOLE_MM2 = 1e-9


def channel_width_for_space(space):
    """Channel width surviving jagua's min_item_separation inflation.

    Items are inflated by space/2 on both sides of the slit, so the channel
    closes by `space` in total: it must be strictly wider than `space` to
    stay usable — but never wider than CHANNEL_MAX_WIDTH (see above).
    """
    space = float(space or 0)
    return min(max(CHANNEL_WIDTH, space + CHANNEL_SEPARATION_MARGIN), CHANNEL_MAX_WIDTH)


def channels_usable(space):
    """Whether hole channels survive the separation inflation at all.

    Above ~2.4 mm of spacing the width cap kicks in and the inflation seals
    the channel shut — and the crushed ring breaks the jagua import
    (duplicate vertices / empty offset). Callers MUST leave holes closed in
    that case (the safe degradation: holes go unused, never a broken job).
    """
    return channel_width_for_space(space) > float(space or 0)


def _channel_rect(p_in, p_out, width):
    """The channel of one hole: a flat-capped rectangle `width` wide along the
    segment p_in -> p_out, extended by 2 * width beyond both ends.

    Returns (rectangle, length, (ux, uy)); the rectangle is None when the
    two points coincide."""
    dx, dy = p_out.x - p_in.x, p_out.y - p_in.y
    length = math.hypot(dx, dy)
    if length < 1e-9:
        return None, length, (0.0, 0.0)
    ux, uy = dx / length, dy / length
    # Extend the cut beyond both ends so it genuinely connects the hole
    # to the outside (boundary touches alone do not open the ring).
    ext = width * 2.0
    seg = LineString([
        (p_in.x - ux * ext, p_in.y - uy * ext),
        (p_out.x + ux * ext, p_out.y + uy * ext),
    ])
    return seg.buffer(width / 2.0, cap_style="flat"), length, (ux, uy)


def _clip_ring_to_frame(ring, sx, sy, ux, uy, span, half, step):
    """Samples of the ring edges clipped to the closed rectangle of the
    channel (`0 <= along <= span`, `|across| <= half`, in the channel frame).
    Each clipped piece of length l gets max(1, ceil(l / step)) + 1 evenly
    spaced samples. Returns world coordinates (xs, ys)."""
    pts = np.asarray(ring, dtype=float)[:, :2]
    if len(pts) > 1 and np.array_equal(pts[0], pts[-1]):
        pts = pts[:-1]
    if len(pts) == 0:
        return np.empty(0), np.empty(0)
    nxt = np.roll(pts, -1, axis=0)
    nx_, ny_ = -uy, ux

    def frame(p):
        dx, dy = p[:, 0] - sx, p[:, 1] - sy
        return dx * ux + dy * uy, dx * nx_ + dy * ny_

    a0, v0 = frame(pts)
    a1, v1 = frame(nxt)
    da, dv = a1 - a0, v1 - v0
    t0 = np.zeros(len(pts))
    t1 = np.ones(len(pts))
    ok = np.ones(len(pts), dtype=bool)
    for p, q in ((-da, a0), (da, span - a0), (-dv, v0 + half), (dv, half - v0)):
        par = p == 0
        ok &= ~(par & (q < 0))
        with np.errstate(divide="ignore", invalid="ignore"):
            r = np.where(par, 0.0, q / np.where(par, 1.0, p))
        t0 = np.where(~par & (p < 0), np.maximum(t0, r), t0)
        t1 = np.where(~par & (p > 0), np.minimum(t1, r), t1)
    ok &= t0 <= t1
    if not ok.any():
        return np.empty(0), np.empty(0)
    a0, v0, da, dv, t0, t1 = a0[ok], v0[ok], da[ok], dv[ok], t0[ok], t1[ok]
    ca, cv = a0 + da * t0, v0 + dv * t0
    ea, ev = a0 + da * t1, v0 + dv * t1
    length = np.hypot(ea - ca, ev - cv)
    cnt = np.maximum(1, np.ceil(length / step).astype(np.int64))
    seg = np.repeat(np.arange(len(cnt)), cnt + 1)
    start = np.cumsum(cnt + 1) - (cnt + 1)
    k = np.arange(len(seg)) - start[seg]
    f = k / cnt[seg]
    qa = ca[seg] + (ea - ca)[seg] * f
    qv = cv[seg] + (ev - cv)[seg] * f
    return sx + qa * ux + qv * nx_, sy + qa * uy + qv * ny_


def _any_farther_than(shape, xs, ys, limit):
    """True when some point (xs[k], ys[k]) lies outside `shape` (polygons) and
    farther than `limit` from its boundary. Exact point-to-segment distances,
    in blocks so the work array stays small; the first block that has a far
    point ends the search (the boundary samples come first)."""
    segs = []
    for ring in shapely.get_rings(shapely.get_parts(shape)):
        c = shapely.get_coordinates(ring)
        if len(c) >= 2:
            segs.append(np.hstack([c[:-1], c[1:]]))
    if not segs:
        return True
    seg = np.vstack(segs)
    ax, ay = seg[:, 0][None, :], seg[:, 1][None, :]
    dx, dy = (seg[:, 2] - seg[:, 0])[None, :], (seg[:, 3] - seg[:, 1])[None, :]
    len2 = dx * dx + dy * dy
    inv = np.where(len2 > 0, 1.0 / np.where(len2 > 0, len2, 1.0), 0.0)
    block = max(1, 1_000_000 // len(seg))
    for i in range(0, len(xs), block):
        px, py = xs[i:i + block, None], ys[i:i + block, None]
        t = np.clip(((px - ax) * dx + (py - ay) * dy) * inv, 0.0, 1.0)
        d2 = np.min((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2, axis=1)
        if np.any(np.sqrt(d2) > limit):
            return True
    return False


def _channel_too_deep(outer_ring, hole_ring, rect, p_in, length, u, width):
    """H2: True when opening this hole ALONE erases material that ends up
    farther than DEPTH_FACTOR * width from what remains.

    The material is the exterior minus this hole only (the other holes count
    as solid). Samples, all in the channel's own frame: a grid (DEPTH_GRID + 1
    points across, a step of width / DEPTH_GRID along the axis, at most
    DEPTH_MAX_STEPS steps) of which only the points strictly inside the
    material count, plus the ring edges (exterior and this hole) clipped to
    the channel rectangle, sampled at the same step, which always count (a
    wall thinner than the grid step falls between grid points). Every
    counted sample must be within DEPTH_FACTOR * width of the remainder. Any
    failure to compute this counts as too deep (closed)."""
    try:
        material = Polygon(outer_ring, [hole_ring])
        ux, uy = u
        nx, ny = -uy, ux
        step = width / DEPTH_GRID
        span = length + 4.0 * width
        n_along = min(max(1, int(math.ceil(span / step))), DEPTH_MAX_STEPS)
        a = np.arange(n_along + 1, dtype=float) * (span / n_along)
        v = -width / 2.0 + np.arange(DEPTH_GRID + 1, dtype=float) * step
        sx = p_in.x - 2.0 * width * ux
        sy = p_in.y - 2.0 * width * uy
        # Only the neighbourhood of the channel matters: every sample is inside
        # the rectangle and the distance that decides is at most 0.55 * width,
        # so the material and the remainder are cut to the rectangle grown by
        # one width (same decisions, much less geometry to measure against).
        window = rect.buffer(width, join_style="mitre")
        near = material.intersection(window)
        remainder = near.difference(rect)
        xs = (sx + a[:, None] * ux + v[None, :] * nx).ravel()
        ys = (sy + a[:, None] * uy + v[None, :] * ny).ravel()
        counted = shapely.contains_xy(near, xs, ys)
        bxs, bys = [xs[counted]], [ys[counted]]
        for ring in (outer_ring, hole_ring):
            cx, cy = _clip_ring_to_frame(ring, sx, sy, ux, uy, span, width / 2.0, step)
            bxs.append(cx)
            bys.append(cy)
        xs, ys = np.concatenate(bxs), np.concatenate(bys)
        if remainder.is_empty:
            # Nothing within reach of any sample. Closed if there is a sample,
            # or if the whole remainder is empty.
            return bool(xs.size) or material.difference(rect).is_empty
        if xs.size == 0:
            return False
        # Every sample lies in the closed rectangle, so it is either on the
        # boundary of what remains (distance 0) or outside it: the distance to
        # the remainder is the distance to its boundary.
        return _any_farther_than(remainder, xs, ys, DEPTH_FACTOR * width)
    except Exception:
        return True


def _is_degenerate_ring(ring):
    """R3.1: fewer than 3 distinct vertices, or |signed area| <= DEGENERATE_HOLE_MM2.
    The ring is taken as closed whether or not the first point is repeated."""
    try:
        pts = [(float(p[0]), float(p[1])) for p in ring]
        if len(pts) > 1 and pts[0] == pts[-1]:
            pts = pts[:-1]
        if len(set(pts)) < 3:
            return True
        area = 0.0
        for k in range(len(pts)):
            x0, y0 = pts[k]
            x1, y1 = pts[(k + 1) % len(pts)]
            area += x0 * y1 - x1 * y0
        return abs(area) / 2.0 <= DEGENERATE_HOLE_MM2
    except Exception:
        return True


def _box_gap(a, b):
    """Distance between two bounding boxes (minx, miny, maxx, maxy)."""
    return math.hypot(max(a[0] - b[2], b[0] - a[2], 0.0), max(a[1] - b[3], b[1] - a[3], 0.0))


def _plan(poly, outer_ring, hole_rings, width):
    """Decisions per hole (input order) and the channel rectangle of each hole
    that was examined (None for the others)."""
    n = len(hole_rings)
    decisions = [None] * n
    rects = [None] * n
    hole_polys = [None] * n
    boxes = [None] * n
    candidates = []
    for i, ring in enumerate(hole_rings):
        if _is_degenerate_ring(ring):
            decisions[i] = "small"
            continue
        try:
            hole_poly = Polygon(ring)
            hole_polys[i] = hole_poly
            minx, miny, maxx, maxy = hole_poly.bounds
            if min(maxx - minx, maxy - miny) <= SMALL_HOLE_FACTOR * width:
                decisions[i] = "small"
                continue
            p_in, p_out = nearest_points(hole_poly.exterior, poly.exterior)
            rect, length, u = _channel_rect(p_in, p_out, width)
            if rect is None or length < FLUSH_MIN:
                decisions[i] = "flush"
                continue
        except Exception:
            decisions[i] = "deep"
            continue
        rects[i] = rect
        rb, hb = rect.bounds, hole_poly.bounds
        boxes[i] = (min(rb[0], hb[0]), min(rb[1], hb[1]), max(rb[2], hb[2]), max(rb[3], hb[3]))
        candidates.append((length, i, p_in, u))

    # Plain input order (no sorting): each hole is decided against the holes
    # opened before it.
    # Channel against channel: the larger tolerance. The box prefilter uses the
    # largest tolerance, so it never skips a pair that a distance would catch.
    tol_rr = max(CONFLICT_TOL, DEPTH_FACTOR * width)
    opened = []
    for length, i, p_in, u in candidates:
        rect, hole_poly = rects[i], hole_polys[i]
        try:
            bi = boxes[i]
            conflict = any(
                # The boxes of the two pairs are farther apart than the largest
                # tolerance: so are the shapes inside them (no distance call).
                _box_gap(bi, boxes[j]) <= tol_rr
                and (rect.distance(rects[j]) <= tol_rr
                     or min(rect.distance(hole_polys[j]),
                            hole_poly.distance(rects[j]),
                            hole_poly.distance(hole_polys[j])) <= CONFLICT_TOL)
                for j in opened
            )
        except Exception:
            conflict = True
        if conflict:
            decisions[i] = "conflict"
        elif _channel_too_deep(outer_ring, hole_rings[i], rect, p_in, length, u, width):
            decisions[i] = "deep"
        else:
            decisions[i] = "open"
            opened.append(i)
    return decisions, rects


def plan_channels(outer_ring, hole_rings, channel_width=None):
    """Decision per hole, in input order: "open" (a channel is cut), or the
    reason the hole stays closed: "small", "flush", "conflict" or "deep"
    (see the module docstring)."""
    width = float(channel_width) if channel_width else CHANNEL_WIDTH
    if not hole_rings:
        return []
    poly = Polygon(outer_ring, [r for r in hole_rings if not _is_degenerate_ring(r)])
    if poly.is_empty:
        return ["deep"] * len(hole_rings)
    return _plan(poly, outer_ring, hole_rings, width)[0]


def _is_simple_ring(coords):
    pts = [tuple(p) for p in coords]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) < 3 or len(set(pts)) != len(pts):
        return False
    return bool(LineString(pts + [pts[0]]).is_simple)


def open_holes_with_channels(outer_ring, hole_rings, channel_width=None):
    """Returns the exterior ring of `outer_ring` with the holes whose channel
    is harmless connected to the outside by a narrow channel (a simple
    polygon, as a point list). The other holes stay closed (solid).

    Each channel is a thin rectangle subtracted from the material along the
    SHORTEST path from the hole to the part's exterior (nearest boundary
    points). A straight horizontal cut (the previous implementation) crosses
    ornate contours several times, and the resulting ring self-intersects in
    ways jagua's importer strictly rejects — the shortest path crosses the
    material exactly once, which is both less destructive and robust.

    channel_width: defaults to CHANNEL_WIDTH; pass channel_width_for_space(s)
    when the job enforces a separation s (see module docstring).
    """
    width = float(channel_width) if channel_width else CHANNEL_WIDTH

    if not hole_rings:
        return [list(p) for p in outer_ring]

    poly = Polygon(outer_ring, [r for r in hole_rings if not _is_degenerate_ring(r)])
    if poly.is_empty:
        logger.warning("Holed polygon is empty, falling back to outer ring")
        return [list(p) for p in outer_ring]

    decisions, rects = _plan(poly, outer_ring, hole_rings, width)
    closed = {}
    for d in decisions:
        if d != "open":
            closed[d] = closed.get(d, 0) + 1
    if closed:
        logger.info(
            "Holes left closed: %d of %d (%s)",
            sum(closed.values()), len(decisions),
            ", ".join("%s=%d" % (k, closed[k]) for k in sorted(closed)),
        )

    opened = [i for i, d in enumerate(decisions) if d == "open"]
    if not opened:
        return [list(p) for p in outer_ring]

    material = Polygon(outer_ring, [hole_rings[i] for i in opened])
    channels = unary_union([rects[i] for i in opened])

    # A single difference: sequential cuts through narrow slivers hit
    # GEOS precision limits ("free hole" TopologyException).
    try:
        result = material.difference(channels)
    except Exception:
        # Robustness retry on a snapped grid (grid << channel width).
        result = set_precision(material, 1e-6).difference(set_precision(channels, 1e-6))

    # jagua's importer is stricter than shapely: a channel through ornate
    # geometry can leave a degenerate (self-touching/self-intersecting)
    # ring that shapely still calls valid. Repair those, or the whole job
    # dies at engine import with an opaque geometry error.
    if not result.is_valid:
        from shapely.validation import make_valid
        result = make_valid(result)
        logger.warning("Channel conversion required geometry repair")

    pieces = [
        geom for geom in getattr(result, "geoms", [result])
        if geom.geom_type == "Polygon" and not geom.is_empty
    ]
    if not pieces:
        logger.warning("Channel conversion destroyed the part, using outer ring")
        return [list(p) for p in outer_ring]
    largest = max(pieces, key=lambda geom: geom.area)
    dropped = sum(geom.area for geom in pieces) - largest.area
    if dropped > SLIVER_MAX_MM2:
        # The engine would ignore the dropped pieces and could put parts on
        # that material: keep every hole closed instead.
        logger.warning("Channel conversion split a part (%.3f mm2 dropped), using outer ring", dropped)
        return [list(p) for p in outer_ring]
    if dropped > 0:
        logger.warning("Channel conversion split off %.4f mm2, kept the largest piece", dropped)

    ring = [[x, y] for x, y in largest.exterior.coords]
    if not _is_simple_ring(ring):
        logger.warning("Channel conversion left a non-simple ring, using outer ring")
        return [list(p) for p in outer_ring]
    return ring
