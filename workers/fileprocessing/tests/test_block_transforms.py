"""Le chemin serveur lit ses polylignes en coordonnées MONDE.

`LWPolyline.get_points` et `Polyline.points` rendent les coordonnées brutes de
l'OCS. Sous un bloc miroir, ezdxf inverse l'extrusion (0, 0, -1) sans déplacer
ces coordonnées : les lire telles quelles pose l'anneau de nesting à l'opposé de
l'entité que le fichier de coupe va tracer. Les valeurs attendues viennent
d'ezdxf (`vertices_in_wcs`, `points_in_wcs`).
"""
import os
import sys
from pathlib import Path

import ezdxf
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.geometry.build_geometry import build_geometry  # noqa: E402
from dxf_utils import read_dxf_file  # noqa: E402

CORPUS = Path(__file__).parents[2] / "geometry" / "parity" / "corpus_extra"
TOL = 0.01


def _bboxes(drawing):
    out = []
    for part in build_geometry(drawing, TOL):
        d = part.to_mongo_dict()
        xs = [p[0] for p in d["coordinates"]]
        ys = [p[1] for p in d["coordinates"]]
        out.append((min(xs), min(ys), max(xs), max(ys)))
    return sorted(out)


def _assert_bboxes(got, want):
    assert len(got) == len(want), got
    for g, w in zip(got, want):
        assert g == pytest.approx(w, abs=1e-3), got


def test_lwpolyline_in_a_rotated_mirror_block_lands_where_ezdxf_draws_it():
    drawing = read_dxf_file(str(CORPUS / "block_mirror_rotation.dxf"))
    _assert_bboxes(_bboxes(drawing), [
        (60.358984, 80.0, 100.0, 125.980762),
        (300.0, 285.0, 330.980762, 334.641016),
        (470.0, 420.0, 500.0, 500.0),
    ])


def test_classic_polyline_in_a_mirror_block_lands_where_ezdxf_draws_it(tmp_path):
    doc = ezdxf.new()
    doc.header["$INSUNITS"] = 4
    blk = doc.blocks.new("B")
    blk.add_polyline2d([(10, 0), (40, 0), (40, 20), (10, 20)], close=True)
    doc.modelspace().add_blockref("B", (100, 0), dxfattribs={"xscale": -1})
    path = tmp_path / "mirror_polyline.dxf"
    doc.saveas(path)
    drawing = read_dxf_file(str(path))
    _assert_bboxes(_bboxes(drawing), [(60.0, 0.0, 90.0, 20.0)])


def test_unmirrored_drawing_is_unchanged(tmp_path):
    doc = ezdxf.new()
    doc.header["$INSUNITS"] = 4
    doc.modelspace().add_lwpolyline([(1, 2), (31, 2), (31, 12), (1, 12)], close=True)
    doc.modelspace().add_polyline2d([(50, 2), (80, 2), (80, 12), (50, 12)], close=True)
    path = tmp_path / "plain.dxf"
    doc.saveas(path)
    _assert_bboxes(_bboxes(read_dxf_file(str(path))), [
        (1.0, 2.0, 31.0, 12.0),
        (50.0, 2.0, 80.0, 12.0),
    ])
