"""Lot E2 â€” miroir SERVEUR de l'Â« import avancÃ© Â» du navigateur.

Ce qui est mesurÃ© ici, dans l'ordre de la chaÃ®ne :

1. `scale_drawing` â€” un document canonique mis Ã  l'Ã©chelle (jamais les
   dÃ©finitions de blocs : le document est dÃ©jÃ  dÃ©composÃ©, piÃ¨ge AGENTS #26) ;
2. `resolve_import_scale` â€” la mÃªme arithmÃ©tique que `resolveScale` du
   navigateur (facteur donnÃ©, ou cible en millimÃ¨tres rÃ©solue sur l'Ã©tendue
   MESURÃ‰E du dessin complet), et le fait qu'un facteur dÃ©jÃ  appliquÃ© ne se
   rejoue pas ;
3. `subset_drawing_bytes` â€” un DXF par piÃ¨ce, Ã©crit depuis SES handles, avec
   la sÃ©quence de handles canonique fraÃ®che (piÃ¨ge #33b) ;
4. `_explode_into_parts` â€” les fiches filles : nom Â« nom (k/N).dxf Â», ordre
   d'affichage, provenance, et le marquage du dessin d'origine.

Les nombres attendus sont calculÃ©s Ã  la main dans chaque test â€” aucun
Â« ce que rend le code aujourd'hui Â».
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
    """Deux carrÃ©s DISJOINTS : 40 mm Ã  l'origine, 20 mm Ã  x=200."""
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


# --- 1) mise Ã  l'Ã©chelle du document canonique -----------------------------

def test_scale_drawing_multiplie_l_etendue(tmp_path):
    src = tmp_path / "squares.dxf"
    _two_squares(src)
    drawing, parts = _imported(src)
    # Ã‰tendue du dessin COMPLET : de x=0 Ã  x=220, de y=0 Ã  y=40.
    assert _extent(parts) == pytest.approx((220.0, 40.0), abs=TOL)

    assert scale_drawing(drawing, 2.0) == 0  # aucune entitÃ© refusÃ©e
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


# --- 2) le facteur demandÃ© Ã  la dÃ©pose -------------------------------------

class _FakePart:
    """Le strict nÃ©cessaire de ClosedPolygon pour `_parts_extent`."""

    def __init__(self, bounds):
        self.geometry = type("G", (), {"bounds": bounds})()


PARTS_220x40 = [_FakePart((0, 0, 40, 40)), _FakePart((200, 0, 220, 40))]


def test_resolve_import_scale_facteur_donne():
    assert main_mod.resolve_import_scale({"importScale": 2.5}, PARTS_220x40) == 2.5
    # Absent, nul, nÃ©gatif, illisible : on ne multiplie rien.
    assert main_mod.resolve_import_scale({}, PARTS_220x40) == 1.0
    assert main_mod.resolve_import_scale({"importScale": 0}, PARTS_220x40) == 1.0
    assert main_mod.resolve_import_scale({"importScale": -3}, PARTS_220x40) == 1.0
    assert main_mod.resolve_import_scale({"importScale": "large"}, PARTS_220x40) == 1.0


def test_resolve_import_scale_cible_en_millimetres():
    # Largeur cible 1100 mm sur un dessin large de 220 mm => Ã—5.
    doc = {"importScaleTarget": {"mode": "width", "mm": 1100}}
    assert main_mod.resolve_import_scale(doc, PARTS_220x40) == pytest.approx(5.0)
    # Hauteur cible 10 mm sur un dessin haut de 40 mm => Ã—0,25.
    doc = {"importScaleTarget": {"mode": "height", "mm": 10}}
    assert main_mod.resolve_import_scale(doc, PARTS_220x40) == pytest.approx(0.25)
    # La cible prime sur un facteur donnÃ© (le panneau n'envoie jamais les deux).
    doc = {"importScale": 9, "importScaleTarget": {"mode": "width", "mm": 220}}
    assert main_mod.resolve_import_scale(doc, PARTS_220x40) == pytest.approx(1.0)


def test_resolve_import_scale_cible_absurde_ou_dessin_degenere():
    assert main_mod.resolve_import_scale(
        {"importScaleTarget": {"mode": "width", "mm": 0}}, PARTS_220x40) == 1.0
    assert main_mod.resolve_import_scale(
        {"importScaleTarget": {"mode": "width", "mm": "grand"}}, PARTS_220x40) == 1.0
    # Aucune piÃ¨ce : pas d'Ã©tendue, donc pas de facteur.
    assert main_mod.resolve_import_scale(
        {"importScaleTarget": {"mode": "width", "mm": 100}}, []) == 1.0
    # Dessin plat sur l'axe visÃ© : une division par ~0 ne doit pas sortir.
    flat = [_FakePart((0, 5, 100, 5))]
    assert main_mod.resolve_import_scale(
        {"importScaleTarget": {"mode": "height", "mm": 50}}, flat) == 1.0


def test_resolve_import_scale_ne_rejoue_pas_un_facteur_applique():
    # Reprise du mÃªme fichier par le worker : le dessin est DÃ‰JÃ€ Ã  l'Ã©chelle.
    doc = {"importScale": 5, "importScaleApplied": True}
    assert main_mod.resolve_import_scale(doc, PARTS_220x40) == 1.0
    doc = {"importScaleTarget": {"mode": "width", "mm": 1100},
           "importScaleApplied": True}
    assert main_mod.resolve_import_scale(doc, PARTS_220x40) == 1.0


# --- 3) un DXF par piÃ¨ce, depuis ses handles -------------------------------

def test_subset_par_handles_rend_la_seule_piece_visee(tmp_path):
    src = tmp_path / "squares.dxf"
    _two_squares(src)
    drawing, parts = _imported(src)
    assert len(parts) == 2
    big = max(parts, key=lambda p: p.geometry.area)

    payload = subset_drawing_bytes(drawing, big.handles)
    assert payload, "le sous-ensemble ne doit pas Ãªtre vide"

    out = tmp_path / "part.dxf"
    out.write_bytes(payload)
    sub_drawing, sub_parts = _imported(out)
    assert len(sub_parts) == 1
    assert _extent(sub_parts) == pytest.approx((40.0, 40.0), abs=TOL)
    # MillimÃ¨tres canoniques dÃ©clarÃ©s (piÃ¨ge #27 : ezdxf.new() dit des mÃ¨tres).
    assert ezdxf.readfile(str(out)).header["$INSUNITS"] == 4


def test_subset_renumerote_les_handles_en_sequence_canonique(tmp_path):
    # PiÃ¨ge #33b : les handles canoniques sont la sÃ©quence d'un document ezdxf
    # NEUF (2F, 30, 31â€¦) â€” pas ceux du dessin d'origine. Le navigateur
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
    # Handle inconnu : aucune entitÃ© ne rÃ©pond, donc pas de document.
    assert subset_drawing_bytes(drawing, ["FFFFFF"]) == b""


# --- 4) les fiches filles --------------------------------------------------

def test_noms_des_fiches_eclatees():
    assert main_mod._exploded_names("logo.dxf", 3) == [
        "logo (1/3).dxf", "logo (2/3).dxf", "logo (3/3).dxf"]
    # Extension conservÃ©e quelle qu'elle soit, nom sans point acceptÃ©.
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
    """`_explode_into_parts` sans Mongo ni GridFS : on mesure ce qu'il Ã‰CRIT."""
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
        # Lot E4-c : le parent PAR SLUG (l'UI hÃ©rite la quantitÃ© vers les
        # filles â€” le nom n'est pas unique, le slug l'est).
        assert record["explodedFromSlug"] == "f-abc.dxf"
        # Pas de re-Ã©clatement, pas de re-mise Ã  l'Ã©chelle en cascade.
        assert "explodeRequested" not in record
        assert "importScale" not in record
        assert record["slug"].startswith("f-") and record["slug"].endswith(".dxf")
    # L'ordre d'affichage (la liste trie sur uploadAt) suit l'ordre des piÃ¨ces.
    assert coll.inserted[0]["uploadAt"] < coll.inserted[1]["uploadAt"]
    assert coll.inserted[0]["uploadAt"] > doc["uploadAt"]

    # Les octets dÃ©posÃ©s sont bien un DXF par piÃ¨ce, relisible.
    assert set(written) == set(children)
    for slug, payload in written.items():
        out = tmp_path / f"{slug}"
        out.write_bytes(payload)
        _, sub = _imported(out)
        assert len(sub) == 1

    # Le dessin d'origine est marquÃ© (il quitte la liste du projet).
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
    # Rien Ã©crit, rien insÃ©rÃ© : la fiche unique garde son nom.
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
        # provenance, marquÃ© appliquÃ© â€” sinon le worker le rejouerait.
        assert record["importScale"] == 5.0
        assert record["importScaleApplied"] is True


# --- 5) l'encre qui TOUCHE sans traverser (lot E2) -------------------------

def _square_plus_tangent_line(path):
    """Un carrÃ© fermÃ©, plus un trait qui PART de son bord vers l'extÃ©rieur.

    Son encre ne rencontre le corps qu'en UN POINT (longueur et aire nulles),
    et son centre tombe hors de la silhouette : les deux mesures d'attachement
    rendent 0. C'est le cas qui laissait l'entitÃ© attachÃ©e Ã  rien.
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
    # Couverture COMPLÃˆTE : une entitÃ© attachÃ©e Ã  rien n'est exportÃ©e nulle
    # part (l'export du DXF de coupe copie les entitÃ©s par handle).
    assert attached == handles, f"non attachÃ©(s) : {sorted(handles - attached)}"


def test_une_entite_vraiment_egaree_reste_non_attachee(tmp_path):
    # Le repli est bornÃ© par `probe_tol` : un trait Ã  50 mm de toute piÃ¨ce
    # n'est PAS aspirÃ© dans son voisin (sinon on ajouterait de l'encre
    # Ã©trangÃ¨re au fichier de coupe).
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


# --- 6) l'Ã©chelle APRÃˆS l'import (lot E4-b) ---------------------------------
#
# PATCH /api/files/:slug/scale est MINCE : le worker applique. Ce qui doit
# Ãªtre vrai cÃ´tÃ© worker : la PREMIÃˆRE application garde les octets d'origine
# (`<slug>.orig`, c'est ce que Â« RÃ©initialiser Â» restaure bit-identique), et
# la restauration replace la copie canonique AVANT tout travail de gÃ©omÃ©trie.

class _FakeBucket:
    def __init__(self, files):
        self.files = dict(files)
        self.deleted = []

    def delete_by_name(self, filename):
        self.deleted.append(filename)
        self.files.pop(filename, None)


@pytest.fixture()
def scale_env(monkeypatch):
    """`_rewrite_scaled_copy` / `_restore_original_copy` sans Mongo ni GridFS."""
    coll = _FakeCollection()
    bucket = _FakeBucket({"f-abc.dxf": b"CANONIQUE"})
    monkeypatch.setattr(main_mod, "db", {"user_dxf_files": coll})
    monkeypatch.setattr(main_mod, "valid_dxf_bucket", bucket)
    monkeypatch.setattr(
        main_mod, "read_gridfs",
        lambda b, name, owner, dek=None: bucket.files[name])
    monkeypatch.setattr(
        main_mod, "write_gridfs",
        lambda b, name, data, owner, dek=None: bucket.files.__setitem__(name, data))
    monkeypatch.setattr(main_mod, "get_dek", lambda db, doc: None)
    # On ne mesure pas la gÃ©omÃ©trie ici (couverte en 1)) : seule l'Ã©criture.
    monkeypatch.setattr(main_mod, "scale_drawing", lambda drawing, factor: 0)
    return coll, bucket


class _WritableDrawing:
    """Le strict nÃ©cessaire pour `_rewrite_scaled_copy` : savoir s'Ã©crire."""

    def write(self, stream):
        stream.write("DESSINE")


def test_premiere_application_garde_l_original(scale_env):
    coll, bucket = scale_env
    doc = {"_id": "oid", "slug": "f-abc.dxf", "ownerId": "u"}
    main_mod._rewrite_scaled_copy(doc, _WritableDrawing(), 2.0, main_mod.setup_logger("t"))

    # L'original est gardÃ© AVANT l'Ã©crasement â€” bit-identique Ã  ce qui Ã©tait
    # en base : c'est ce que Â« RÃ©initialiser l'Ã©chelle Â» restaurera.
    assert bucket.files["f-abc.dxf.orig"] == b"CANONIQUE"
    # Le document porte facteur + appliquÃ© (Ã©crits par l'appel).
    sets = coll.updates[-1][1]["$set"]
    assert sets["importScaleApplied"] is True
    assert sets["importScale"] == 2.0


def test_deuxieme_application_ne_regarde_pas_l_original(scale_env):
    _, bucket = scale_env
    # Fiche DÃ‰JÃ€ Ã  l'Ã©chelle : l'original (celui d'avant la premiÃ¨re
    # application) ne doit PAS Ãªtre Ã©crasÃ© par la copie courante.
    bucket.files["f-abc.dxf"] = b"DEJA-ECHELLE"
    bucket.files["f-abc.dxf.orig"] = b"ORIGINAL"
    doc = {"_id": "oid", "slug": "f-abc.dxf", "ownerId": "u",
           "importScale": 2.0, "importScaleApplied": True}
    main_mod._rewrite_scaled_copy(doc, _WritableDrawing(), 0.5, main_mod.setup_logger("t"))
    assert bucket.files["f-abc.dxf.orig"] == b"ORIGINAL"


def test_restore_replace_la_copie_et_retire_le_drapeau(scale_env):
    coll, bucket = scale_env
    bucket.files["f-abc.dxf"] = b"DEJA-ECHELLE"
    bucket.files["f-abc.dxf.orig"] = b"ORIGINAL"
    doc = {"_id": "oid", "slug": "f-abc.dxf", "ownerId": "u",
           "importScaleReset": True}
    main_mod._restore_original_copy(doc, main_mod.setup_logger("t"))

    assert bucket.files["f-abc.dxf"] == b"ORIGINAL"
    # La copie d'origine ne sert plus (la prochaine application en gardera
    # une neuve â€” identique : les octets restaurÃ©s SONT l'original).
    assert "f-abc.dxf.orig" not in bucket.files
    assert "f-abc.dxf.orig" in bucket.deleted
    # Le drapeau est retirÃ© : un crash-reprise ne restaurera pas deux fois.
    assert coll.updates[-1][1]["$unset"] == {"importScaleReset": ""}
    assert "importScaleReset" not in doc
