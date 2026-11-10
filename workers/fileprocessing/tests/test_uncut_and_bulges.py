"""Ce qui ne sera pas découpé, côté serveur, et les arcs de polylignes lus en cordes.

Mêmes fichiers et mêmes valeurs que `nest-import/tests/uncut_and_bulges.rs`, lues par ezdxf :
flèche = rayon - sqrt(rayon^2 - (corde/2)^2) avec `bulge_to_arc`.
"""
import math
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from ezdxf.math import bulge_to_arc

sys.path.insert(0, str(Path(__file__).parent.parent))

import core.main as main_mod  # noqa: E402
from core.geometry.build_geometry import build_geometry, polyline_sagittas  # noqa: E402
from dxf_utils import read_dxf_file  # noqa: E402
from worker_common.geometry.import_findings import build_findings, empty_stats  # noqa: E402

CORPUS = Path(__file__).parents[2] / "geometry" / "parity" / "corpus_extra"


def _findings(name):
    drawing = read_dxf_file(str(CORPUS / name))
    stats = {**empty_stats(), "skipped": {}}
    build_geometry(drawing, 0.01, stats=stats)
    return {f["code"]: f for f in build_findings(stats)}


def _sagitta(a, b, bulge):
    _centre, _start, _end, radius = bulge_to_arc(a, b, bulge)
    chord = math.dist(a, b)
    return abs(radius) - math.sqrt(radius * radius - (chord / 2) ** 2)


def test_entities_attached_to_no_part_are_counted_by_type():
    f = _findings("uncut_entities.dxf")["import.entitiesUncut"]
    assert f["level"] == "attention"
    assert f["count"] == 4
    assert f["types"] == ["LINE", "LWPOLYLINE", "POINT", "SPLINE"]


def test_lwpolyline_bulges_report_the_largest_sagitta():
    f = _findings("bulge_notable_lwpolyline.dxf")["import.bulgesChorded"]
    assert f["count"] == 2  # 0,08 mm : 2 x 0,08 = 0,16 >= 0,1, il compte aussi
    assert f["value"] == f"{2 * _sagitta((0, 0), (100, 0), 0.006):.2f}" == "0.60"


def test_classic_polyline_bulges_and_the_closing_segment_are_measured():
    f = _findings("bulge_notable_polyline.dxf")["import.bulgesChorded"]
    assert f["count"] == 2
    assert f["value"] == f"{2 * _sagitta((0, 50), (0, 0), -0.02):.2f}" == "1.00"


def test_a_small_sagitta_is_announced_at_twice_its_value():
    # bulge_negligible.dxf : flèche 0,08 mm, 2 x 0,08 = 0,16 mm >= 0,1 mm.
    f = _findings("bulge_negligible.dxf")["import.bulgesChorded"]
    assert f["value"] == "0.16"


def test_every_segment_sagitta_matches_ezdxf():
    drawing = read_dxf_file(str(CORPUS / "bulge_notable_lwpolyline.dxf"))
    (entity,) = list(drawing.modelspace())
    got = polyline_sagittas(entity)
    assert got == pytest.approx([_sagitta((0, 0), (100, 0), 0.006), _sagitta((100, 50), (0, 50), 0.0016)], abs=1e-9)


def test_text_removed_at_reading_reaches_the_findings_of_the_file(monkeypatch):
    # La relecture de la copie canonique ne contient plus les TEXT : le compte voyage
    # avec le document fichier, comme celui de l'espace papier.
    doc = {"_id": 1, "slug": "s3", "ownerId": "u", "isDxfCopyExist": False, "flattening": 0.01}
    data = (CORPUS / "uncut_entities.dxf").read_bytes()
    written = {}
    files = MagicMock()
    monkeypatch.setattr(main_mod, "db", {"user_dxf_files": files})
    monkeypatch.setattr(main_mod, "user_dxf_bucket", object())
    monkeypatch.setattr(main_mod, "valid_dxf_bucket", MagicMock())
    monkeypatch.setattr(main_mod, "get_dek", lambda *a, **k: None)
    monkeypatch.setattr(main_mod, "read_gridfs",
                        lambda bucket, slug, owner, dek: written.get("copy", data))
    monkeypatch.setattr(main_mod, "write_gridfs",
                        lambda bucket, slug, payload, owner, dek: written.__setitem__("copy", payload))
    main_mod._drawing_cache.clear()
    main_mod._make_dxf_copy(doc)
    assert doc["importSkipped"] == {"TEXT": 2, "MTEXT": 1}
    _, parts = main_mod._close_polygon_from_dxf(doc, "test")
    assert len(parts) == 1
    report = [c.args[1]["$set"]["importReport"] for c in files.update_one.call_args_list
              if "importReport" in c.args[1].get("$set", {})][-1]
    by_code = {f["code"]: f for f in report["findings"]}
    assert by_code["import.annotationsSkipped"]["count"] == 3
    assert by_code["import.annotationsSkipped"]["types"] == ["TEXT", "MTEXT"]
    assert by_code["import.entitiesUncut"]["count"] == 4
