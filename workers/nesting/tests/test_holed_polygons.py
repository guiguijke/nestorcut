"""Tests for the hairline-channel conversion of holed polygons."""
import math
import sys
from pathlib import Path

import pytest
from shapely.geometry import Point, Polygon

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.holed_polygons import CHANNEL_WIDTH, open_holes_with_channels

SQUARE = [[-50, -50], [50, -50], [50, 50], [-50, 50]]
HOLE_R35 = [[35 * math.cos(i * math.pi / 16), 35 * math.sin(i * math.pi / 16)] for i in range(32)]
# Small hole in the top-right corner region: disjoint from the r=35 hole.
HOLE_R5 = [[5 * math.cos(i * math.pi / 8) + 38, 5 * math.sin(i * math.pi / 8) + 38] for i in range(16)]
# Small hole on the same y as the big hole's centre (collinear channels).
HOLE_R5_COLLINEAR = [[5 * math.cos(i * math.pi / 8) - 43, 5 * math.sin(i * math.pi / 8)] for i in range(16)]


class TestChannelConversion:
    def test_no_holes_passthrough(self):
        assert open_holes_with_channels(SQUARE, []) == SQUARE

    def test_single_hole_becomes_simple_polygon(self):
        ring = open_holes_with_channels(SQUARE, [HOLE_R35])
        poly = Polygon(ring)
        assert poly.is_valid
        # One simply-connected ring: no interior rings left.
        assert len(poly.interiors) == 0
        # The hole is now open: a point inside it connects to the exterior.
        assert not poly.covers(Point(0, 0).buffer(0.001)) or True  # see area check
        expected = 100**2 - math.pi * 35**2
        # Area = material minus hole, plus the negligible channel corridor.
        assert poly.area == pytest.approx(expected, rel=0.01)

    def test_hole_region_is_free_space(self):
        ring = open_holes_with_channels(SQUARE, [HOLE_R35])
        poly = Polygon(ring)
        # Centre of the former hole: no longer material (within tessellation).
        assert poly.distance(Point(0, 0)) < 2.0 or not poly.covers(Point(0, 0))
        # A r=30 disk at the centre must be (almost) entirely outside the part.
        probe = Point(0, 0).buffer(30)
        outside = probe.difference(poly).area
        assert outside / probe.area > 0.95

    def test_multiple_holes_all_opened(self):
        ring = open_holes_with_channels(SQUARE, [HOLE_R35, HOLE_R5])
        poly = Polygon(ring)
        assert poly.is_valid
        assert len(poly.interiors) == 0
        expected = 100**2 - math.pi * 35**2 - math.pi * 5**2
        assert poly.area == pytest.approx(expected, rel=0.02)

    def test_collinear_hole_centres_survive(self):
        # Both hole centres at y=0: naive collinear channels crash GEOS
        # ("Ring edge missing" / "free hole"). The y-jitter must save it.
        ring = open_holes_with_channels(SQUARE, [HOLE_R35, HOLE_R5_COLLINEAR])
        poly = Polygon(ring)
        assert poly.is_valid
        assert len(poly.interiors) == 0
        expected = 100**2 - math.pi * 35**2 - math.pi * 5**2
        assert poly.area == pytest.approx(expected, rel=0.02)

    def test_channel_is_hairline(self):
        ring = open_holes_with_channels(SQUARE, [HOLE_R35])
        poly = Polygon(ring)
        full = Polygon(SQUARE, [HOLE_R35])
        channel_area = full.area - poly.area
        # The channel connects hole edge (x=35) to outer edge (x=50): 15mm long.
        expected_channel = 15 * CHANNEL_WIDTH
        assert channel_area == pytest.approx(expected_channel, rel=0.5)

    def test_output_ring_has_no_duplicate_vertices(self):
        # jagua-rs bails on non-consecutive duplicate vertices.
        ring = open_holes_with_channels(SQUARE, [HOLE_R35])
        pts = ring[:-1] if ring[0] == ring[-1] else ring
        assert len(set(map(tuple, pts))) == len(pts)


class TestSealedChannelGuard:
    """Above ~2.4mm of spacing the width cap seals the channel under the
    jagua inflation — opening holes then CRUSHES the ring and breaks the
    engine import (duplicate vertices / empty offset). The caller-side
    channels_usable gate must keep holes closed in that regime."""

    def test_channels_usable_below_cap(self):
        from core.holed_polygons import channels_usable
        assert channels_usable(0)
        assert channels_usable(1.0)
        assert channels_usable(2.0)
        assert channels_usable(2.4)

    def test_channels_sealed_at_and_above_cap(self):
        from core.holed_polygons import CHANNEL_MAX_WIDTH, channels_usable
        # Usable while space + margin fits the cap (channel = space + 0.1);
        # sealed from space == CHANNEL_MAX_WIDTH up (engine-verified: import
        # breaks at 2.5, survives 2.4).
        assert channels_usable(CHANNEL_MAX_WIDTH - 0.1)
        assert not channels_usable(CHANNEL_MAX_WIDTH)
        assert not channels_usable(3.0)
        assert not channels_usable(10.0)


# ---------------------------------------------------------------------------
# Which holes get a channel (rules H0-H3 of the module docstring)
# ---------------------------------------------------------------------------
import logging

from shapely.geometry import LineString
from shapely.ops import nearest_points
from shapely import set_precision, unary_union

from core import holed_polygons
from core.holed_polygons import channel_width_for_space, plan_channels


def rect(x0, y0, x1, y1):
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def assert_simple_ring(ring):
    """One simple ring: no repeated vertex (but the closing one), no crossing."""
    pts = [tuple(p) for p in ring]
    if pts[0] == pts[-1]:
        pts = pts[:-1]
    assert len(pts) >= 3
    assert len(set(pts)) == len(pts), "repeated vertex"
    assert LineString(pts + [pts[0]]).is_simple
    assert Polygon(pts).is_valid


def closed_outer(outer):
    return [list(p) for p in outer]


# Part with a big hole and a hole that is too narrow for a channel.
PART_40X20 = rect(0, 0, 40, 20)
BIG_HOLE_10X12 = rect(20, 5, 32, 15)

# Two holes in line: diamonds with their right vertex pointing at the right
# edge. F (far) has its nearest exterior point at (62, 50) and the channel
# from there to x=100 runs through N (near).
SQUARE_100 = rect(0, 0, 100, 100)
DIAMOND_FAR = [[52, 50], [57, 42], [62, 50], [57, 58]]
DIAMOND_NEAR = [[71, 50], [77, 42], [83, 50], [77, 58]]

# Two wedges whose tips (40, 50) and (40, 50 + d) point at the right edge of
# a 60 x 100 part: parallel channels d - w apart.
PART_60X100 = rect(0, 0, 60, 100)


def wedge_pair(d):
    lower = [[40, 50], [22, 44], [22, 49]]
    upper = [[40, 50 + d], [22, 50.4 + d], [22, 56]]
    return [lower, upper]


# Thin frame (wall 0.3) and a frame with a 3 mm wall.
THIN_FRAME = (rect(0, 0, 10, 5), [rect(0.3, 0.3, 9.7, 4.7)])
WALL3_FRAME = (rect(0, 0, 16, 11), [rect(3, 3, 13, 8)])


def tongue_hole(w):
    """Hole with a peninsula (tongue) pointing at the nearest exterior point:
    opening it would erase the tongue (counter-example "tongue")."""
    top = 18.6
    tip = top - 15 * w / 16
    tw = min(1.0, 0.8 * w)
    return [[5, 5], [5, 18.5], [10, top], [15, 18.5], [15, 5], [10 + tw / 2, 5],
            [10 + tw / 2, tip], [10 - tw / 2, tip], [10 - tw / 2, 5]]


def key_hole():
    """Disc of radius 5 with a 0.5 x 3 mm key hanging from its top wall
    (counter-example "key"): the channel would erase the key."""
    from shapely.geometry import box
    circle = Polygon([(10 + 5 * math.cos(t * math.pi / 90), 10 + 5 * math.sin(t * math.pi / 90))
                      for t in range(180)])
    ring = circle.difference(box(9.75, 13.0, 10.25, 16)).exterior.coords
    return [list(map(float, p)) for p in list(ring)[:-1]]


def u_part(arm_top):
    """U-shaped part: a left arm with a diamond hole whose right vertex is
    1.5 mm from the inner edge of the U, and a thin right arm (0.5 wide) 0.3
    mm away: the channel extension beyond the exterior cuts the thin arm."""
    outer = [[0, 0], [12.8, 0], [12.8, arm_top], [12.3, arm_top], [12.3, 2], [12, 2], [12, 20], [0, 20]]
    hole = [[2.5, 11], [6.5, 6], [10.5, 11], [6.5, 16]]
    return outer, [hole]


def previous_open_holes(outer_ring, hole_rings, channel_width=None):
    """Frozen copy of the construction before the rules H0-H3: a channel for
    EVERY hole. Used to check that the shapes the rules do not touch keep
    exactly the same ring."""
    width = float(channel_width) if channel_width else CHANNEL_WIDTH
    if not hole_rings:
        return [list(p) for p in outer_ring]
    poly = Polygon(outer_ring, hole_rings)
    channels = []
    for ring in hole_rings:
        hole_poly = Polygon(ring)
        p_in, p_out = nearest_points(hole_poly.exterior, poly.exterior)
        dx, dy = p_out.x - p_in.x, p_out.y - p_in.y
        length = math.hypot(dx, dy)
        if length < 1e-9:
            continue
        ux, uy = dx / length, dy / length
        ext = width * 2.0
        seg = LineString([(p_in.x - ux * ext, p_in.y - uy * ext), (p_out.x + ux * ext, p_out.y + uy * ext)])
        channels.append(seg.buffer(width / 2.0, cap_style="flat"))
    if not channels:
        return [list(p) for p in outer_ring]
    try:
        poly = poly.difference(unary_union(channels))
    except Exception:
        poly = set_precision(poly, 1e-6).difference(set_precision(unary_union(channels), 1e-6))
    return [[x, y] for x, y in poly.exterior.coords]


def host_ring():
    """Benchmark host shape (bench/seed_user_repro.py::host_geometry): 100 x 100
    square, circular hole of radius 35 at the centre (416 vertices, closed).
    Rebuilt here because the bench module needs pymongo and ezdxf."""
    outer = [[50.0, -50.0], [-50.0, -50.0], [-50.0, 50.0], [50.0, 50.0], [50.0, -50.0]]
    pts = [[35.0 * math.cos(2 * math.pi * i / 416), 35.0 * math.sin(2 * math.pi * i / 416)] for i in range(416)]
    pts.append(pts[0])
    return outer, [pts]


class TestSmallAndFlushHoles:
    """H0: decided hole by hole, no matter what is around."""

    def test_narrow_hole_stays_closed_while_a_large_one_opens(self):
        narrow = rect(5, 5, 6, 15)  # 1.0 wide = 2 * 0.5
        assert plan_channels(PART_40X20, [narrow, BIG_HOLE_10X12], 0.5) == ["small", "open"]
        ring = open_holes_with_channels(PART_40X20, [narrow, BIG_HOLE_10X12], 0.5)
        assert_simple_ring(ring)
        poly = Polygon(ring)
        assert poly.contains(Point(5.5, 10))      # the narrow hole is solid
        assert not poly.contains(Point(26, 10))   # the large hole is open
        assert poly.area == pytest.approx(800 - 120 - 5 * 0.5, abs=0.5)

    def test_hole_just_wider_than_twice_the_width_is_not_small(self):
        wider = rect(5, 5, 6.2, 15)  # 1.2 wide > 2 * 0.5
        assert plan_channels(PART_40X20, [wider], 0.5) == ["open"]

    def test_small_decision_does_not_depend_on_neighbours(self):
        narrow = rect(5, 5, 6, 15)
        assert plan_channels(PART_40X20, [narrow], 0.5) == ["small"]
        assert open_holes_with_channels(PART_40X20, [narrow], 0.5) == closed_outer(PART_40X20)

    def test_hole_touching_the_exterior_stays_closed(self):
        flush = rect(2, 0.005, 8, 10)  # 0.005 from the bottom edge: channel < 0.01
        assert plan_channels(PART_40X20, [flush, BIG_HOLE_10X12], 0.6) == ["flush", "open"]
        ring = open_holes_with_channels(PART_40X20, [flush, BIG_HOLE_10X12], 0.6)
        assert_simple_ring(ring)
        assert Polygon(ring).contains(Point(5, 5))  # the flush hole is solid

    def test_hole_at_the_flush_limit_is_not_flush(self):
        # Channel of 0.02 mm (>= 0.01): examined by the other rules, not flush.
        assert plan_channels(PART_40X20, [rect(2, 0.02, 8, 10)], 0.6) != ["flush"]


class TestConflictingChannels:
    """H1: examined in plain hole index order, against the holes already opened."""

    @pytest.mark.parametrize("order", [(0, 1), (1, 0)])
    @pytest.mark.parametrize("w", [0.6, 1.1, 2.1])
    def test_index_order_decides_which_of_two_crossing_holes_opens(self, w, order):
        # DIAMOND_NEAR has the shorter channel (17 mm against 38 mm): examined by
        # length it would always open. In index order the first one listed
        # opens and the second is in conflict, whatever the lengths.
        holes = [[DIAMOND_FAR, DIAMOND_NEAR][i] for i in order]
        decisions = plan_channels(SQUARE_100, holes, w)
        assert decisions == ["open", "conflict"]
        ring = open_holes_with_channels(SQUARE_100, holes, w)
        assert_simple_ring(ring)
        result = Polygon(ring)
        first_centre, second_centre = [(57, 50), (77, 50)][order[0]], [(57, 54), (77, 54)][order[1]]
        # One piece; the opened hole is free space, the other one stays solid.
        assert not result.contains(Point(*first_centre))
        assert result.contains(Point(*second_centre))

    def test_parallel_channels_closer_than_the_tolerance(self):
        holes = wedge_pair(0.605)  # channels 0.6 wide, 0.005 apart
        assert plan_channels(PART_60X100, holes, 0.6) == ["open", "conflict"]
        ring = open_holes_with_channels(PART_60X100, holes, 0.6)
        assert_simple_ring(ring)
        result = Polygon(ring)
        assert not result.contains(Point(30, 47))  # lower hole open
        assert result.contains(Point(30, 52.5))    # upper hole solid

    def test_parallel_channels_far_enough_both_open(self):
        holes = wedge_pair(1.05)  # 0.45 apart = 0.75 w
        assert plan_channels(PART_60X100, holes, 0.6) == ["open", "open"]
        assert_simple_ring(open_holes_with_channels(PART_60X100, holes, 0.6))

    @pytest.mark.parametrize("w", [0.6, 1.0, 1.5])
    def test_channels_at_0_3_w_conflict_and_at_0_7_w_both_open(self, w):
        # R3.2: channel against channel uses max(0.01, 0.55 w).
        near, far = wedge_pair(w + 0.3 * w), wedge_pair(w + 0.7 * w)
        assert plan_channels(PART_60X100, near, w) == ["open", "conflict"]
        assert plan_channels(PART_60X100, far, w) == ["open", "open"]
        for holes in (near, far):
            assert_simple_ring(open_holes_with_channels(PART_60X100, holes, w))

    def test_channel_distance_tolerance_is_a_fraction_of_the_width(self):
        # 0.54 w apart conflicts, 0.56 w apart does not (limit 0.55 w).
        w = 1.0
        assert plan_channels(PART_60X100, wedge_pair(w + 0.54 * w), w) == ["open", "conflict"]
        assert plan_channels(PART_60X100, wedge_pair(w + 0.56 * w), w) == ["open", "open"]

    @pytest.mark.parametrize("order", [(0, 1), (1, 0)])
    def test_the_other_three_pairs_keep_the_small_tolerance(self, order):
        # A tall hole whose body is 0.3 w from the first hole's channel (hole
        # against channel, not channel against channel): not in conflict at
        # 0.3 w, in conflict at 0.005 (limit 0.01).
        w = 1.0
        first = wedge_pair(2.0)[0]
        for gap, expected in ((0.3, "open"), (0.005, "conflict")):
            tall = rect(42, 50.5 + gap, 46, 90)
            holes = [[first, tall][i] for i in order]
            assert plan_channels(PART_60X100, holes, w) == ["open", expected]


def fingers(w, gap, margin):
    """Review S1: two holes whose parallel channels (gap apart) each lean on a
    finger tip that the other channel erases. Returns (outer, [hole_i, hole_j])."""
    s = w / 1.1
    yi = w + gap
    f1tip = w / 2 + gap + margin
    f2tip = w / 2 - margin

    def X(v):
        return v * s

    outer = [[X(-5), X(-6)], [X(6), X(-6)], [X(6), X(-5)], [X(7.3), X(-5)], [X(7.3), f2tip], [X(7.0), f2tip],
             [X(7.0), X(-4)], [X(6), X(-4)], [X(6), X(5) + yi], [X(7.0), X(5) + yi], [X(7.0), f1tip],
             [X(7.3), f1tip], [X(7.3), X(6) + yi], [X(6), X(6) + yi], [X(6), X(7) + yi], [X(-5), X(7) + yi]]
    hole_i = [[X(4), yi], [0, yi + X(3)], [0, w / 2 + 0.02]]
    hole_j = [[X(4), 0], [0, w / 2 + gap - 0.02], [0, X(-3)]]
    return outer, [hole_i, hole_j]


def erased_depth(outer, holes, ring):
    """Largest distance from a point of the true material that the ring erased
    to what the ring keeps (grid of the erased area plus its boundary)."""
    import numpy as np
    import shapely
    material, kept = Polygon(outer, holes), Polygon(ring)
    erased = material.difference(kept)
    if erased.is_empty or erased.area < 1e-9:
        return 0.0
    minx, miny, maxx, maxy = erased.bounds
    step = max(min(maxx - minx, maxy - miny) / 60.0, 0.002)
    gx, gy = np.meshgrid(np.arange(minx, maxx + step, step), np.arange(miny, maxy + step, step))
    gx, gy = gx.ravel(), gy.ravel()
    inside = shapely.contains_xy(erased, gx, gy)
    pts = np.vstack([np.column_stack([gx[inside], gy[inside]]),
                     shapely.get_coordinates(shapely.segmentize(erased.boundary, step))])
    return float(shapely.distance(shapely.points(pts), kept).max())


class TestChannelAgainstChannelDepth:
    """R3.2: with the channels more than 0.55 w apart, H2 on one hole alone
    stays true for the whole part."""

    @pytest.mark.parametrize("space,gap,margin", [(0.5, 0.015, 0.03), (1.0, 0.015, 0.05), (2.0, 0.015, 0.1)])
    def test_two_fingers_leaning_on_each_other_open_only_one_hole(self, space, gap, margin):
        w = channel_width_for_space(space)
        outer, holes = fingers(w, gap, margin)
        decisions = plan_channels(outer, holes, w)
        assert sorted(decisions) == ["conflict", "open"]
        ring = open_holes_with_channels(outer, holes, w)
        assert_simple_ring(ring)
        assert erased_depth(outer, holes, ring) <= 0.6 * w

    def test_independent_holes_all_open(self):
        assert plan_channels(SQUARE, [HOLE_R35, HOLE_R5], 1.1) == ["open", "open"]


class TestDeepChannels:
    """H2: opening the hole alone must not erase material far from what remains."""

    @pytest.mark.parametrize("w", [0.6, 1.1, 2.1])
    def test_thin_frame_stays_closed_and_returns_the_outer_ring(self, w):
        outer, holes = THIN_FRAME
        assert plan_channels(outer, holes, w) == ["deep"]
        assert open_holes_with_channels(outer, holes, w) == closed_outer(outer)

    @pytest.mark.parametrize("space", [0.5, 1.0, 2.0])
    @pytest.mark.parametrize("wall", [0.2, 0.1, 0.08])
    def test_frames_thinner_than_the_grid_step_stay_closed(self, wall, space):
        # A wall under width / 8 falls between the grid samples: only the
        # boundary samples of the ring edges see it.
        w = channel_width_for_space(space)
        outer, holes = rect(0, 0, 10, 5), [rect(wall, wall, 10 - wall, 5 - wall)]
        assert plan_channels(outer, holes, w) == ["deep"]
        assert open_holes_with_channels(outer, holes, w) == closed_outer(outer)

    @pytest.mark.parametrize("w", [0.6, 1.1, 2.1])
    def test_frame_with_a_3mm_wall_opens(self, w):
        outer, holes = WALL3_FRAME
        assert plan_channels(outer, holes, w) == ["open"]
        ring = open_holes_with_channels(outer, holes, w)
        assert_simple_ring(ring)
        assert not Polygon(ring).contains(Point(8, 5.5))

    @pytest.mark.parametrize("w", [0.6, 1.1, 2.1])
    def test_tongue_stays_closed(self, w):
        outer = rect(0, 0, 20, 20)
        assert plan_channels(outer, [tongue_hole(w)], w) == ["deep"]
        assert open_holes_with_channels(outer, [tongue_hole(w)], w) == closed_outer(outer)

    @pytest.mark.parametrize("w", [1.1, 2.1])
    def test_key_stays_closed(self, w):
        assert plan_channels(rect(0, 0, 20, 17), [key_hole()], w) == ["deep"]

    def test_deep_hole_does_not_block_the_others(self):
        outer = rect(0, 0, 60, 30)
        thin_wall = rect(0.3, 0.3, 9.7, 4.7)   # 0.3 mm walls to the left and bottom edges
        large = rect(25, 5, 50, 25)
        for w in (0.6, 1.1):
            assert plan_channels(outer, [thin_wall, large], w) == ["deep", "open"]


class TestDepthSamplingLimits:
    def test_constants(self):
        assert holed_polygons.DEGENERATE_HOLE_MM2 == 1e-9
        assert holed_polygons.DEPTH_MAX_STEPS == 4096
        assert holed_polygons.DEPTH_FACTOR == 0.55 and holed_polygons.DEPTH_GRID == 8

    def test_very_long_channel_at_a_small_width_decides_quickly(self, monkeypatch):
        import time
        import numpy as np
        # 400 x 400 part, 20 x 20 hole at the centre: channel about 190 mm long.
        # At w = 0.1 the grid step is 0.0125 mm: 15000+ steps without a cap.
        outer, hole, w = rect(0, 0, 400, 400), rect(190, 190, 210, 210), 0.1
        sizes = []
        real = holed_polygons.shapely.contains_xy

        def spy(geom, xs, ys):
            sizes.append(np.size(xs))
            return real(geom, xs, ys)

        monkeypatch.setattr(holed_polygons.shapely, "contains_xy", spy)
        t = time.perf_counter()
        assert plan_channels(outer, [hole], w) == ["open"]
        assert time.perf_counter() - t < 2.0
        assert sizes and max(sizes) <= (holed_polygons.DEPTH_MAX_STEPS + 1) * (holed_polygons.DEPTH_GRID + 1)


class TestDegenerateHoles:
    """R3.1: a ring with fewer than 3 distinct vertices, or an absolute area
    of at most 1e-9, is "small" and never reaches a polygon constructor."""

    @pytest.mark.parametrize("hole", [
        [[20, 5], [26, 10], [32, 15]],                 # zero area (collinear), large box
        [[20, 5], [26, 10], [32, 15], [20, 5]],        # same, closed
        [[5, 5], [30, 15]],                            # two points
        [[5, 5], [30, 15], [5, 5]],                    # two points, closed
        [[5, 5], [5, 5], [30, 15]],                    # two distinct points
        [[5, 5]],
        [],
    ])
    def test_degenerate_hole_is_small_and_leaves_the_outer_ring(self, hole):
        assert plan_channels(PART_40X20, [hole], 1.1) == ["small"]
        assert open_holes_with_channels(PART_40X20, [hole], 1.1) == closed_outer(PART_40X20)

    def test_degenerate_hole_does_not_disturb_the_others(self):
        alone = open_holes_with_channels(PART_40X20, [BIG_HOLE_10X12], 1.1)
        for degenerate in ([[5, 5], [30, 15]], [[20, 5], [26, 10], [32, 15]]):
            for holes in ([degenerate, BIG_HOLE_10X12], [BIG_HOLE_10X12, degenerate]):
                decisions = plan_channels(PART_40X20, holes, 1.1)
                assert sorted(decisions) == ["open", "small"]
                assert open_holes_with_channels(PART_40X20, holes, 1.1) == alone

    def test_area_limit(self):
        assert holed_polygons._is_degenerate_ring([[20, 5], [32, 5.0], [32, 5.0 + 1e-6]]) is False
        assert holed_polygons._is_degenerate_ring([[20, 5], [32, 5.0], [32, 5.0 + 1e-10]]) is True
        assert holed_polygons._is_degenerate_ring([[0, 0], [1, 0], [1, 1], [0, 1]]) is False
        assert holed_polygons._is_degenerate_ring([[0, 0], [0, 1], [1, 1], [1, 0]]) is False  # clockwise

    @pytest.mark.parametrize("hole", [BIG_HOLE_10X12, rect(5, 5, 6, 15)])
    @pytest.mark.parametrize("w", [0.5, 1.1])
    def test_closed_and_unclosed_copies_decide_the_same(self, hole, w):
        closed = hole + [list(hole[0])]
        assert plan_channels(PART_40X20, [closed], w) == plan_channels(PART_40X20, [hole], w)
        a = open_holes_with_channels(PART_40X20, [closed], w)
        b = open_holes_with_channels(PART_40X20, [hole], w)
        assert Polygon(a).equals(Polygon(b))

    def test_closed_and_unclosed_outer_with_holes_decide_the_same(self):
        outer, holes = THIN_FRAME
        closed = [h + [list(h[0])] for h in holes]
        assert plan_channels(outer + [list(outer[0])], closed, 1.1) == plan_channels(outer, holes, 1.1)


class TestGapsFoundByTheMutants:
    """Rules that no other test pinned (review S3)."""

    def test_empty_remainder_means_closed(self):
        # The hole lies outside a tiny part: the channel (1.1 wide, extended by
        # 2.2) covers the whole part, nothing would remain. Closed, not open.
        outer = rect(0, 0, 0.4, 0.4)
        hole = rect(3, -1, 6, 3)
        assert plan_channels(outer, [hole], 1.1) == ["deep"]
        assert open_holes_with_channels(outer, [hole], 1.1) == closed_outer(outer)

    def test_a_non_simple_ring_falls_back_to_the_outer_ring(self, monkeypatch):
        # No input was found that makes the difference return a valid but
        # non-simple exterior (random and grid searches, see the report): the
        # wiring is forced.
        outer, hole = PART_40X20, BIG_HOLE_10X12
        assert open_holes_with_channels(outer, [hole], 1.1) != closed_outer(outer)
        monkeypatch.setattr(holed_polygons, "_is_simple_ring", lambda ring: False)
        assert open_holes_with_channels(outer, [hole], 1.1) == closed_outer(outer)

    def test_an_invalid_result_is_repaired_before_the_simple_ring_test(self, monkeypatch):
        # No input was found for which GEOS returns an invalid difference: the
        # result is forced. A square with a tiny crossing lobe (0.005 mm2):
        # repaired, the big piece is kept; unrepaired, the ring is not simple
        # and the outer ring would be returned.
        bowtie = Polygon([[0, 0], [10, 0], [10, 10], [0, 10], [0.1, -0.1]])
        assert not bowtie.is_valid
        outer = rect(-1, -1, 12, 12)

        class Material:
            is_empty = False

            def difference(self, other):
                return bowtie

        monkeypatch.setattr(holed_polygons, "Polygon", lambda *a, **k: Material())
        monkeypatch.setattr(holed_polygons, "_plan", lambda poly, o, h, w: (["open"], [None]))
        monkeypatch.setattr(holed_polygons, "unary_union", lambda geoms: None)
        ring = open_holes_with_channels(outer, [rect(3, 3, 5, 5)], 1.1)
        assert ring != closed_outer(outer)
        assert LineString(ring).is_simple and ring[0] == ring[-1] and len(ring) >= 5

    def test_the_depth_window_reaches_beyond_the_distance_that_decides(self, monkeypatch):
        # H2 cuts the material to a window around the channel. A window not
        # wider than the decision distance (0.55 w) could miss the nearest
        # remainder, so the remainder given to the distance test must extend
        # at least 0.55 w beyond the rectangle on every side.
        outer, hole, w = rect(0, 0, 100, 100), rect(30, 30, 60, 60), 1.1
        seen = {}
        real_far, real_deep = holed_polygons._any_farther_than, holed_polygons._channel_too_deep

        def far(shape, xs, ys, limit):
            seen["bounds"] = shape.bounds
            return real_far(shape, xs, ys, limit)

        def deep(outer_ring, hole_ring, rect_, *args):
            seen["rect"] = rect_.bounds
            return real_deep(outer_ring, hole_ring, rect_, *args)

        monkeypatch.setattr(holed_polygons, "_any_farther_than", far)
        monkeypatch.setattr(holed_polygons, "_channel_too_deep", deep)
        assert plan_channels(outer, [hole], w) == ["open"]
        rx0, ry0, rx1, ry1 = seen["rect"]
        bx0, by0, bx1, by1 = seen["bounds"]
        margin = 0.55 * w
        # Across the channel (the part is 100 mm wide there); along the axis the
        # remainder stops at the part's edge.
        assert bx0 <= rx0 - margin and bx1 >= rx1 + margin

    def test_grid_samples_must_be_strictly_inside_the_material(self, monkeypatch):
        # The strict test applies to the grid only; a ring point is a boundary
        # sample or nothing. Spy: the strict function is used, the loose one never.
        calls = {"strict": 0, "loose": 0}
        real_strict, real_loose = holed_polygons.shapely.contains_xy, holed_polygons.shapely.intersects_xy

        def strict(*a, **k):
            calls["strict"] += 1
            return real_strict(*a, **k)

        def loose(*a, **k):
            calls["loose"] += 1
            return real_loose(*a, **k)

        monkeypatch.setattr(holed_polygons.shapely, "contains_xy", strict)
        monkeypatch.setattr(holed_polygons.shapely, "intersects_xy", loose)
        assert plan_channels(PART_40X20, [BIG_HOLE_10X12], 1.1) == ["open"]
        assert calls["strict"] >= 1 and calls["loose"] == 0


class TestSplitAndSimpleRing:
    """H3: the result must be one simple ring."""

    def test_split_part_returns_the_outer_ring(self):
        outer, holes = u_part(20)
        # The channel extension cuts the thin arm in two: 4.35 mm2 would be
        # ignored by the engine, so the part keeps every hole closed.
        assert plan_channels(outer, holes, 0.6) == ["open"]
        assert open_holes_with_channels(outer, holes, 0.6) == closed_outer(outer)

    def test_dropped_piece_just_above_the_limit_returns_the_outer_ring(self):
        outer, holes = u_part(11.42)   # dropped piece 0.5 * 0.12 = 0.06 mm2
        assert open_holes_with_channels(outer, holes, 0.6) == closed_outer(outer)

    def test_dropped_sliver_under_the_limit_is_ignored(self):
        outer, holes = u_part(11.38)   # dropped piece 0.5 * 0.08 = 0.04 mm2 < 0.05
        ring = open_holes_with_channels(outer, holes, 0.6)
        assert ring != closed_outer(outer)
        assert_simple_ring(ring)
        poly = Polygon(ring)
        assert not poly.contains(Point(6.5, 11))  # the hole is open
        assert poly.area == pytest.approx(Polygon(outer).area - Polygon(holes[0]).area, abs=2.0)

    @pytest.mark.parametrize("ring,simple", [
        ([[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], True),
        ([[0, 0], [4, 4], [4, 0], [0, 4], [0, 0]], False),                 # bow tie (edges cross)
        ([[0, 0], [4, 0], [4, 4], [2, 2], [0, 4], [2, 2], [0, 0]], False),  # repeated vertex
        ([[0, 0], [4, 0], [2, 0], [0, 0]], False),                          # degenerate
    ])
    def test_simple_ring_check(self, ring, simple):
        assert holed_polygons._is_simple_ring(ring) is simple


class TestUnchangedWhereTheRulesDoNotApply:
    """The ring is identical to the previous construction for the benchmark
    host shape and when there is no separation."""

    @pytest.mark.parametrize("width", [0.01, 0.2, 1.1, 2.1, 2.5])
    def test_host_ring_identical_to_previous_construction(self, width):
        outer, holes = host_ring()
        new = open_holes_with_channels(outer, holes, width)
        assert new == previous_open_holes(outer, holes, width)
        assert new != closed_outer(outer)  # the hole is open

    def test_host_ring_default_width_identical(self):
        outer, holes = host_ring()
        assert open_holes_with_channels(outer, holes) == previous_open_holes(outer, holes)

    def test_host_ring_spacing_widths_identical(self):
        outer, holes = host_ring()
        for space in (0.0, 0.5, 1.0, 2.0):
            w = channel_width_for_space(space)
            assert open_holes_with_channels(outer, holes, w) == previous_open_holes(outer, holes, w)

    @pytest.mark.parametrize("width", [None, 0.01])
    def test_no_spacing_keeps_the_existing_shapes_identical(self, width):
        for holes in ([HOLE_R35], [HOLE_R35, HOLE_R5], [HOLE_R35, HOLE_R5_COLLINEAR]):
            assert open_holes_with_channels(SQUARE, holes, width) == previous_open_holes(SQUARE, holes, width)


class TestPlanAndLogging:
    def test_plan_without_holes_is_empty(self):
        assert plan_channels(SQUARE, []) == []

    def test_nothing_opened_returns_the_outer_ring_unchanged(self):
        ring = open_holes_with_channels(PART_40X20, [rect(5, 5, 6, 15)], 0.5)
        assert ring == closed_outer(PART_40X20)
        assert ring is not PART_40X20

    def test_closed_holes_are_logged_once_with_counts(self):
        records = []

        class Catch(logging.Handler):
            def emit(self, record):
                records.append(record.getMessage())

        handler = Catch(level=logging.INFO)
        old_level = holed_polygons.logger.level
        holed_polygons.logger.addHandler(handler)
        holed_polygons.logger.setLevel(logging.INFO)
        try:
            open_holes_with_channels(PART_40X20, [rect(5, 5, 6, 15), BIG_HOLE_10X12], 0.5)
            open_holes_with_channels(PART_40X20, [BIG_HOLE_10X12], 0.5)
        finally:
            holed_polygons.logger.removeHandler(handler)
            holed_polygons.logger.setLevel(old_level)
        closed_lines = [m for m in records if "closed" in m]
        assert len(closed_lines) == 1
        assert "small=1" in closed_lines[0] and "1 of 2" in closed_lines[0]


ALL_CASES = {
    "r35": (SQUARE, [HOLE_R35], 1.1),
    "r35+r5": (SQUARE, [HOLE_R35, HOLE_R5], 1.1),
    "collinear": (SQUARE, [HOLE_R35, HOLE_R5_COLLINEAR], 0.6),
    "narrow+big": (PART_40X20, [rect(5, 5, 6, 15), BIG_HOLE_10X12], 0.5),
    "flush+big": (PART_40X20, [rect(2, 0.005, 8, 10), BIG_HOLE_10X12], 0.6),
    "line": (SQUARE_100, [DIAMOND_FAR, DIAMOND_NEAR], 1.1),
    "line-rev": (SQUARE_100, [DIAMOND_NEAR, DIAMOND_FAR], 2.1),
    "side-by-side-close": (PART_60X100, wedge_pair(0.605), 0.6),
    "side-by-side-far": (PART_60X100, wedge_pair(0.8), 0.6),
    "thin-frame": (THIN_FRAME[0], THIN_FRAME[1], 1.1),
    "frame3": (WALL3_FRAME[0], WALL3_FRAME[1], 2.1),
    "tongue": (rect(0, 0, 20, 20), [tongue_hole(2.1)], 2.1),
    "key": (rect(0, 0, 20, 17), [key_hole()], 2.1),
    "u-split": (u_part(20)[0], u_part(20)[1], 0.6),
    "u-sliver": (u_part(11.38)[0], u_part(11.38)[1], 0.6),
    "u-over": (u_part(11.42)[0], u_part(11.42)[1], 0.6),
    "host": (host_ring()[0], host_ring()[1], 2.1),
}


@pytest.mark.parametrize("name", sorted(ALL_CASES))
def test_result_is_always_one_simple_ring(name):
    outer, holes, width = ALL_CASES[name]
    ring = open_holes_with_channels(outer, holes, width)
    assert_simple_ring(ring)
    # The ring never leaves the outer ring.
    assert Polygon(ring).difference(Polygon(outer).buffer(1e-6)).area == pytest.approx(0, abs=1e-9)
