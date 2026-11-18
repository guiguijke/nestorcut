"""Nettoyage des anneaux a l'emission : meme regle que l'import Rust (assemble.rs).

shapely repete le premier point en fin d'anneau ; reduce_ring et strip_spurs
travaillent sur un anneau OUVERT cyclique. Le serveur les appliquait a l'anneau
FERME : une piece ramenee a deux points distincts passait le seuil de 3 points
(le point de fermeture comptait), un ergot dont la pointe est le premier sommet
n'etait pas retire, et un dernier sommet a moins de 0,01 mm du premier faisait
sortir l'anneau ouvert.
"""
import sys
from pathlib import Path
from unittest.mock import MagicMock

import ezdxf
import pytest
from shapely.geometry import Polygon

sys.path.insert(0, str(Path(__file__).parent.parent))

import core.main as main_mod  # noqa: E402
from core.geometry.build_geometry import ClosedPolygon, build_geometry  # noqa: E402
from dxf_utils import read_dxf_file  # noqa: E402

CORPUS = Path(__file__).parents[2] / "geometry" / "parity" / "corpus_extra"


def _emit(shell, holes=()):
    stats = {}
    out = ClosedPolygon(Polygon(shell, list(holes)), ["H"]).to_mongo_dict(stats=stats)
    return out, stats


def _open_canonical(ring):
    """Anneau ferme -> anneau ouvert canonique, a la rotation pres."""
    pts = [tuple(p) for p in ring]
    assert pts[0] == pts[-1], "anneau emis non ferme"
    pts = pts[:-1]
    return min(tuple(pts[i:] + pts[:i]) for i in range(len(pts)))


# Carre de 10 mm, base (5, 0) : un ergot de largeur nulle part de (5, 0) vers
# la pointe (5, -3). Le retour passe par (5.002, 0.001), a moins de 0,01 mm.
SQUARE_BODY = [(10, 0), (10, 10), (0, 10), (0, 0)]
CLEAN_SQUARE = _open_canonical([(10, 0), (10, 10), (0, 10), (0, 0), (5.002, 0.001), (10, 0)])


def test_a_part_reduced_to_two_distinct_points_is_dropped():
    # Aller a (10, 10), puis un dernier sommet a 0,005 mm du precedent : deux points distincts.
    out, _ = _emit([(0, 0), (10, 10), (10.004, 10.003)])
    assert out is None


def test_the_degenerate_part_of_the_parity_drawing_is_not_emitted():
    # Carre, piece a deux points distincts, carre : avant, 3 pieces dont la
    # piece [P, Q, P] que le moteur refuse (« at least 3 points »).
    parts = build_geometry(read_dxf_file(str(CORPUS / "degenerate_ring_parts.dxf")), 0.01)
    emitted = [p for p in (c.to_mongo_dict() for c in parts) if p is not None]
    assert len(parts) == 3
    assert len(emitted) == 2
    assert all(len({tuple(pt) for pt in p["coordinates"]}) >= 3 for p in emitted)


def test_a_hole_reduced_to_two_points_is_filled_back():
    # Garde-fou : is_micro_void (aire < 1 mm2) attrapait deja ce trou avant le
    # correctif, ce test ne distingue pas l'ancien code du nouveau.
    out, stats = _emit(
        [(0, 0), (20, 0), (20, 20), (0, 20)],
        [[(5, 5), (8, 8), (5.004, 5.003)]],
    )
    assert out is not None and out["holes"] == []
    assert stats["microVoids"] == 1


@pytest.mark.parametrize("start", [0, 1, 2, 3, 4, 5, 6])
def test_a_spur_is_removed_wherever_the_ring_starts(start):
    # La pointe T = (5, -3) est le premier sommet pour start == 5 : l'ancien code
    # ne retirait alors pas l'ergot (la fermeture repetait T).
    ring = [(10, 0), (10, 10), (0, 10), (0, 0), (5.002, 0.001), (5, -3), (5, 0)]
    ring = ring[start:] + ring[:start]
    out, stats = _emit(ring)
    assert out is not None
    assert _open_canonical(out["coordinates"]) == CLEAN_SQUARE
    assert stats["spursRemoved"] == 2


def test_a_spur_tip_at_the_ring_start_is_removed():
    ring = [(5, -3), (5, 0), (10, 0), (10, 10), (0, 10), (0, 0), (5.002, 0.001)]
    out, stats = _emit(ring)
    assert _open_canonical(out["coordinates"]) == CLEAN_SQUARE
    assert stats["spursRemoved"] == 2


def test_a_hole_spur_at_the_ring_start_is_removed():
    # Pointe (8, 10) en premier sommet, base (10, 10), retour (10.002, 10.001).
    hole = [(8, 10), (10, 10), (14, 10), (14, 14), (10, 14), (10.002, 10.001)]
    out, stats = _emit([(0, 0), (30, 0), (30, 30), (0, 30)], [hole])
    assert out is not None and len(out["holes"]) == 1
    assert _open_canonical(out["holes"][0]) == _open_canonical(
        [(14, 10), (14, 14), (10, 14), (10.002, 10.001), (14, 10)]
    )
    assert stats["spursRemoved"] == 2


def test_a_last_vertex_within_a_hundredth_of_the_first_keeps_a_closed_ring():
    # Avant : le point de fermeture etait compare au dernier sommet puis jete,
    # l'anneau sortait OUVERT.
    out, _ = _emit([(0, 0), (10, 0), (10, 10), (0, 10), (0.004, 0.003)])
    ring = out["coordinates"]
    assert ring[0] == ring[-1] == [0.0, 0.0]
    assert len(ring) == 6


def test_an_ordinary_square_is_unchanged():
    out, stats = _emit([(0, 0), (10, 0), (10, 10), (0, 10)], [[(3, 3), (3, 7), (7, 7), (7, 3)]])
    assert out["coordinates"] == [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0], [0.0, 0.0]]
    assert out["holes"] == [[[3.0, 3.0], [3.0, 7.0], [7.0, 7.0], [7.0, 3.0], [3.0, 3.0]]]
    assert out["handles"] == ["H"]
    assert (out["width"], out["height"]) == (10.0, 10.0)
    assert stats == {}


def test_when_every_part_is_dropped_the_file_fails_like_a_drawing_without_parts(monkeypatch, tmp_path):
    strip = ezdxf.new()
    strip.header["$INSUNITS"] = 4
    strip.modelspace().add_lwpolyline([(0, 0), (20, 0), (20, 0.05), (0, 0.05)], close=True)
    path = tmp_path / "only_thin_strip.dxf"
    strip.saveas(path)
    data = path.read_bytes()

    written = {}
    files = MagicMock()
    monkeypatch.setattr(main_mod, "db", {"user_dxf_files": files})
    monkeypatch.setattr(main_mod, "user_dxf_bucket", object())
    monkeypatch.setattr(main_mod, "valid_dxf_bucket", MagicMock())
    monkeypatch.setattr(main_mod, "get_dek", lambda *a, **k: None)
    monkeypatch.setattr(main_mod, "read_gridfs", lambda b, s, o, d: written.get("copy", data))
    monkeypatch.setattr(main_mod, "write_gridfs",
                        lambda b, s, payload, o, d: written.__setitem__("copy", payload))
    doc = {"_id": 1, "slug": "s9", "ownerId": "u", "isDxfCopyExist": False, "flattening": 0.01}
    main_mod._drawing_cache.clear()
    main_mod._make_dxf_copy(doc)
    with pytest.raises(Exception, match="Closed parts is 0"):
        main_mod._close_polygon_from_dxf(doc, "test")
    sets = [c.args[1]["$set"] for c in files.update_one.call_args_list]
    # Le constat est ecrit, aucune geometrie n'est stockee.
    report = [s["importReport"] for s in sets if "importReport" in s][-1]
    assert {f["code"]: f.get("count") for f in report["findings"]}["import.partsDropped"] == 1
    assert not any("polygonParts" in s or "encPolygonParts" in s for s in sets)
    assert {"importErrorCode": "no_closed_part"} in sets


# ---------------------------------------------------------------- regle W
# Un corps dont la largeur MINIMALE (pas seulement la bbox) est sous 0,1 mm
# n'est pas une piece, quel que soit le sommet de depart de l'anneau.
SLIVER = [(40, 30), (50, 40), (40.004, 30.003)]


def _dropped(shell):
    out, stats = _emit(shell)
    return out is None, stats


@pytest.mark.parametrize("start", [0, 1, 2])
def test_the_sliver_is_dropped_for_every_start_vertex(start):
    ring = SLIVER[start:] + SLIVER[:start]
    out, _ = _emit(ring)
    assert out is None


def _diag_triangle(raise_mm):
    n = raise_mm / 2 ** 0.5
    return [(0, 0), (100, 100), (50 - n, 50 + n)]


def test_a_diagonal_triangle_raised_by_005_is_dropped_and_by_02_is_kept():
    assert _emit(_diag_triangle(0.05))[0] is None
    kept, _ = _emit(_diag_triangle(0.2))
    assert kept is not None and kept["width"] == 100.0 and kept["height"] == 100.0


def test_a_thin_body_carrying_a_spur_is_dropped_and_the_spur_counted():
    # 10 x 0,05 portant un ergot de 1 mm : la bbox BRUTE fait 10 x 1,05 (l'ancien
    # code mesurait avant de nettoyer et emettait la lame) ; nettoye, c'est 10 x 0,05.
    ring = [(0, 0), (5, 0), (5, -1), (5.002, 0.001), (10, 0), (10, 0.05), (0, 0.05)]
    out, stats = _emit(ring)
    assert out is None
    assert stats["spursRemoved"] == 2


def test_spurs_are_counted_when_the_body_is_dropped_by_width():
    # Lame diagonale (min width 0,05) avec un ergot de 3 mm sur un sommet :
    # bbox grande, c'est la regle W qui l'ecarte, l'ergot reste compte.
    n = 0.05 / 2 ** 0.5
    ring = [(0, 0), (50, 50), (50, 53), (50.002, 50.001), (100, 100), (50 - n, 50 + n)]
    out, stats = _emit(ring)
    assert out is None
    assert stats["spursRemoved"] == 2


def test_spurs_are_counted_when_the_body_is_dropped_by_bbox():
    ring = [(0, 0), (10, 0), (10, 0.05), (5.002, 0.05), (5, 3), (5, 0.05), (0, 0.05)]
    # ergot (5, 0.05) -> (5, 3) -> (5.002, 0.05) : retire, il reste 10 x 0,05
    out, stats = _emit(ring)
    assert out is None
    assert stats["spursRemoved"] == 2


def test_a_square_with_a_long_spur_emits_the_width_of_the_cleaned_ring():
    ring = [(0, 0), (5, 0), (10, 0), (10, 10), (5.002, 9.999), (5, 40), (5, 10), (0, 10)]
    out, stats = _emit(ring)
    assert out is not None
    assert (out["width"], out["height"]) == (10.0, 10.0)
    assert stats["spursRemoved"] == 2


def test_the_sliver_drawing_emits_two_parts_and_counts_four_dropped_bodies():
    stats = {}
    bodies = build_geometry(read_dxf_file(str(CORPUS / "sliver_rotations.dxf")), 0.01, stats=stats)
    outs = [b.to_mongo_dict(stats=stats) for b in bodies]
    emitted = [p for p in outs if p is not None]
    assert len(bodies) == 6
    assert outs.count(None) == 4
    assert sorted((p["width"], p["height"]) for p in emitted) == [(10.0, 10.0), (20.0, 20.0)]


def _run_file(monkeypatch, data):
    files = MagicMock()
    written = {}
    monkeypatch.setattr(main_mod, "db", {"user_dxf_files": files})
    monkeypatch.setattr(main_mod, "user_dxf_bucket", object())
    monkeypatch.setattr(main_mod, "valid_dxf_bucket", MagicMock())
    monkeypatch.setattr(main_mod, "get_dek", lambda *a, **k: None)
    monkeypatch.setattr(main_mod, "read_gridfs", lambda b, s, o, d: written.get("copy", data))
    monkeypatch.setattr(main_mod, "write_gridfs",
                        lambda b, s, payload, o, d: written.__setitem__("copy", payload))
    doc = {"_id": 1, "slug": "s9", "ownerId": "u", "isDxfCopyExist": False,
           "flattening": 0.01, "name": "drawing.dxf"}
    main_mod._drawing_cache.clear()
    main_mod._make_dxf_copy(doc)
    return doc, files


def test_explode_makes_a_child_only_of_each_emitted_body(monkeypatch):
    data = (CORPUS / "degenerate_ring_parts.dxf").read_bytes()
    doc, files = _run_file(monkeypatch, data)
    drawing, parts = main_mod._close_polygon_from_dxf(doc, "test")
    assert len(parts) == 2
    children = main_mod._explode_into_parts(doc, drawing, parts, MagicMock())
    assert len(children) == 2
    names = [r["name"] for r in files.insert_many.call_args.args[0]]
    assert names == ["drawing (1/2).dxf", "drawing (2/2).dxf"]


def test_the_sliver_drawing_explodes_into_two_children(monkeypatch):
    data = (CORPUS / "sliver_rotations.dxf").read_bytes()
    doc, files = _run_file(monkeypatch, data)
    drawing, parts = main_mod._close_polygon_from_dxf(doc, "test")
    assert len(parts) == 2
    assert len(main_mod._explode_into_parts(doc, drawing, parts, MagicMock())) == 2


def test_no_closed_part_at_all_records_the_error_code(monkeypatch, tmp_path):
    # Un dessin sans contour ferme : la voie « Closed parts is 0 » d'avant l'emission.
    d = ezdxf.new()
    d.header["$INSUNITS"] = 4
    d.modelspace().add_line((0, 0), (20, 0))
    path = tmp_path / "one_line.dxf"
    d.saveas(path)
    doc, files = _run_file(monkeypatch, path.read_bytes())
    with pytest.raises(Exception, match="Closed parts is 0"):
        main_mod._close_polygon_from_dxf(doc, "test")
    sets = [c.args[1]["$set"] for c in files.update_one.call_args_list]
    assert {"importErrorCode": "no_closed_part"} in sets


def test_300_ordinary_polygons_keep_their_coordinates():
    import random
    rng = random.Random(7)
    for _ in range(300):
        k = rng.randint(3, 10)
        import math
        ang = sorted(rng.uniform(0, 2 * math.pi) for _ in range(k))
        r = rng.uniform(5, 80)
        shell = [(round(r * math.cos(a) + 100, 3), round(r * math.sin(a) + 100, 3)) for a in ang]
        poly = Polygon(shell)
        if not poly.is_valid or poly.area < 50:
            continue
        out = ClosedPolygon(poly, ["H"]).to_mongo_dict(stats={})
        # Reference : l'ancien code (anneau ferme shapely, reduce_ring seul, pas d'ergot).
        coords = list(zip(*poly.exterior.coords.xy))[:-1]
        ref = [coords[0]]
        for pt in coords[1:]:
            if abs(pt[0] - ref[-1][0]) > 0.01 or abs(pt[1] - ref[-1][1]) > 0.01:
                ref.append(pt)
        ref = [[x, y] for x, y in ref]
        if abs(ref[0][0] - ref[-1][0]) <= 0.01 and abs(ref[0][1] - ref[-1][1]) <= 0.01:
            continue
        ref.append(list(ref[0]))
        assert out is not None and out["coordinates"] == ref


# ---------------------------------------------------------------- revue B1
# Plaques epaisses dont l'enveloppe garde des sommets colineaires a l'arrondi
# pres : le filtre des calibres les jugeait minces et le fichier n'avait plus de piece.
SQ45 = [(206.6, 143.9), (232.6, 117.9), (294.6, 55.9), (306.6, 43.9), (406.6, 143.9), (306.6, 243.9)]

# Les six fichiers repro/snap0..5.dxf de la revue (plaques a 45 degres, au 1e-4 pres).
SNAP_PLATES = [
    [(37.099, 126.175), (77.7456, 85.5284), (155.957, 7.317), (163.274, 0.0), (220.8186, 57.5447), (232.1625, 68.8885), (313.672, 150.3981), (430.7267, 267.4527), (379.881, 318.2983), (358.1312, 340.0482), (348.2186, 349.9607), (295.6973, 402.482), (288.897, 409.2823), (192.2465, 312.6318), (165.1121, 285.4974), (162.1833, 282.5686), (95.6007, 215.986), (21.4444, 141.8296), (28.9032, 134.3708)],
    [(636.7545, 252.7036), (811.0647, 427.0138), (525.3571, 712.7214), (405.2391, 592.6033), (351.0469, 538.4111), (435.2852, 454.1728), (545.9314, 343.5266), (578.1704, 311.2876), (592.3229, 297.1351)],
    [(26.8858, 332.0944), (35.3553, 340.5639), (-29.684, 405.6033), (-55.0475, 430.9668), (-61.8896, 437.8089), (-133.8239, 509.7432), (-169.1792, 474.3878), (-78.4373, 383.6459), (-67.1401, 372.3487), (-21.9548, 327.1634), (-1.1812, 306.3898), (0.0, 305.2086)],
    [(94.4682, 69.9772), (102.1386, 62.3068), (143.2132, 21.2322), (164.4454, 0.0), (192.7332, 28.2879), (196.0551, 31.6097), (199.8007, 35.3553), (160.6341, 74.522), (101.2828, 133.8733), (54.0919, 181.0642), (47.7358, 174.7081), (43.9051, 170.8775), (37.286, 164.2583), (23.5106, 150.483), (18.7365, 145.7089), (28.113, 136.3324)],
    [(-333.1697, 1621.9671), (-347.3919, 1607.7449), (-124.1752, 1384.5282), (-54.8287, 1315.1817), (-19.1686, 1279.5216), (0.0, 1260.353), (46.3955, 1306.7485), (52.8951, 1313.2481), (70.7107, 1331.0637), (-276.6812, 1678.4556)],
    [(35.3553, 672.9225), (25.0553, 683.2225), (-156.479, 864.7568), (-243.7008, 951.9786), (-246.3091, 949.3703), (-273.4445, 922.2349), (-279.0561, 916.6232), (-266.8441, 904.4112), (-99.2627, 736.8298), (-87.0137, 724.5808), (-25.2822, 662.8493), (0.0, 637.5671), (25.9957, 663.5628), (33.8439, 671.411)],
]


def _dxf_of(tmp_path, *rings):
    d = ezdxf.new()
    d.header["$INSUNITS"] = 4
    for ring in rings:
        d.modelspace().add_lwpolyline(ring, close=True)
    path = tmp_path / "plates.dxf"
    d.saveas(path)
    return str(path)


def _import_file(path):
    stats = {}
    bodies = build_geometry(read_dxf_file(path), 0.01, stats=stats)
    outs = [b.to_mongo_dict(stats=stats) for b in bodies]
    return [o for o in outs if o is not None], outs.count(None)


def test_the_square_turned_by_45_degrees_is_emitted_at_ring_level():
    out, _ = _emit(SQ45)
    assert out is not None
    assert (out["width"], out["height"]) == pytest.approx((200.0, 200.0), abs=1e-6)


def test_the_square_turned_by_45_degrees_is_one_part_at_import_level(tmp_path):
    emitted, dropped = _import_file(_dxf_of(tmp_path, SQ45))
    assert dropped == 0
    assert len(emitted) == 1
    assert (emitted[0]["width"], emitted[0]["height"]) == pytest.approx((200.0, 200.0), abs=1e-6)


@pytest.mark.parametrize("i", range(6))
def test_the_reviewer_plates_are_one_part_each(tmp_path, i):
    emitted, dropped = _import_file(_dxf_of(tmp_path, SNAP_PLATES[i]))
    assert dropped == 0
    assert len(emitted) == 1


def test_the_rotated_plates_drawing_emits_four_parts_and_drops_nothing():
    emitted, dropped = _import_file(str(CORPUS / "rotated_plates.dxf"))
    assert dropped == 0
    assert len(emitted) == 4
    sizes = sorted((p["width"], p["height"]) for p in emitted)
    assert sizes[0] == (20.0, 20.0)
    assert sizes[2] == pytest.approx((200.0, 200.0), abs=1e-6)
