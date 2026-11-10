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

    def test_verification_judges_against_requested(self):
        sq = {"id": 0, "coords": [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]}
        cont = ResultContainer(1, [
            Transform("f", ["h"], 30.0, 30.0, 0.0, item_id=0),
            Transform("f", ["h"], 42.05, 30.0, 0.0, item_id=0),
        ], bin_width=100.0, bin_height=100.0)
        assert verify_layout([cont], [sq], 2.0)["spacingOk"] is True
        assert verify_layout([cont], [sq], 2.12)["spacingOk"] is False  # l'interne ne doit pas juger

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
