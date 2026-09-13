"""J-085 — post-pass hole-fill : complète un trou en pinwheel (4 fillers),
déterministe et validé (dans le trou, spacing, placed inchangé).

Run: PYTHONPATH=workers/common python -m pytest workers/nesting/tests/test_holefill.py -q
"""
import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "common"))

from core.holefill import apply_hole_fill


def _circle(cx, cy, r, n=64):
    pts = [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
    pts.append(pts[0])
    return pts


def _sector():
    # quartier de disque r=28 rétréci (arc 5°..85°) pour que 4 secteurs en
    # pinwheel laissent un espacement (~4mm) entre eux ; le disque r=28 tient
    # dans le trou r=35 avec marge >= 2mm.
    a0, a1 = math.radians(5), math.radians(85)
    pts = [(2.83, 2.83)]
    for i in range(9):
        a = a0 + (a1 - a0) * (i / 8.0)
        pts.append((28.0 * math.cos(a), 28.0 * math.sin(a)))
    pts.append((2.83, 2.83))
    return pts


# Géométrie auto-portée (pas de fixture externe) : hôte 100x100 + trou Ø70,
# filler secteur r=28 => capacité pinwheel 4 par trou.
HOST = {"id": 0, "coords": [(-50, -50), (-50, 50), (50, 50), (50, -50), (-50, -50)],
        "holes": [_circle(0, 0, 35.0)], "count": 1}
FILL = {"id": 1, "coords": _sector(), "holes": [], "count": 4}


def _t(item_id, rot, x, y):
    return {"item_id": item_id, "transformation": {"rotation": rot, "translation": [x, y]}}


def test_repack_fills_empty_hole_with_pinwheel():
    from shapely.geometry import Polygon
    from shapely.affinity import rotate, translate
    # hôte à l'origine, 4 fillers libres empilés loin au-dessus.
    layouts = [{"placed_items": [
        _t(0, 0, 0, 0),
        _t(1, 0, 0, 500), _t(1, 0, 50, 500), _t(1, 90, 100, 500), _t(1, 180, 150, 500),
    ]}]
    rec = apply_hole_fill([HOST, FILL], layouts, 2.0)
    assert rec == 4
    rots = sorted(pi["transformation"]["rotation"] for pi in layouts[0]["placed_items"][1:])
    assert rots == [0.0, 90.0, 180.0, 270.0]
    # les 4 fillers sont nichés : centre dans le trou (repère monde = hôte à l'origine).
    hole = Polygon(HOST["holes"][0])
    for pi in layouts[0]["placed_items"][1:]:
        tr = pi["transformation"]
        poly = translate(rotate(Polygon(FILL["coords"]), tr["rotation"], origin=(0, 0)),
                         tr["translation"][0], tr["translation"][1])
        assert hole.contains(poly.centroid)


def test_repack_skips_full_hole():
    # 4 fillers déjà nichés en pinwheel => rien à faire.
    layouts = [{"placed_items": [
        _t(0, 0, 0, 0),
        _t(1, 0, 0, 0), _t(1, 90, 0, 0), _t(1, 180, 0, 0), _t(1, 270, 0, 0),
    ]}]
    rec = apply_hole_fill([HOST, FILL], layouts, 2.0)
    assert rec == 0


def test_repack_never_duplicates_full_holes_with_surplus_fillers():
    """Cas trou600 : 2 hôtes × capacité 4, 10 fillers — 8 pré-nichés sur les
    poses pinwheel canoniques + 2 libres en bande. Le post-pass ne doit RIEN
    déplacer : 0 relocation, aucun jumeau, les 2 libres restent en bande."""
    items = [dict(HOST, count=2), dict(FILL, count=10)]
    placed_items = [
        _t(0, 0, 0, 0), _t(0, 0, 500, 0),
        _t(1, 0, 0, 0), _t(1, 90, 0, 0), _t(1, 180, 0, 0), _t(1, 270, 0, 0),
        _t(1, 0, 500, 0), _t(1, 90, 500, 0), _t(1, 180, 500, 0), _t(1, 270, 500, 0),
        _t(1, 0, 0, 800), _t(1, 90, 60, 800),
    ]
    layouts = [{"placed_items": placed_items}]
    before = [(pi["transformation"]["rotation"], *pi["transformation"]["translation"])
              for pi in placed_items]
    rec = apply_hole_fill(items, layouts, 2.0)
    assert rec == 0
    after = [(pi["transformation"]["rotation"], *pi["transformation"]["translation"])
             for pi in placed_items]
    assert after == before


def test_repack_completes_partial_hole_without_duplicates():
    """2 poses canoniques prises (0/180) + 4 fillers libres : le post-pass
    complète les 2 poses restantes (90/270) sans dupliquer les occupées."""
    from shapely.geometry import Polygon
    from shapely.affinity import rotate, translate
    items = [dict(HOST, count=1), dict(FILL, count=6)]
    placed_items = [
        _t(0, 0, 0, 0),
        _t(1, 0, 0, 0), _t(1, 180, 0, 0),
        _t(1, 0, 0, 800), _t(1, 90, 60, 800), _t(1, 180, 120, 800), _t(1, 270, 180, 800),
    ]
    layouts = [{"placed_items": placed_items}]
    rec = apply_hole_fill(items, layouts, 2.0)
    assert rec == 2
    hole = Polygon(HOST["holes"][0])
    cents, rots_in_hole = [], []
    for pi in placed_items[1:]:
        tr = pi["transformation"]
        poly = translate(rotate(Polygon(FILL["coords"]), tr["rotation"], origin=(0, 0)),
                         tr["translation"][0], tr["translation"][1])
        if hole.contains(poly.centroid):
            cents.append((round(poly.centroid.x, 3), round(poly.centroid.y, 3)))
            rots_in_hole.append(tr["rotation"] % 360)
    assert len(cents) == 4
    assert len(set(cents)) == 4  # aucun jumeau
    assert sorted(rots_in_hole) == [0, 90, 180, 270]


def test_meta_expand_attaches_fillers_to_hosts():
    from core.holefill import meta_slots, expand_meta
    from shapely.geometry import Polygon
    from shapely.affinity import rotate, translate
    items = [dict(HOST, count=2), dict(FILL, count=8)]
    slots, remaining = meta_slots(items, 0, 1)
    assert remaining == 0 and sorted(slots) == [4, 4]
    # deux hôtes posés (dont un tourné 90°) ; l'expansion doit entraîner les
    # fillers avec la rotation de l'hôte et les nicher dans le trou.
    layouts = [{"placed_items": [_t(0, 0, 0, 0), _t(0, 90, 500, 0)]}]
    expanded = expand_meta(items, 0, 1, slots, layouts)
    assert len(expanded[0]["placed_items"]) == 2 + 8
    # rotations = pinwheel + rotation de l'hôte (0 et 90)
    rots = sorted(pi["transformation"]["rotation"] % 360 for pi in expanded[0]["placed_items"][2:])
    assert rots == sorted([0, 90, 180, 270] + [90, 180, 270, 0])


def test_pinwheel_capacity_fixture_sector_full():
    from core.holefill import pinwheel_capacity
    # secteur 5°..85° r=28 dans trou Ø70 à space 2 : les 4 rotations valident.
    assert pinwheel_capacity(HOST["holes"][0], FILL["coords"], 2.0) == [0.0, 90.0, 180.0, 270.0]


def test_pinwheel_capacity_rejects_oversized_filler():
    from core.holefill import pinwheel_capacity
    big = [(-40, -40), (40, -40), (40, 40), (-40, 40), (-40, -40)]
    assert pinwheel_capacity(HOST["holes"][0], big, 2.0) == []


def test_pinwheel_capacity_partial_when_siblings_overlap():
    from core.holefill import pinwheel_capacity
    # rectangle 60×10 : chaque rotation tient seule dans le trou, mais deux
    # copies pivotées se chevauchent au centre → une seule retenue.
    rect = [(-30, -5), (30, -5), (30, 5), (-30, 5), (-30, -5)]
    assert pinwheel_capacity(HOST["holes"][0], rect, 2.0) == [0.0]


def test_pinwheel_capacity_respects_allowed_orientations():
    from core.holefill import pinwheel_capacity
    rots = pinwheel_capacity(HOST["holes"][0], FILL["coords"], 2.0, allowed={0.0, 180.0})
    assert rots == [0.0, 180.0]


def test_meta_expand_uses_validated_rotations_only():
    from core.holefill import expand_meta
    layouts = [{"placed_items": [_t(0, 0, 0, 0)]}]
    expanded = expand_meta([HOST, FILL], 0, 1, [2], layouts, [[0.0, 180.0]])
    rots = sorted(pi["transformation"]["rotation"] for pi in expanded[0]["placed_items"][1:])
    assert rots == [0.0, 180.0]


def test_pack_hole_real_dxf_fillx4_trou_at_2mm():
    """Cas fondateur : fixtures Piece_Trou + Piece_Fillx4, 4 fillers, 2 mm."""
    from pathlib import Path
    import sys
    fp = Path(__file__).resolve().parents[2] / "fileprocessing"
    sys.path.insert(0, str(fp))
    try:
        import ezdxf
        from core.geometry.build_geometry import build_geometry
    except Exception as exc:
        import pytest
        pytest.skip(f"import pipeline unavailable: {exc}")
    from core.holefill import plan_hole_fills
    fixtures = fp / "tests" / "fixtures"
    if not (fixtures / "Piece_Trou.DXF").exists():
        import pytest
        pytest.skip("DXF fixtures missing")

    def load(name, count):
        doc = ezdxf.readfile(str(fixtures / name))
        parts = [p.to_mongo_dict() for p in build_geometry(doc, 0.01) if p.to_mongo_dict()]
        assert len(parts) == 1
        part = parts[0]
        return {
            "id": 0 if "Trou" in name else 1,
            "coords": part["coordinates"],
            "holes": part.get("holes") or [],
            "count": count,
            "rotations": [0, 90, 180, 270],
        }

    host = load("Piece_Trou.DXF", 1)
    fill = load("Piece_Fillx4.DXF", 4)
    packs = plan_hole_fills([host, fill], 2.0)
    assert packs, "pre-pass must engage on the founding DXFs"
    assert sum(len(p["fills"]) for p in packs) == 4


def test_pack_hole_four_sectors_at_2mm():
    from core.holefill import pack_hole
    area = 28.0 * 28.0 * math.pi / 4
    poses = pack_hole(
        HOST["holes"][0],
        [{"id": 1, "coords": FILL["coords"], "rotations": [0, 90, 180, 270], "remaining": 4, "area": area}],
        2.0,
    )
    assert len(poses) == 4


def test_plan_hole_fills_founding_case_and_legacy_fallback():
    from core.holefill import plan_hole_fills, reduce_for_solve
    items = [dict(HOST, count=1), dict(FILL, count=4, rotations=[0, 90, 180, 270])]
    packs = plan_hole_fills(items, 2.0)
    assert packs and len(packs[0]["fills"]) == 4
    jaguar = [
        {"id": 0, "demand": 1, "shape": {"type": "simple_polygon", "data": HOST["coords"]}},
        {"id": 1, "demand": 4, "shape": {"type": "simple_polygon", "data": FILL["coords"]}},
    ]
    meta, reduced = reduce_for_solve(items, jaguar, packs, 2.0)
    assert meta["host"] == 0 and meta["fill"] == 1
    assert meta["slots"] == [4]
    # filler entièrement consommé
    assert all(r["id"] != 1 for r in reduced)


def test_plan_hole_fills_mixed_types_maximises_area():
    from core.holefill import plan_hole_fills
    small = {"id": 2, "coords": [[0, 0], [6, 0], [6, 6], [0, 6], [0, 0]], "holes": [], "count": 2, "rotations": [0, 90]}
    items = [dict(HOST, count=1), dict(FILL, count=1, rotations=[0, 90, 180, 270]), small]
    packs = plan_hole_fills(items, 2.0)
    assert packs
    fill_ids = {f["fillId"] for f in packs[0]["fills"]}
    # au moins un filler placé (secteur et/ou petits carrés)
    assert fill_ids


def test_decorate_live_items_expands_meta_without_mutating_source():
    from core.holefill import decorate_live_items
    src = [[0, 0.0, 0.0, 0.0]]
    out, stats = decorate_live_items(
        src,
        [HOST, FILL],
        2.0,
        meta={"host": 0, "fill": 1, "slots": [2], "ringRotations": [[0.0, 180.0]]},
        apply_fill=False,
        sheets=[[200.0, 200.0]],
    )
    assert len(out) == 3
    assert stats["holesFilled"] == 2
    assert stats["density"] is not None and stats["density"] > 0
    assert src == [[0, 0.0, 0.0, 0.0]]


# --- J4-bis : la forme compressée ne doit jamais avaler une pièce ---------
#
# `reduce_for_solve` RETIRE de l'instance moteur la demande des fillers du
# plan, en pariant que l'expansion les rattachera. La forme compressée
# `{host, fill, slots, ringRotations}` ne sait décrire qu'un moulinet CENTRÉ
# sur le centroïde du trou : dès que le plan s'en écarte, l'expansion ne
# rattache rien et les pièces ne sont NULLE PART (ETUDE-JOB-SHEETCAM §9.25 —
# mesuré côté navigateur : 1 hôte + 1 éventail ⇒ 1 posée sur 2).

# Trou en L : carré 60×60 amputé de son quadrant haut-droit. Son centroïde
# (0, 0) est le coin rentrant — un filler centré là déborde dans la matière.
L_HOLE = [(-30, -30), (30, -30), (30, 0), (0, 0), (0, 30), (-30, 30), (-30, -30)]
L_HOST = {"id": 0, "coords": [(-50, -50), (50, -50), (50, 50), (-50, 50), (-50, -50)],
          "holes": [L_HOLE], "count": 1, "rotations": [0, 90, 180, 270]}
# Carré 16×16 : tient dans un bras du L, jamais au centroïde.
L_FILL = {"id": 1, "coords": [(-8, -8), (8, -8), (8, 8), (-8, 8), (-8, -8)],
          "holes": [], "count": 1, "rotations": [0, 90, 180, 270]}


def _jaguar(items):
    return [{"id": i["id"], "demand": i["count"],
             "shape": {"type": "simple_polygon", "data": i["coords"]}}
            for i in items]


def _expand(items, meta, layouts):
    from core.holefill import expand_meta, expand_packs
    if meta.get("packs"):
        return expand_packs(items, meta["packs"], layouts)
    return expand_meta(items, meta["host"], meta["fill"], meta["slots"],
                       layouts, meta.get("ringRotations"))


def test_reduce_for_solve_loses_no_part_on_a_non_symmetric_hole():
    """LE cas latent : un hôte à trou en L + UN seul fichier de remplissage.

    Mesuré ici : `pinwheel_capacity` rend [] au centroïde (le coin rentrant
    du L), le planificateur trouve quand même une pose dans un bras, et la
    demande du filler est retirée de l'instance. Le verrou compte les pièces
    RATTACHÉES par l'expansion contre les pièces RETIRÉES : sans le critère
    « la forme compressée porte-t-elle le plan ? », l'expansion en rattache 0
    et le job se termine « réussi » à une pièce de moins."""
    from core.holefill import plan_hole_fills, pinwheel_capacity, reduce_for_solve
    items = [L_HOST, L_FILL]
    space = 2.0
    # Le moulinet centré est impossible sur ce trou : capacité 0.
    assert pinwheel_capacity(L_HOLE, L_FILL["coords"], space,
                             allowed={0, 90, 180, 270}) == []
    packs = plan_hole_fills(items, space)
    assert packs and sum(len(p["fills"]) for p in packs) == 1
    pose = packs[0]["fills"][0]
    # La pose est HORS centroïde (c'est tout le sujet) — sinon le cas ne
    # mesurerait rien.
    assert (abs(pose["lx"]) > 1e-6 or abs(pose["ly"]) > 1e-6)

    jaguar = _jaguar(items)
    meta, reduced = reduce_for_solve(items, jaguar, packs, space)
    removed = sum(i["count"] for i in items) - sum(r["demand"] for r in reduced)
    assert removed == 1, "la demande du filler a bien été retirée de l'instance"

    # Un hôte posé (translaté ET tourné : l'expansion doit entraîner ses
    # fillers), ids déjà re-mappés vers les ids d'origine comme en prod.
    layouts = [{"placed_items": [_t(0, 90.0, 700.0, 400.0)]}]
    expanded = _expand(items, meta, layouts)
    attached = sum(1 for l in expanded for pi in l["placed_items"]
                   if pi["item_id"] == 1)
    assert attached == removed, (
        f"perte de pièce : {removed} retirée(s) de l'instance, "
        f"{attached} rattachée(s) par l'expansion")
    # Piège #3b : l'instance réduite garde des ids consécutifs et idMap
    # re-mappe vers les ids d'origine.
    assert [r["id"] for r in reduced] == list(range(len(reduced)))
    assert meta["idMap"] == [0]


def test_reduce_for_solve_keeps_the_compressed_form_on_a_centred_pinwheel():
    """Contrôle négatif : trou circulaire + moulinet centré 4/4 — la forme
    compressée DOIT rester choisie et la sortie être inchangée.

    Sans ce verrou, un critère trop strict basculerait tout le monde sur la
    forme `{packs}` (plus lourde, et qui débranche le plan de trous du pass
    structurel, main.py §grille) sans que personne ne le voie. On compare
    donc la valeur EXACTE du meta et les poses produites."""
    from core.holefill import plan_hole_fills, reduce_for_solve
    items = [dict(HOST, count=1), dict(FILL, count=4, rotations=[0, 90, 180, 270])]
    packs = plan_hole_fills(items, 2.0)
    meta, reduced = reduce_for_solve(items, _jaguar(items), packs, 2.0)
    assert "packs" not in meta
    assert meta["host"] == 0 and meta["fill"] == 1
    assert meta["slots"] == [4]
    assert meta["ringRotations"] == [[0.0, 90.0, 180.0, 270.0]]
    assert meta["idMap"] == [0]
    # Poses : les 4 fillers au centre du trou (hôte à l'origine), rotations
    # pinwheel — exactement la sortie d'avant le correctif. Le centre est
    # celui de `_centroid` (moyenne des SOMMETS de l'anneau 64-gone fermé,
    # d'où le 0,538 et non 0 : c'est la valeur historique, pas une dérive).
    layouts = [{"placed_items": [_t(0, 0.0, 0.0, 0.0)]}]
    expanded = _expand(items, meta, layouts)
    poses = [(pi["item_id"], pi["transformation"]["rotation"])
             for pi in expanded[0]["placed_items"]]
    assert poses == [(0, 0.0), (1, 0.0), (1, 90.0), (1, 180.0), (1, 270.0)]
    for pi in expanded[0]["placed_items"][1:]:
        tx, ty = pi["transformation"]["translation"]
        assert tx == pytest.approx(0.5384615384615368, abs=1e-12)
        assert ty == pytest.approx(0.0, abs=1e-12)


def test_expected_expansion_counts_only_the_hosts_actually_placed():
    """La garde anti-perte compare le rattaché à l'ATTENDU, et l'attendu ne
    compte que les hôtes réellement posés : une solution moteur partielle
    (un hôte non placé, stock serré) n'est pas une perte de pièce."""
    from core.holefill import expected_expansion
    meta = {"host": 0, "fill": 1, "slots": [4, 4],
            "ringRotations": [[0.0, 90.0, 180.0, 270.0]], "idMap": [0, 1]}
    two_hosts = [{"placed_items": [_t(0, 0, 0, 0), _t(0, 0, 500, 0)]}]
    one_host = [{"placed_items": [_t(0, 0, 0, 0)]}]
    assert expected_expansion(meta, two_hosts) == 8
    assert expected_expansion(meta, one_host) == 4
    # Forme {packs} : même règle, pack par pack, dans l'ordre de conso.
    packs_meta = {"packs": [{"hostId": 0, "fills": [{"fillId": 1, "rot": 0.0,
                                                     "lx": 1.0, "ly": 2.0}]},
                            {"hostId": 0, "fills": []}], "idMap": [0, 1]}
    assert expected_expansion(packs_meta, two_hosts) == 1
    assert expected_expansion(packs_meta, one_host) == 1
    assert expected_expansion(packs_meta, [{"placed_items": []}]) == 0


# --- J4-bis : la garde anti-perte à la finalisation ------------------------

class _FakeCollection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])
        self.sets = []
        self.unsets = []

    def update_one(self, filter, update, *a, **kw):
        doc = next((d for d in self.docs
                    if d.get("_id") == filter.get("_id")
                    or d.get("slug") == filter.get("slug")),
                   self.docs[0] if self.docs else None)
        if doc is None:
            return
        for k, v in update.get("$set", {}).items():
            parts = k.split(".")
            t = doc
            for p in parts[:-1]:
                t = t.setdefault(p, {})
            t[parts[-1]] = v
        for k in update.get("$unset", {}).keys():
            self.unsets.append(k)
            doc.pop(k, None)
        self.sets.append(update.get("$set", {}))

    def find_one(self, filter, *a, **kw):
        return next((d for d in self.docs if d.get("_id") == filter.get("_id")), None)


class _FakeDb(dict):
    def __getitem__(self, name):
        if name not in self:
            self[name] = _FakeCollection()
        return dict.__getitem__(self, name)


def _sq(cx, cy, s):
    return [[cx - s, cy - s], [cx + s, cy - s], [cx + s, cy + s],
            [cx - s, cy + s], [cx - s, cy - s]]


def test_expansion_loss_fails_the_job_instead_of_delivering_n_minus_k(monkeypatch):
    """Garde anti-perte : si l'expansion ne rattache PAS tout ce que le
    pre-pass a retiré de l'instance, le job doit finir en ERREUR avec un
    message distinct — jamais « terminé » à N − k.

    Cas construit : `reduce_for_solve` est forcé à rendre la forme compressée
    d'AVANT le correctif (ringRotations vides) — c'est-à-dire une régression
    du critère `_meta_carries_plan`. Le filler a été retiré de l'instance
    (le moteur ne voit que l'hôte), l'expansion n'en rattache aucun : sans la
    garde, le job livrerait une tôle avec 1 pièce sur 2, badge vert."""
    import types
    # worker_common.mongo se connecte à l'import — stub avant core.main.
    sys.modules.setdefault(
        "worker_common.mongo",
        types.SimpleNamespace(db=None, get_bucket=lambda name: None),
    )
    # `core` est un package NAMESPACE : son __path__ se recalcule sur
    # sys.path, et `test_pack_hole_real_dxf_fillx4_trou_at_2mm` met
    # workers/fileprocessing en tête — `core.main` y serait résolu sur un
    # homonyme (constaté : « module core.main … fileprocessing … has no
    # attribute convert_files_to_input_items »). On remet workers/nesting
    # devant et on jette un core.main venu d'ailleurs.
    nesting_root = str(Path(__file__).parent.parent)
    sys.path.insert(0, nesting_root)
    stale = sys.modules.get("core.main")
    if stale is not None and not str(getattr(stale, "__file__", "")).startswith(nesting_root):
        del sys.modules["core.main"]
    import core.main as m
    import core.holefill as hf
    assert str(m.__file__).startswith(nesting_root)

    monkeypatch.setenv("NEST_REVEAL_STEP_SEC", "0")
    doc = {
        "_id": "job-j4bis", "slug": "j4bis-1", "projectSlug": "p1",
        "ownerId": "u1", "status": "processing",
        "files": [{"slug": "fill", "count": 1, "rotations": [0., 90., 180., 270.]},
                  {"slug": "host", "count": 1, "rotations": [0., 90., 180., 270.]}],
        "params": {"sheets": [{"width": 1500.0, "height": 1000.0, "count": 1}],
                   "space": 2.0, "fillHoles": True, "timeBudgetSec": 3,
                   "alternativesCount": 1, "directions": ["left"], "vcores": 1},
    }
    jobs = _FakeCollection([doc])
    monkeypatch.setattr(m, "db", _FakeDb(nesting_jobs=jobs))
    monkeypatch.setattr(m, "get_dek", lambda db, owner: None)
    monkeypatch.setattr(
        m, "convert_files_to_input_items",
        lambda files, dek: [
            {"id": 0, "file_slug": "fill", "coords": _sq(6.5, 6.5, 5), "holes": [],
             "handles": [], "color": None, "count": 1,
             "rotations": [0., 90., 180., 270.]},
            {"id": 1, "file_slug": "host", "coords": _sq(0, 0, 50),
             "holes": [[list(p) for p in _circle(0, 0, 35.0, n=32)]],
             "handles": [], "color": None, "count": 1,
             "rotations": [0., 90., 180., 270.]},
        ],
    )

    real_reduce = hf.reduce_for_solve

    def lossy_reduce(input_items, jaguar_items, packs, space=0):
        meta, reduced = real_reduce(input_items, jaguar_items, packs, space)
        # Le cas nominal DOIT être la forme compressée — sinon le test ne
        # mesure pas ce qu'il croit mesurer.
        assert "packs" not in meta
        return dict(meta, ringRotations=[[] for _ in meta["ringRotations"]]), reduced

    monkeypatch.setattr(hf, "reduce_for_solve", lossy_reduce)

    seen = {}

    def fake_run_engine(instance, config, problem_type, on_event=None,
                        should_cancel=None, **kw):
        seen["items"] = [(i["id"], i["demand"]) for i in instance["items"]]
        return [{
            "rank": 0, "seed": 1, "bias": "left", "iterations": 1,
            "evaluations": 1, "used_height": 100.0, "finish": None,
            "solution": {"layouts": [{"container_id": 0, "placed_items": [
                {"item_id": 0,
                 "transformation": {"rotation": 0.0, "translation": [100.0, 100.0]}},
            ]}], "density": 0.1, "cost": 1, "strip_width": 200.0},
            "metrics": {"density": 0.1, "cost": 1, "strip_width": 200.0,
                        "layout_count": 1},
        }]

    monkeypatch.setattr(m, "run_engine", fake_run_engine)

    with pytest.raises(Exception) as exc:
        m.nesting_process(jobs.docs[0])

    # Le filler avait bien été retiré de l'instance : le moteur ne voit que
    # l'hôte (réindexé 0, piège #3b).
    assert seen["items"] == [(0, 1)]
    assert "lost parts" in str(exc.value)
    assert doc["status"] == "error"
    assert doc["placed"] == 0
    # Message DISTINCT des deux autres causes d'échec (« pas tout placé »,
    # « chevauchements mesurés ») : une perte de pièce se nomme.
    assert doc["information"].startswith("Hole-fill expansion lost parts")
