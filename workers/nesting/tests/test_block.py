"""E4-a — la fiche multi-pièces est UN item bloc rigide
(docs/PLAN-ECLATEMENT-2026-09-12.md §8.1).

Miroir exact des verrous JS (app/tests/localPayloadBuilder.test.js et
localBridge.test.js) : mêmes géométries, mêmes nombres. Deux rectangles
10x10 et un triangle — aire VRAIE 312,5 mm², enveloppe 850 mm².

Run: PYTHONPATH=workers/common:workers/nesting python -m pytest workers/nesting/tests/test_block.py -q
"""
import math
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "common"))

# worker_common.mongo connects at import time — stub before importing main.
sys.modules.setdefault(
    "worker_common.mongo",
    types.SimpleNamespace(db=None, get_bucket=lambda name: None),
)

import core.main as m
from core.holefill import _part_area, plan_hole_fills
from core.metrics import per_sheet_metrics
from core.placement import ResultContainer, Transform
from core.structure import detect_structural_case
from core.svg_colored import build_colored_sheet_svg

RECT_A = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
RECT_B = [[20, 5], [30, 5], [30, 15], [20, 15], [20, 5]]
TRI = [[5, 20], [15, 35], [0, 35], [5, 20]]
# Mêmes sommets que le verrou JS (chaîne monotone d'Andrew : CCW, départ
# au sommet lexico-minimal, colinéaires exclus) — parité 1e-6.
EXPECTED_HULL = [[0, 0], [10, 0], [30, 5], [30, 15], [15, 35], [0, 35], [0, 0]]

BLOCK_PARTS = [
    {"coords": RECT_A, "holes": [], "color": "#111111"},
    {"coords": RECT_B, "holes": [], "color": "#222222"},
    {"coords": TRI, "holes": [], "color": "#333333"},
]


def _block_item():
    return {
        "id": 7,
        "file_slug": "logo.dxf",
        "coords": EXPECTED_HULL,
        "holes": [],
        "handles": ["A1", "B2", "C3"],
        "count": 1,
        "rotations": [0, 90],
        "color": "#111111",
        "block": {"parts": 3},
        "blockParts": [dict(bp) for bp in BLOCK_PARTS],
    }


def _plain_item():
    return {
        "id": 8,
        "file_slug": "single.dxf",
        "coords": [[100, 0], [110, 0], [110, 10], [100, 10], [100, 0]],
        "holes": [],
        "handles": ["H"],
        "count": 2,
        "rotations": [0],
        "color": None,
    }


class TestConvexHullRing:
    def test_parity_with_js(self):
        points = RECT_A[:-1] + RECT_B[:-1] + TRI[:-1] + [
            [10, 0],      # doublon
            [5, 0],       # colinéaire sur l'arête (0,0)-(10,0)
            [7.5, 35],    # colinéaire sur l'arête (15,35)-(0,35)
        ]
        hull = m._convex_hull_ring(points)
        assert len(hull) == len(EXPECTED_HULL)
        for (x1, y1), (x2, y2) in zip(hull, EXPECTED_HULL):
            assert abs(x1 - x2) <= 1e-6
            assert abs(y1 - y2) <= 1e-6

    def test_degenerate(self):
        assert m._convex_hull_ring([[0, 0], [0, 0], [5, 5]]) == []


class TestConvertFilesToInputItems:
    def _run(self, monkeypatch, parts_by_slug):
        def fake_resolve(db, doc, dek):
            return parts_by_slug[doc["slug"]]

        monkeypatch.setattr(m, "resolve_polygon_parts", fake_resolve)

        class FakeFiles:
            def find_one(self, flt):
                return {"slug": flt.get("slug")}

        class FakeDb(dict):
            def __init__(self):
                super().__init__()
                self["user_dxf_files"] = FakeFiles()

        monkeypatch.setattr(m, "db", FakeDb())
        return m.convert_files_to_input_items(
            [{"slug": slug, "count": 2, "rotations": [0, 90]} for slug in parts_by_slug],
        )

    def test_multi_part_file_becomes_one_block_item(self, monkeypatch):
        parts = [
            {"coordinates": RECT_A, "holes": [], "handles": ["A1"], "color": None},
            {"coordinates": RECT_B, "holes": [], "handles": ["B2"], "color": None},
            {"coordinates": TRI, "holes": [], "handles": ["C3"], "color": None},
        ]
        items = self._run(monkeypatch, {"logo-q7w8e9.dxf": parts})
        assert len(items) == 1
        block = items[0]
        assert block["block"] == {"parts": 3}
        assert block["holes"] == []
        assert block["handles"] == ["A1", "B2", "C3"]
        assert block["count"] == 2
        assert block["rotations"] == [0, 90]
        for (x1, y1), (x2, y2) in zip(block["coords"], EXPECTED_HULL):
            assert abs(x1 - x2) <= 1e-6
            assert abs(y1 - y2) <= 1e-6
        assert len(block["blockParts"]) == 3
        assert block["blockParts"][0]["coords"] == RECT_A
        assert block["blockParts"][2]["coords"] == TRI

    def test_single_part_file_has_no_block_keys(self, monkeypatch):
        parts = [{"coordinates": RECT_A, "holes": [], "handles": ["A1"], "color": None}]
        items = self._run(monkeypatch, {"single-a1b2c3.dxf": parts})
        assert len(items) == 1
        assert "block" not in items[0]
        assert "blockParts" not in items[0]

    def test_degenerate_block_raises_actionable(self, monkeypatch):
        # Pièces TOUTES alignées sur y=0 (anneaux dégénérés) : l'enveloppe
        # n'a pas d'aire — refus explicite plutôt qu'un polygone vide au
        # moteur.
        parts = [
            {"coordinates": [[0, 0], [5, 0], [10, 0], [0, 0]], "holes": [], "handles": [], "color": None},
            {"coordinates": [[10, 0], [15, 0], [20, 0], [10, 0]], "holes": [], "handles": [], "color": None},
        ]
        with pytest.raises(Exception, match="degenerate block hull"):
            self._run(monkeypatch, {"flat-z9y8x7.dxf": parts})


class TestAreas:
    def test_part_area_block_is_true_area_not_hull(self):
        # 100 + 100 + 112,5 = 312,5 — jamais l'enveloppe (850).
        assert abs(_part_area(_block_item()) - 312.5) < 1e-9

    def test_per_sheet_metrics_true_area(self):
        container = ResultContainer(
            1,
            [
                Transform("logo.dxf", ["A1", "B2", "C3"], 0.0, 0.0, 0.0, item_id=7),
                Transform("single.dxf", ["H"], 0.0, 50.0, 0.0, item_id=8),
            ],
            bin_width=100.0,
            bin_height=10.0,
        )
        sheets = per_sheet_metrics([container], [_block_item(), _plain_item()])
        # 312,5 (bloc, aire vraie) + 100 (UNE pose de la pièce simple) = 412,5
        assert abs(sheets[0]["partsAreaMm2"] - 412.5) < 0.05
        # 412,5/1000 = 41,25 % : arrondi au dixième EXACTEMENT À LA MOITIÉ —
        # Python arrondit banquier (41,2), JS demi-supérieur (41,3) ;
        # divergence d'affichage préexistante, l'aire est la même.
        assert abs(sheets[0]["densityPct"] - 41.25) <= 0.05
        # Un bloc placé compte comme UNE entrée (partCount = poses).
        assert sheets[0]["partCount"] == 2


class TestPrePassExclusions:
    def test_block_is_never_a_filler(self):
        hole = [
            [235, 200], [234.3, 206.8], [232.3, 213.4], [229.1, 219.4],
            [224.7, 224.7], [219.4, 229.1], [213.4, 232.3], [206.8, 234.3],
            [200, 235], [193.2, 234.3], [186.6, 232.3], [180.6, 229.1],
            [175.3, 224.7], [170.9, 219.4], [167.7, 213.4], [165.7, 206.8],
            [165, 200], [165.7, 193.2], [167.7, 186.6], [170.9, 180.6],
            [175.3, 174.7], [180.6, 170.9], [186.6, 167.7], [193.2, 165.7],
            [200, 165], [206.8, 165.7], [213.4, 167.7], [219.4, 170.9],
            [224.7, 174.7], [229.1, 180.6], [232.3, 186.6], [234.3, 193.2],
            [235, 200],
        ]
        host = {
            "id": 1,
            "coords": [[150, 150], [250, 150], [250, 250], [150, 250], [150, 150]],
            "holes": [hole],
            "count": 1,
            "rotations": [0, 90, 180, 270],
        }
        small = {
            "id": 2,
            "coords": [[-5, -5], [5, -5], [5, 5], [-5, 5], [-5, -5]],
            "holes": [],
            "count": 4,
            "rotations": [0, 90, 180, 270],
        }
        block = dict(_block_item(), count=2, rotations=[0, 90, 180, 270])
        packs = plan_hole_fills([host, small, block], 2)
        used = {f["fillId"] for p in (packs or []) for f in p.get("fills") or []}
        assert 2 in used
        assert 7 not in used

    def test_detect_structural_case_ignores_blocks(self):
        rect = {"id": 1, "coords": [[0, 0], [100, 0], [100, 50], [0, 50], [0, 0]], "holes": []}
        small = {"id": 2, "coords": [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], "holes": []}
        items = [{"id": 1, "demand": 10}, {"id": 2, "demand": 10}]
        geom_plain = {
            1: {"coords": rect["coords"], "rotations": [0.0]},
            2: {"coords": small["coords"], "rotations": [0.0]},
        }
        assert detect_structural_case(items, lambda i: geom_plain[i], 51000) is not None
        geom_block = {**geom_plain, 1: {"coords": rect["coords"], "rotations": [0.0], "block": {"parts": 2}}}
        assert detect_structural_case(items, lambda i: geom_block[i], 51000) is None


class TestSvgAndReport:
    def test_svg_draws_every_part_under_the_same_pose(self):
        svg = build_colored_sheet_svg(
            [Transform("logo.dxf", ["A1", "B2", "C3"], 0.0, 10.0, 20.0, item_id=7, color=None)],
            {7: _block_item()},
            1000.0, 1000.0,
        )
        # 3 <path> (une par pièce), AUCUN pour l'enveloppe seule.
        assert svg.count("<path") == 3
        # Même pose partout : les trois transforms sont identiques.
        transforms = [line.split('transform="')[1].split('"')[0] for line in svg.splitlines() if "<path" in line]
        assert len(set(transforms)) == 1

    def test_blocks_report(self):
        block = _block_item()
        plain = _plain_item()
        container = ResultContainer(
            1,
            [
                Transform("logo.dxf", ["A1", "B2", "C3"], 0.0, 0.0, 0.0, item_id=7),
                Transform("single.dxf", ["H"], 0.0, 50.0, 0.0, item_id=8),
                Transform("single.dxf", ["H"], 0.0, 70.0, 0.0, item_id=8),
            ],
            bin_width=1000.0, bin_height=100.0,
        )
        assert m._blocks_report([block, plain], [container]) == {"blocks": {"placed": 1, "pieces": 3}}
        # Sans bloc : {} (le champ n'est jamais posé).
        assert m._blocks_report([plain], [container]) == {}
