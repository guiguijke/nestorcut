"""Lot E2 — miroir SERVEUR de l'« import avancé » du navigateur.

Ce qui est mesuré ici, dans l'ordre de la chaîne :

1. `scale_drawing` — un document canonique mis à l'échelle (jamais les
   définitions de blocs : le document est déjà décomposé, piège AGENTS #26) ;
2. `resolve_import_scale` — la même arithmétique que `resolveScale` du
   navigateur (facteur donné, ou cible en millimètres résolue sur l'étendue
   MESURÉE du dessin complet), et le fait qu'un facteur déjà appliqué ne se
   rejoue pas ;
3. `subset_drawing_bytes` — un DXF par pièce, écrit depuis SES handles, avec
   la séquence de handles canonique fraîche (piège #33b) ;
4. `_explode_into_parts` — les fiches filles : nom « nom (k/N).dxf », ordre
   d'affichage, provenance, et le marquage du dessin d'origine.

Les nombres attendus sont calculés à la main dans chaque test — aucun
« ce que rend le code aujourd'hui ».
"""
import sys
from pathlib import Path

import ezdxf
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import core.main as main_mod  # noqa: E402
from core.geometry.build_geometry import build_geometry  # noqa: E402
from dxf_utils import read_dxf_file, scale_drawing, subset_drawing_bytes  # noqa: E402

TOL = 0.01


def _two_squares(path):
    """Deux carrés DISJOINTS : 40 mm à l'origine, 20 mm à x=200."""
    doc = ezdxf.new()
    doc.header["$INSUNITS"] = 4
    msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0), (40, 0), (40, 40), (0, 40)], close=True)
    msp.add_lwpolyline([(200, 0), (220, 0), (220, 20), (200, 20)], close=True)
    doc.saveas(path)


def _extent(parts):
    xs0 = min(p.geometry.bounds[0] for p in parts)
    ys0 = min(p.geometry.bounds[1] for p in parts)
    xs1 = max(p.geometry.bounds[2] for p in parts)
    ys1 = max(p.geometry.bounds[3] for p in parts)
    return (xs1 - xs0, ys1 - ys0)


def _imported(path):
    drawing = read_dxf_file(str(path))
    return drawing, build_geometry(drawing, 0.01)


# --- 1) mise à l'échelle du document canonique -----------------------------

def test_scale_drawing_multiplie_l_etendue(tmp_path):
    src = tmp_path / "squares.dxf"
    _two_squares(src)
    drawing, parts = _imported(src)
    # Étendue du dessin COMPLET : de x=0 à x=220, de y=0 à y=40.
    assert _extent(parts) == pytest.approx((220.0, 40.0), abs=TOL)

    assert scale_drawing(drawing, 2.0) == 0  # aucune entité refusée
    scaled = build_geometry(drawing, 0.01)
    assert _extent(scaled) == pytest.approx((440.0, 80.0), abs=TOL)


def test_scale_drawing_facteur_1_ne_touche_rien(tmp_path):
    src = tmp_path / "squares.dxf"
    _two_squares(src)
    drawing, parts = _imported(src)
    before = _extent(parts)
    assert scale_drawing(drawing, 1.0) == 0
    assert scale_drawing(drawing, 0) == 0
    assert _extent(build_geometry(drawing, 0.01)) == pytest.approx(before, abs=1e-9)


# --- 2) le facteur demandé à la dépose -------------------------------------

class _FakePart:
    """Le strict nécessaire de ClosedPolygon pour `_parts_extent`."""

    def __init__(self, bounds):
        self.geometry = type("G", (), {"bounds": bounds})()


PARTS_220x40 = [_FakePart((0, 0, 40, 40)), _FakePart((200, 0, 220, 40))]


def test_resolve_import_scale_facteur_donne():
    assert main_mod.resolve_import_scale({"importScale": 2.5}, PARTS_220x40) == 2.5
    # Absent, nul, négatif, illisible : on ne multiplie rien.
    assert main_mod.resolve_import_scale({}, PARTS_220x40) == 1.0
    assert main_mod.resolve_import_scale({"importScale": 0}, PARTS_220x40) == 1.0
    assert main_mod.resolve_import_scale({"importScale": -3}, PARTS_220x40) == 1.0
    assert main_mod.resolve_import_scale({"importScale": "large"}, PARTS_220x40) == 1.0


def test_resolve_import_scale_cible_en_millimetres():
    # Largeur cible 1100 mm sur un dessin large de 220 mm => ×5.
    doc = {"importScaleTarget": {"mode": "width", "mm": 1100}}
    assert main_mod.resolve_import_scale(doc, PARTS_220x40) == pytest.approx(5.0)
    # Hauteur cible 10 mm sur un dessin haut de 40 mm => ×0,25.
    doc = {"importScaleTarget": {"mode": "height", "mm": 10}}
    assert main_mod.resolve_import_scale(doc, PARTS_220x40) == pytest.approx(0.25)
    # La cible prime sur un facteur donné (le panneau n'envoie jamais les deux).
    doc = {"importScale": 9, "importScaleTarget": {"mode": "width", "mm": 220}}
    assert main_mod.resolve_import_scale(doc, PARTS_220x40) == pytest.approx(1.0)


def test_resolve_import_scale_cible_absurde_ou_dessin_degenere():
    assert main_mod.resolve_import_scale(
        {"importScaleTarget": {"mode": "width", "mm": 0}}, PARTS_220x40) == 1.0
    assert main_mod.resolve_import_scale(
        {"importScaleTarget": {"mode": "width", "mm": "grand"}}, PARTS_220x40) == 1.0
    # Aucune pièce : pas d'étendue, donc pas de facteur.
    assert main_mod.resolve_import_scale(
        {"importScaleTarget": {"mode": "width", "mm": 100}}, []) == 1.0
    # Dessin plat sur l'axe visé : une division par ~0 ne doit pas sortir.
    flat = [_FakePart((0, 5, 100, 5))]
    assert main_mod.resolve_import_scale(
        {"importScaleTarget": {"mode": "height", "mm": 50}}, flat) == 1.0


def test_resolve_import_scale_ne_rejoue_pas_un_facteur_applique():
    # Reprise du même fichier par le worker : le dessin est DÉJÀ à l'échelle.
    doc = {"importScale": 5, "importScaleApplied": True}
    assert main_mod.resolve_import_scale(doc, PARTS_220x40) == 1.0
    doc = {"importScaleTarget": {"mode": "width", "mm": 1100},
           "importScaleApplied": True}
    assert main_mod.resolve_import_scale(doc, PARTS_220x40) == 1.0


# --- 3) un DXF par pièce, depuis ses handles -------------------------------

def test_subset_par_handles_rend_la_seule_piece_visee(tmp_path):
    src = tmp_path / "squares.dxf"
    _two_squares(src)
    drawing, parts = _imported(src)
    assert len(parts) == 2
    big = max(parts, key=lambda p: p.geometry.area)

    payload = subset_drawing_bytes(drawing, big.handles)
    assert payload, "le sous-ensemble ne doit pas être vide"

    out = tmp_path / "part.dxf"
    out.write_bytes(payload)
    sub_drawing, sub_parts = _imported(out)
    assert len(sub_parts) == 1
    assert _extent(sub_parts) == pytest.approx((40.0, 40.0), abs=TOL)
    # Millimètres canoniques déclarés (piège #27 : ezdxf.new() dit des mètres).
    assert ezdxf.readfile(str(out)).header["$INSUNITS"] == 4


def test_subset_renumerote_les_handles_en_sequence_canonique(tmp_path):
    # Piège #33b : les handles canoniques sont la séquence d'un document ezdxf
    # NEUF (2F, 30, 31…) — pas ceux du dessin d'origine. Le navigateur
    # (assign_canonical_handles) fait exactement cela.
    src = tmp_path / "squares.dxf"
    _two_squares(src)
    drawing, parts = _imported(src)
    second = min(parts, key=lambda p: p.geometry.area)
    assert second.handles and second.handles[0] != "2F"

    out = tmp_path / "part2.dxf"
    out.write_bytes(subset_drawing_bytes(drawing, second.handles))
    _, sub_parts = _imported(out)
    assert sub_parts[0].handles == ["2F"]


def test_subset_sans_handles_ne_rend_rien(tmp_path):
    src = tmp_path / "squares.dxf"
    _two_squares(src)
    drawing, _ = _imported(src)
    assert subset_drawing_bytes(drawing, []) == b""
    assert subset_drawing_bytes(drawing, None) == b""
    # Handle inconnu : aucune entité ne répond, donc pas de document.
    assert subset_drawing_bytes(drawing, ["FFFFFF"]) == b""


# --- 4) les fiches filles --------------------------------------------------

def test_noms_des_fiches_eclatees():
    assert main_mod._exploded_names("logo.dxf", 3) == [
        "logo (1/3).dxf", "logo (2/3).dxf", "logo (3/3).dxf"]
    # Extension conservée quelle qu'elle soit, nom sans point accepté.
    assert main_mod._exploded_names("dessin.svg", 2) == [
        "dessin (1/2).svg", "dessin (2/2).svg"]
    assert main_mod._exploded_names("sans-extension", 1) == ["sans-extension (1/1)"]


class _FakeCollection:
    def __init__(self):
        self.inserted = []
        self.updates = []

    def insert_many(self, records):
        self.inserted.extend(records)

    def update_one(self, query, update):
        self.updates.append((query, update))


@pytest.fixture()
def explode_env(monkeypatch, tmp_path):
    """`_explode_into_parts` sans Mongo ni GridFS : on mesure ce qu'il ÉCRIT."""
    coll = _FakeCollection()
    written = {}
    monkeypatch.setattr(main_mod, "db", {"user_dxf_files": coll})
    monkeypatch.setattr(main_mod, "user_dxf_bucket", object())
    monkeypatch.setattr(main_mod, "get_dek", lambda db, doc: None)
    monkeypatch.setattr(
        main_mod, "write_gridfs",
        lambda bucket, slug, data, owner, dek=None: written.__setitem__(slug, data))
    return coll, written


def test_explode_cree_une_fiche_par_piece(tmp_path, explode_env):
    coll, written = explode_env
    src = tmp_path / "squares.dxf"
    _two_squares(src)
    drawing, parts = _imported(src)

    from datetime import datetime
    doc = {
        "_id": "oid", "slug": "f-abc.dxf", "name": "logo.dxf",
        "ownerId": "user-1", "projectSlug": "proj-1", "worker_tag": "normal",
        "flattening": 0.01, "uploadAt": datetime(2026, 9, 13, 10, 0, 0),
    }
    children = main_mod._explode_into_parts(doc, drawing, parts, main_mod.setup_logger("t"))

    assert len(children) == 2
    assert [r["name"] for r in coll.inserted] == ["logo (1/2).dxf", "logo (2/2).dxf"]
    assert [r["explodedIndex"] for r in coll.inserted] == [1, 2]
    for record in coll.inserted:
        assert record["processingStatus"] == "pending"
        assert record["projectSlug"] == "proj-1"
        assert record["ownerId"] == "user-1"
        assert record["worker_tag"] == "normal"
        assert record["explodedFrom"] == "logo.dxf"
        # Pas de re-éclatement, pas de re-mise à l'échelle en cascade.
        assert "explodeRequested" not in record
        assert "importScale" not in record
        assert record["slug"].startswith("f-") and record["slug"].endswith(".dxf")
    # L'ordre d'affichage (la liste trie sur uploadAt) suit l'ordre des pièces.
    assert coll.inserted[0]["uploadAt"] < coll.inserted[1]["uploadAt"]
    assert coll.inserted[0]["uploadAt"] > doc["uploadAt"]

    # Les octets déposés sont bien un DXF par pièce, relisible.
    assert set(written) == set(children)
    for slug, payload in written.items():
        out = tmp_path / f"{slug}"
        out.write_bytes(payload)
        _, sub = _imported(out)
        assert len(sub) == 1

    # Le dessin d'origine est marqué (il quitte la liste du projet).
    assert coll.updates[-1][1]["$set"]["explodedInto"] == children
    assert coll.updates[-1][1]["$set"]["explodedParts"] == 2


def test_explode_d_une_piece_unique_ne_fait_rien(tmp_path, explode_env):
    coll, written = explode_env
    src = tmp_path / "one.dxf"
    doc_dxf = ezdxf.new()
    doc_dxf.header["$INSUNITS"] = 4
    doc_dxf.modelspace().add_lwpolyline(
        [(0, 0), (10, 0), (10, 10), (0, 10)], close=True)
    doc_dxf.saveas(src)
    drawing, parts = _imported(src)
    assert len(parts) == 1

    doc = {"_id": "oid", "slug": "f-x.dxf", "name": "carre.dxf", "ownerId": "u"}
    assert main_mod._explode_into_parts(doc, drawing, parts, main_mod.setup_logger("t")) == []
    # Rien écrit, rien inséré : la fiche unique garde son nom.
    assert coll.inserted == [] and written == {}


def test_explode_herite_du_facteur_deja_applique(tmp_path, explode_env):
    coll, _ = explode_env
    src = tmp_path / "squares.dxf"
    _two_squares(src)
    drawing, parts = _imported(src)

    doc = {
        "_id": "oid", "slug": "f-abc.dxf", "name": "logo.dxf", "ownerId": "u",
        "projectSlug": "p", "importScale": 5.0, "importScaleApplied": True,
    }
    main_mod._explode_into_parts(doc, drawing, parts, main_mod.setup_logger("t"))
    for record in coll.inserted:
        # Le facteur est DANS les octets : la fille le porte pour la
        # provenance, marqué appliqué — sinon le worker le rejouerait.
        assert record["importScale"] == 5.0
        assert record["importScaleApplied"] is True


# --- 5) l'encre qui TOUCHE sans traverser (lot E2) -------------------------

def _square_plus_tangent_line(path):
    """Un carré fermé, plus un trait qui PART de son bord vers l'extérieur.

    Son encre ne rencontre le corps qu'en UN POINT (longueur et aire nulles),
    et son centre tombe hors de la silhouette : les deux mesures d'attachement
    rendent 0. C'est le cas qui laissait l'entité attachée à rien.
    """
    doc = ezdxf.new()
    doc.header["$INSUNITS"] = 4
    msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0), (100, 0), (100, 100), (0, 100)], close=True)
    msp.add_line((100, 50), (110, 50))
    doc.saveas(path)


def test_l_encre_tangente_est_attachee_au_corps_qu_elle_touche(tmp_path):
    src = tmp_path / "tangent.dxf"
    _square_plus_tangent_line(src)
    drawing, parts = _imported(src)
    assert len(parts) == 1

    handles = {str(e.dxf.handle) for e in drawing.modelspace()}
    attached = set(parts[0].handles)
    # Couverture COMPLÈTE : une entité attachée à rien n'est exportée nulle
    # part (l'export du DXF de coupe copie les entités par handle).
    assert attached == handles, f"non attaché(s) : {sorted(handles - attached)}"


def test_une_entite_vraiment_egaree_reste_non_attachee(tmp_path):
    # Le repli est borné par `probe_tol` : un trait à 50 mm de toute pièce
    # n'est PAS aspiré dans son voisin (sinon on ajouterait de l'encre
    # étrangère au fichier de coupe).
    src = tmp_path / "egare.dxf"
    doc = ezdxf.new()
    doc.header["$INSUNITS"] = 4
    msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0), (100, 0), (100, 100), (0, 100)], close=True)
    msp.add_line((150, 50), (160, 50))
    doc.saveas(src)
    drawing, parts = _imported(src)
    assert len(parts) == 1
    handles = {str(e.dxf.handle) for e in drawing.modelspace()}
    assert set(parts[0].handles) != handles
    assert len(handles - set(parts[0].handles)) == 1
