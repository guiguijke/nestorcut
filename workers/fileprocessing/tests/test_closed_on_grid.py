"""Un contour fermé au dessin le reste à l'arrondi sur la grille de 1e-4 mm.

Miroir de `nest-import/tests/closed_on_grid.rs` : une coordonnée à mi-chemin de
deux pas (pouces au 1/32 ou au 1/64, cinq décimales) s'arrondit d'un côté ou de
l'autre pour un écart de 1e-16, et le bout calculé d'un arc ne tombe plus sur
celui, écrit, du segment voisin.
"""
import math
import sys
from pathlib import Path

import ezdxf
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from shapely.geometry import Polygon

from core.geometry.build_geometry import build_geometry
from dxf_utils import read_dxf_file

IN = 25.4


def _parts(tmp_path, draw, insunits=1):
    doc = ezdxf.new()
    doc.header["$INSUNITS"] = insunits
    draw(doc)
    path = tmp_path / "d.dxf"
    doc.saveas(path)
    parts = [p.to_mongo_dict() for p in build_geometry(read_dxf_file(str(path)), 0.01)]
    return [p for p in parts if p is not None]


def _area(part):
    return Polygon(part["coordinates"], part["holes"]).area


def _rounded(msp, x, y, w, h, r):
    msp.add_line((x + r, y), (x + w - r, y))
    msp.add_arc((x + w - r, y + r), r, 270, 360)
    msp.add_line((x + w, y + r), (x + w, y + h - r))
    msp.add_arc((x + w - r, y + h - r), r, 0, 90)
    msp.add_line((x + w - r, y + h), (x + r, y + h))
    msp.add_arc((x + r, y + h - r), r, 90, 180)
    msp.add_line((x, y + h - r), (x, y + r))
    msp.add_arc((x + r, y + r), r, 180, 270)


@pytest.mark.parametrize("centre, r, insunits", [
    ((-9.25775, 31.46505), 27.33376, 4),
    ((5.59375, -0.53125), 0.5, 1),
])
def test_un_trou_rond_a_mi_pas_n_a_pas_de_sommet_en_trop(tmp_path, centre, r, insunits):
    # `Polygon` refermait déjà le cercle, mais avec un sommet à un pas du premier.
    def draw(d):
        x0, y0, x1, y1 = centre[0] - 2 * r, centre[1] - 2 * r, centre[0] + 2 * r, centre[1] + 2 * r
        d.modelspace().add_lwpolyline([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], close=True)
        d.modelspace().add_circle(centre, r)

    parts = _parts(tmp_path, draw, insunits)
    assert len(parts) == 1 and len(parts[0]["holes"]) == 1
    ring = parts[0]["holes"][0]
    assert min(math.dist(a, b) for a, b in zip(ring, ring[1:])) > 0.01


def test_un_rectangle_arrondi_garde_son_contour_piece_et_trou(tmp_path):
    for k in range(60):
        x, y = k / 32, (2 * k + 1) / 32
        w, h, r = 2 + (k % 13) / 32, 1 + (k % 11) / 32, 0.25 + (k % 5) / 32
        want = (w * h - (4 - math.pi) * r * r) * IN * IN
        parts = _parts(tmp_path, lambda d: _rounded(d.modelspace(), x, y, w, h, r))
        assert len(parts) == 1, k
        assert _area(parts[0]) == pytest.approx(want, abs=1.0)

        def plate(d):
            d.modelspace().add_lwpolyline([(-4, -4), (12, -4), (12, 12), (-4, 12)], close=True)
            _rounded(d.modelspace(), x, y, w, h, r)

        parts = _parts(tmp_path, plate)
        assert len(parts) == 1 and len(parts[0]["holes"]) == 1, k


def test_un_arc_d_un_tour_entier_est_un_disque(tmp_path):
    for a0, a1 in ((0, 360), (123.456, 483.456), (90, 450)):
        for rot in (0, 37.3, 90, 211.7, 270):

            def draw(d):
                d.blocks.new("B").add_arc((5, 2), 10, a0, a1)
                d.modelspace().add_blockref("B", (3, 4), dxfattribs={"rotation": rot})

            parts = _parts(tmp_path, draw, insunits=4)
            assert len(parts) == 1, (a0, a1, rot)
            assert _area(parts[0]) == pytest.approx(math.pi * 100, abs=1.0)


def test_des_bouts_eloignes_restent_ouverts(tmp_path):
    def corner(gap):
        def draw(d):
            msp = d.modelspace()
            msp.add_line((0, 0), (30, 0))
            msp.add_line((30, 0), (30, 20))
            msp.add_line((30, 20), (0, 20))
            msp.add_line((0, 20), (0, gap))

        return _parts(tmp_path, draw, insunits=4)

    assert [len(corner(g)) for g in (1e-4, 2e-4)] == [1, 1]
    assert [len(corner(g)) for g in (4e-4, 1e-3, 5e-3)] == [0, 0, 0]
