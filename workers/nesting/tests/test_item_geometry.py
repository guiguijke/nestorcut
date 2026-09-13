"""Lot E0 : l'echec d'import moteur d'UN item devient un message qui nomme
le fichier et la piece (miroir serveur du verrou vitest
app/tests/localGeomError.test.js).

Ce qui est mesure ici : la lecture de l'identifiant dans le message moteur,
le rang 1-based, le repli sans nom de fichier, et le fait qu'un echec moteur
ORDINAIRE n'est PAS transforme en message de geometrie.
"""
import pytest

from core.engine import EngineError, item_geometry_message, parse_item_geometry

# Message reellement rendu par le moteur (nest-engine/src/import_error.rs),
# mesure sur une instance a trois items dont le second est degenere.
ENGINE_DETAIL = (
    "item_geometry:7: Simple polygon contains intersecting edges 191 and 195: "
    "[Point(0.0, 0.0), Point(1.0, 0.0)]"
)


def test_lit_l_identifiant_d_item():
    assert parse_item_geometry(ENGINE_DETAIL) == 7
    assert parse_item_geometry("item_geometry:0: no area") == 0


@pytest.mark.parametrize("detail", [
    "",
    None,
    "engine failed (rc=101, reason=unknown): thread panicked",
    "no feasible solution: narrowest strip 3200.0 exceeds limit 3000.0",
    # Parle de geometrie sans porter l'identifiant : pas de faux « piece 1 ».
    "importing SPP instance into jagua-rs: Simple polygon contains intersecting edges",
])
def test_les_autres_echecs_gardent_leur_message(detail):
    assert parse_item_geometry(detail) is None


def test_nomme_le_fichier_et_le_rang_1_based():
    info, field = item_geometry_message(
        7, {"slug": "ecrin-volute", "part": 11}, "ecrin.dxf")
    assert '"ecrin.dxf"' in info
    assert "part 12" in info  # index 11 => douzieme piece
    assert "set its quantity to 0" in info
    assert field == {"item": 7, "slug": "ecrin-volute", "part": 11}


def test_repli_sans_nom_de_fichier():
    # Un projet 100 % client n'a pas de nom cote serveur : le message reste
    # exploitable (le rang de la piece suffit a la retrouver).
    info, field = item_geometry_message(3, {"slug": "opaque-slug", "part": 0})
    assert "one of the files" in info
    assert "part 1" in info
    assert field["slug"] == "opaque-slug"


def test_repli_sans_cible_du_tout():
    # Id absent de l'itemMap (instance reduite, piege #3b) : on ne fabrique
    # pas un numero de fichier, on garde le rang par defaut.
    info, field = item_geometry_message(9, None)
    assert "part 1" in info
    assert field == {"item": 9, "slug": None, "part": 0}


def test_engine_error_porte_le_genre_et_l_item():
    err = EngineError("item_geometry:7: boom", kind="item_geometry", item=7)
    assert err.kind == "item_geometry"
    assert err.item == 7
    # Les echecs ordinaires n'ont ni genre ni item (compatibilite).
    plain = EngineError("engine failed (rc=1)")
    assert plain.kind is None and plain.item is None


# --- Lot E2 : constat « pieces plus fines que l'espacement » ---------------

def test_thin_parts_nomme_fichier_et_rang():
    from core.engine import thin_parts
    item_map = {
        0: {"slug": "plaque", "part": 0},
        1: {"slug": "ecrin", "part": 0},
        2: {"slug": "ecrin", "part": 1},
    }
    out = thin_parts([2, 1], item_map, {"ecrin": "ecrin.dxf"})
    assert out == [
        {"item": 1, "slug": "ecrin", "part": 0, "name": "ecrin.dxf"},
        {"item": 2, "slug": "ecrin", "part": 1, "name": "ecrin.dxf"},
    ]


def test_thin_parts_sans_itemmap_n_invente_rien():
    from core.engine import thin_parts
    assert thin_parts([7], {}) == [{"item": 7, "slug": None, "part": 0}]
    assert thin_parts([], {}) == []
    assert thin_parts(None, None) == []


def test_thin_parts_ignore_les_entrees_absurdes_et_borne_la_liste():
    from core.engine import MAX_THIN_PARTS, thin_parts
    assert thin_parts(["x", None], {}) == []
    assert len(thin_parts(list(range(200)), {})) == MAX_THIN_PARTS
