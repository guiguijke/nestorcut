"""Verrous du lot E1 — nettoyage géométrique de l'import (micro-vides,
aller-retours de largeur nulle) et PARITÉ DES SEUILS avec le miroir Rust
(`nest-import/src/assemble.rs`).

Les seuils sont lus DANS le fichier Rust : deux constantes qui divergent, et
le même dessin aurait 21 trous d'un côté et 0 de l'autre — exactement l'écart
que le lot E1 doit fermer.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from worker_common.geometry.cleanup import (
    MICRO_VOID_AREA_MM2,
    MICRO_VOID_MIN_DIM_MM,
    SPUR_EPS_MM,
    is_micro_void,
    strip_spurs,
)
from worker_common.geometry.import_findings import build_findings, empty_stats

RUST = (Path(__file__).parents[3] / "workers" / "geometry" / "crates"
        / "nest-import" / "src" / "assemble.rs")


def _rust_const(name):
    text = RUST.read_text(encoding="utf-8")
    m = re.search(rf"pub const {name}: f64 = ([0-9.]+);", text)
    assert m, f"constante {name} introuvable dans {RUST}"
    return float(m.group(1))


class TestParityWithRust:
    def test_les_trois_seuils_sont_les_memes(self):
        assert MICRO_VOID_AREA_MM2 == _rust_const("MICRO_VOID_AREA_MM2")
        assert MICRO_VOID_MIN_DIM_MM == _rust_const("MICRO_VOID_MIN_DIM_MM")
        assert SPUR_EPS_MM == _rust_const("SPUR_EPS_MM")


class TestMicroVoid:
    def test_un_vrai_trou_reste_un_trou(self):
        # Ø35 mm de la pièce annulaire du corpus : 962 mm².
        import math
        ring = [[17.5 * math.cos(t * math.pi / 18), 17.5 * math.sin(t * math.pi / 18)]
                for t in range(36)]
        assert not is_micro_void(ring)

    def test_carre_de_08_mm_rebouche_par_l_aire(self):
        # 0,64 mm² < 1 mm², alors que ses deux côtés font plus de 0,5 mm.
        assert is_micro_void([[0, 0], [0.8, 0], [0.8, 0.8], [0, 0.8]])

    def test_fente_longue_et_fine_rebouchee_par_le_petit_cote(self):
        # 20 × 0,3 mm = 6 mm² (aire largement au-dessus du seuil) mais
        # 0,3 mm de large : rien ne passe là, et le canal capillaire de
        # jagua écraserait l'anneau.
        assert is_micro_void([[0, 0], [20, 0], [20, 0.3], [0, 0.3]])

    def test_anneau_degenere(self):
        assert is_micro_void([[0, 0], [1, 0]])


class TestStripSpurs:
    def test_l_aller_retour_de_largeur_nulle_disparait(self):
        # Motif MESURÉ sur le fichier c04 du corpus (lot E0, « no pole found
        # with 10 levels of recursion ») : la polyligne part à gauche sur
        # 6,9 mm et revient 0,0001 mm plus haut.
        ring = [
            [72.871, 84.6031], [65.9436, 84.6031], [72.871, 84.6032],
            [74.8711, 82.6031], [74.871, 73.5209], [74.871, 82.6031],
        ]
        out, removed = strip_spurs(ring)
        assert removed == 4, out
        assert [[round(x, 4), round(y, 4)] for x, y in out] == [
            [72.871, 84.6031], [74.8711, 82.6031],
        ]

    def test_un_anneau_propre_n_est_pas_touche(self):
        # La règle doit être un NO-OP sur tout dessin sain : sinon le seed
        # canonique de tous les fichiers changerait.
        ring = [[0, 0], [100, 0], [100, 50], [0, 50]]
        out, removed = strip_spurs(ring)
        assert removed == 0
        assert out == [[0, 0], [100, 0], [100, 50], [0, 50]]

    def test_un_cercle_echantillonne_n_est_pas_touche(self):
        import math
        ring = [[10 * math.cos(t * math.pi / 32), 10 * math.sin(t * math.pi / 32)]
                for t in range(64)]
        out, removed = strip_spurs(ring)
        assert removed == 0
        assert len(out) == 64

    def test_l_ergot_niche_part_aussi(self):
        # A -> B -> B' (0,001 de B) -> A' (0,001 de A) : deux passes.
        ring = [[0, 0], [10, 0], [10.0005, 0], [0.0005, 0], [0, 20]]
        out, removed = strip_spurs(ring)
        assert removed >= 2
        assert len(out) <= 3


class TestFindings:
    def test_les_deux_constats_sont_des_informations(self):
        stats = {**empty_stats(), "microVoids": 21, "spursRemoved": 4}
        out = {f["code"]: f for f in build_findings(stats)}
        assert out["import.microVoidsFilled"]["level"] == "info"
        assert out["import.microVoidsFilled"]["count"] == 21
        assert out["import.spursRemoved"]["level"] == "info"
        assert out["import.spursRemoved"]["count"] == 4

    def test_rien_a_dire_rien_affiche(self):
        assert build_findings(empty_stats()) == []
