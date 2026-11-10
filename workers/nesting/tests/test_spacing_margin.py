"""L'espacement demandé est tenu sur les vraies courbes : espacement interne
= demandé + marge mesurée ; la vérification juge contre le demandé."""
import math
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "common"))

# worker_common.mongo se connecte à l'import — bouchon avant d'importer main.
sys.modules.setdefault(
    "worker_common.mongo",
    types.SimpleNamespace(db=None, get_bucket=lambda name: None),
)

from shapely.affinity import translate
from shapely.geometry import Point, Polygon

import core.main as m
from core.metrics import verify_layout
from core.nesting_input_builder import build_engine_config
from core.placement import ResultContainer, Transform


def _disc(r, n=160):
    pts = [[r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n)] for i in range(n)]
    return pts + [pts[0]]


RECT = [[0, 0], [40, 0], [40, 20], [0, 20], [0, 0]]


def _convert(monkeypatch, ring):
    monkeypatch.setattr(m, "resolve_polygon_parts", lambda db, doc, dek: [
        {"coordinates": ring, "holes": [], "handles": ["A"], "color": None}])

    class FakeFiles:
        def find_one(self, flt):
            return {"slug": flt.get("slug")}

    monkeypatch.setattr(m, "db", {"user_dxf_files": FakeFiles()})
    stats = {}
    items = m.convert_files_to_input_items(
        [{"slug": "a.dxf", "count": 2, "rotations": [0]}], None, stats)
    return items, stats


def _measured_gap(orig, simp):
    poly = Polygon(simp).exterior
    return max(poly.distance(Point(p)) for p in orig)


class TestSpacingMargin:
    def test_rectangles_margin_zero_engine_config_keeps_2(self, monkeypatch):
        _, stats = _convert(monkeypatch, RECT)
        margin = m.spacing_margin(stats, 2)
        assert margin == 0
        cfg = build_engine_config(10, 1, 1, min_separation=2 + margin)
        assert cfg["min_item_separation"] == 2

    def test_disc_margin_is_two_gaps_plus_flatten_reserve(self, monkeypatch):
        ring = _disc(50)
        items, stats = _convert(monkeypatch, ring)
        gap = _measured_gap(ring, items[0]["coords"])
        assert gap > 0
        margin = m.spacing_margin(stats, 2)
        assert 0 < margin <= 0.12
        assert margin == pytest.approx(min(0.12, 2 * gap + 0.02), abs=1e-9)

    def test_requested_zero_margin_zero_no_separation(self, monkeypatch):
        _, stats = _convert(monkeypatch, _disc(50))
        assert m.spacing_margin(stats, 0) == 0
        assert build_engine_config(10, 1, 1, min_separation=0 + m.spacing_margin(stats, 0))[
            "min_item_separation"] is None

    @staticmethod
    def _pair(x2):
        sq = {"id": 0, "coords": [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]}
        cont = ResultContainer(1, [
            Transform("f", ["h"], 30.0, 30.0, 0.0, item_id=0),
            Transform("f", ["h"], x2, 30.0, 0.0, item_id=0),
        ], bin_width=100.0, bin_height=100.0)
        return cont, sq

    def test_reported_gap_is_measured_minus_margin(self):
        # Paire posée à l'interne 2,12 (demandé 2 + marge 0,12) : l'écart
        # annoncé est 2,00, borne garantie sur les vraies courbes.
        cont, sq = self._pair(42.12)
        rep = verify_layout([cont], [sq], 2.0, margin=0.12)
        assert rep["smallestGapMm"] == pytest.approx(2.0, abs=1e-9)
        assert rep["spacingOk"] is True

    def test_deficit_hidden_by_internal_gap_is_now_caught(self):
        # Paire à 2,05 sur les contours simplifiés, marge 0,12 : sur les
        # vraies courbes l'écart garanti est 1,93 < 2 - 0,01.
        cont, sq = self._pair(42.05)
        rep = verify_layout([cont], [sq], 2.0, margin=0.12)
        assert rep["smallestGapMm"] == pytest.approx(1.93, abs=1e-9)
        assert rep["spacingOk"] is False

    def test_reported_gap_never_negative(self):
        cont, sq = self._pair(40.05)  # écart mesuré 0,05 < marge
        rep = verify_layout([cont], [sq], 2.0, margin=0.12)
        assert rep["smallestGapMm"] == 0
        assert rep["spacingOk"] is False

    def test_margin_zero_unchanged(self):
        cont, sq = self._pair(42.05)
        rep = verify_layout([cont], [sq], 2.0)
        assert rep["smallestGapMm"] == pytest.approx(2.05, abs=1e-9)
        assert rep["spacingOk"] is True

    def test_original_contours_keep_requested_spacing(self, monkeypatch):
        ring = _disc(50)
        items, stats = _convert(monkeypatch, ring)
        simp = items[0]["coords"]
        requested = 2.0

        def worst_original_distance(internal):
            # Contours SIMPLIFIES poses exactement a l'espacement interne,
            # dans 36 directions ; on garde la pire distance des contours
            # D'ORIGINE.
            worst = float("inf")
            for k in range(36):
                ux, uy = math.cos(math.radians(k * 10 + 3)), math.sin(math.radians(k * 10 + 3))
                lo, hi = 90.0, 110.0
                for _ in range(50):
                    mid = (lo + hi) / 2
                    moved = translate(Polygon(simp), xoff=mid * ux, yoff=mid * uy)
                    if Polygon(simp).distance(moved) < internal:
                        lo = mid
                    else:
                        hi = mid
                dx = (lo + hi) / 2
                moved = translate(Polygon(ring), xoff=dx * ux, yoff=dx * uy)
                worst = min(worst, Polygon(ring).distance(moved))
            return worst

        with_margin = worst_original_distance(requested + m.spacing_margin(stats, requested))
        without = worst_original_distance(requested)
        assert with_margin >= requested - 0.02
        assert without < requested - 0.02  # sans la marge, le test échoue


def _flat_arc_rect():
    """Rectangle 60x30 dont le côté haut est un arc de flèche 0,056 mm
    (R ~ 8 036 mm) aplati en 3 segments : 6 sommets, la simplification
    retire les 2 sommets intermédiaires."""
    s = 0.056
    big_r = (30 ** 2 / 1 + s * s) / (2 * s)
    sag = lambda x: math.sqrt(big_r ** 2 - (x - 30) ** 2) - (big_r - s)
    return [[0, 0], [60, 0], [60, 30], [40, 30 + sag(40)], [20, 30 + sag(20)], [0, 30], [0, 0]]


class TestFlatArcReserve:
    def test_flat_arc_gets_flatten_reserve(self, monkeypatch):
        ring = _flat_arc_rect()
        assert len(ring) - 1 == 6
        items, stats = _convert(monkeypatch, ring)
        assert len(items[0]["coords"]) < len(ring)  # sommets retirés
        gap = _measured_gap(ring, items[0]["coords"])
        assert gap > 0.04
        margin = m.spacing_margin(stats, 2)
        assert margin == pytest.approx(min(0.12, 2 * gap + 0.02), abs=1e-9)

    def test_rectangle_with_collinear_vertex_keeps_zero(self, monkeypatch):
        ring = [[0, 0], [20, 0], [40, 0], [40, 20], [0, 20], [0, 0]]
        _, stats = _convert(monkeypatch, ring)
        assert m.spacing_margin(stats, 2) == 0


class TestUserMaxSpacing:
    def test_rounded_down_to_hundredth(self):
        assert m.user_max_spacing(0.04093972273017499, 0) == (0.04, False)
        assert m.user_max_spacing(2.1396, 0.0996) == (2.04, False)
        assert m.user_max_spacing(2.1, 0.1) == (2.0, False)

    def test_internal_max_below_margin_zero_is_a_real_lever(self):
        assert m.user_max_spacing(0.1, 0.12) == (0.0, True)
        assert m.user_max_spacing(0.12, 0.12) == (0.0, True)

    def test_internal_max_zero_nothing_fits(self):
        assert m.user_max_spacing(0, 0.12) == (0.0, False)
        assert m.user_max_spacing(0, 0) == (0.0, False)


class TestTooLargeMessageMargin:
    UNPLACEABLE = [{"name": "disque.dxf", "width": 196.0, "height": 196.0, "count": 1}]
    SHEETS = [{"width": 200, "height": 200}]

    def test_margin_zero_message_unchanged(self):
        from core.engine import too_large_message
        msg = too_large_message(self.UNPLACEABLE, self.SHEETS, 2.0)
        assert "spacing: 2.0mm. Use a larger sheet" in msg
        assert "margin" not in msg

    def test_margin_is_told_when_positive(self):
        from core.engine import too_large_message
        msg = too_large_message(self.UNPLACEABLE, self.SHEETS, 2.0, 0.1)
        assert "spacing: 2.0mm (plus 0.10mm margin for curves). Use a larger sheet" in msg
        assert msg.startswith("Part(s) too large for the sheet:")
