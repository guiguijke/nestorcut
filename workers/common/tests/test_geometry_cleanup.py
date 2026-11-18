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
    MIN_PART_WIDTH_MM,
    SPUR_EPS_MM,
    is_micro_void,
    ring_too_thin,
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
        assert MIN_PART_WIDTH_MM == _rust_const("MIN_PART_WIDTH_MM")


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


def _brute_min_width(ring):
    """Largeur minimale par force brute O(m*m) : pour chaque arete de
    l'anneau, la plus grande distance d'un sommet a sa droite ; le minimum sur
    les aretes. Exact pour la largeur minimale de l'enveloppe convexe (la
    largeur minimale est portee par un cote de l'enveloppe, et l'ecart d'un
    cote de l'anneau ne peut qu'etre >= a celui du cote d'enveloppe)."""
    import math
    pts = [tuple(p) for p in ring]
    hull_width = math.inf
    n = len(pts)
    for i in range(n):
        for j in range(n):
            if i == j or pts[i] == pts[j]:
                continue
            dx = pts[j][0] - pts[i][0]
            dy = pts[j][1] - pts[i][1]
            length = math.hypot(dx, dy)
            sides = [((p[0] - pts[i][0]) * dy - (p[1] - pts[i][1]) * dx) / length for p in pts]
            if min(sides) >= -1e-12 or max(sides) <= 1e-12:
                # (i, j) porte une arete de l'enveloppe : tous les points du meme cote
                hull_width = min(hull_width, max(abs(s) for s in sides))
    return 0.0 if hull_width == math.inf else hull_width


class TestRingTooThin:
    def test_contre_la_force_brute_sur_2000_anneaux(self):
        import math
        import random
        rng = random.Random(20261117)
        cases = 0
        near = 0
        for _ in range(2000):
            kind = rng.choice(["convex", "concave", "thin", "near"])
            if kind == "convex":
                k = rng.randint(3, 9)
                ang = sorted(rng.uniform(0, 2 * math.pi) for _ in range(k))
                r = rng.uniform(1, 50)
                ring = [(r * math.cos(a), r * math.sin(a)) for a in ang]
            elif kind == "concave":
                k = rng.randint(4, 12)
                ang = sorted(rng.uniform(0, 2 * math.pi) for _ in range(k))
                ring = [(rng.uniform(5, 40) * math.cos(a), rng.uniform(5, 40) * math.sin(a)) for a in ang]
            elif kind == "thin":
                L = rng.uniform(1, 100)
                w = rng.uniform(0.0, 0.3)
                a = rng.uniform(0, math.pi)
                ux, uy = math.cos(a), math.sin(a)
                ring = [(0, 0), (L * ux, L * uy),
                        (L * ux * rng.uniform(0.2, 0.8) - w * uy, L * uy * rng.uniform(0.2, 0.8) + w * ux)]
                ring += [(L * ux + rng.uniform(-w, w) * -uy, L * uy + rng.uniform(-w, w) * ux)
                         for _ in range(rng.randint(0, 3))]
            else:
                L = rng.uniform(5, 100)
                a = rng.uniform(0, math.pi)
                ux, uy = math.cos(a), math.sin(a)
                w = MIN_PART_WIDTH_MM * rng.uniform(0.97, 1.03)
                ring = [(0, 0), (L * ux, L * uy), (L * ux / 2 - w * uy, L * uy / 2 + w * ux)]
            if rng.random() < 0.5:
                ring = ring + [ring[0]]  # anneau ferme
            width = _brute_min_width(ring[:-1] if ring[0] == ring[-1] else ring)
            if abs(width - MIN_PART_WIDTH_MM) < 1e-9 * max(1.0, width):
                continue  # a l'arrondi pres sur le seuil : ni l'un ni l'autre n'est un bug
            cases += 1
            near += abs(width - MIN_PART_WIDTH_MM) < 0.01
            assert ring_too_thin(ring) == (width < MIN_PART_WIDTH_MM), (ring, width)
        assert cases > 1900 and near > 100

    def test_cas_simples(self):
        assert ring_too_thin([[0, 0], [10, 0]])
        assert ring_too_thin([[0, 0], [10, 0], [20, 0]])
        assert not ring_too_thin([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]])
        assert ring_too_thin([[0, 0], [10, 0], [10, 0.05], [0, 0.05]])


# ---------------------------------------------------------------- revue B1
# Le filtre des calibres ne doit pas juger mince une plaque epaisse dont
# l'enveloppe garde des sommets colineaires a l'arrondi pres.
SQ45 = [(206.6, 143.9), (232.6, 117.9), (294.6, 55.9), (306.6, 43.9), (406.6, 143.9), (306.6, 243.9)]

# Les six fichiers repro/snap0..5.dxf de la revue : plaques a 45 degres, au 1e-4 pres.
SNAP_PLATES = [
    [(37.099, 126.175), (77.7456, 85.5284), (155.957, 7.317), (163.274, 0.0), (220.8186, 57.5447), (232.1625, 68.8885), (313.672, 150.3981), (430.7267, 267.4527), (379.881, 318.2983), (358.1312, 340.0482), (348.2186, 349.9607), (295.6973, 402.482), (288.897, 409.2823), (192.2465, 312.6318), (165.1121, 285.4974), (162.1833, 282.5686), (95.6007, 215.986), (21.4444, 141.8296), (28.9032, 134.3708)],
    [(636.7545, 252.7036), (811.0647, 427.0138), (525.3571, 712.7214), (405.2391, 592.6033), (351.0469, 538.4111), (435.2852, 454.1728), (545.9314, 343.5266), (578.1704, 311.2876), (592.3229, 297.1351)],
    [(26.8858, 332.0944), (35.3553, 340.5639), (-29.684, 405.6033), (-55.0475, 430.9668), (-61.8896, 437.8089), (-133.8239, 509.7432), (-169.1792, 474.3878), (-78.4373, 383.6459), (-67.1401, 372.3487), (-21.9548, 327.1634), (-1.1812, 306.3898), (0.0, 305.2086)],
    [(94.4682, 69.9772), (102.1386, 62.3068), (143.2132, 21.2322), (164.4454, 0.0), (192.7332, 28.2879), (196.0551, 31.6097), (199.8007, 35.3553), (160.6341, 74.522), (101.2828, 133.8733), (54.0919, 181.0642), (47.7358, 174.7081), (43.9051, 170.8775), (37.286, 164.2583), (23.5106, 150.483), (18.7365, 145.7089), (28.113, 136.3324)],
    [(-333.1697, 1621.9671), (-347.3919, 1607.7449), (-124.1752, 1384.5282), (-54.8287, 1315.1817), (-19.1686, 1279.5216), (0.0, 1260.353), (46.3955, 1306.7485), (52.8951, 1313.2481), (70.7107, 1331.0637), (-276.6812, 1678.4556)],
    [(35.3553, 672.9225), (25.0553, 683.2225), (-156.479, 864.7568), (-243.7008, 951.9786), (-246.3091, 949.3703), (-273.4445, 922.2349), (-279.0561, 916.6232), (-266.8441, 904.4112), (-99.2627, 736.8298), (-87.0137, 724.5808), (-25.2822, 662.8493), (0.0, 637.5671), (25.9957, 663.5628), (33.8439, 671.411)],
]

def _plate(rng):
    """Plaque CONVEXE de largeur minimale >= 1 mm par construction (rectangle
    d'au moins 1 mm de cote, ou polygone circonscrit a un cercle de rayon >= 0,5),
    portant 0 a 3 sommets de plus, colineaires, sur chaque bord."""
    import math
    if rng.random() < 0.5:
        w, h = rng.uniform(1, 300), rng.uniform(1, 300)
        base = [(0.0, 0.0), (w, 0.0), (w, h), (0.0, h)]
    else:
        r = rng.uniform(0.5, 100)
        while True:
            k = rng.randint(3, 8)
            gaps = [rng.uniform(0.2, 2.0) for _ in range(k)]
            tot = sum(gaps)
            gaps = [g * 2 * math.pi / tot for g in gaps]
            if max(gaps) < 0.95 * math.pi:
                break
        a = rng.uniform(0, 2 * math.pi)
        base = []
        for g in gaps:
            mid = a + g / 2
            rad = r / math.cos(g / 2)
            base.append((rad * math.cos(mid), rad * math.sin(mid)))
            a += g
    return _with_extra_vertices(rng, base)


def _with_extra_vertices(rng, base):
    ring = []
    for i, (ax, ay) in enumerate(base):
        bx, by = base[(i + 1) % len(base)]
        ring.append((ax, ay))
        for t in sorted(rng.uniform(0.02, 0.98) for _ in range(rng.randint(0, 3))):
            ring.append((ax + t * (bx - ax), ay + t * (by - ay)))
    return ring


def _sliver(rng):
    """Corps dont la largeur minimale est de 0,001 a 0,09 mm, avec des sommets
    colineaires de plus sur ses bords longs."""
    L = rng.uniform(2, 300)
    w = rng.uniform(0.001, 0.09)
    if rng.random() < 0.5:
        base = [(0.0, 0.0), (L, 0.0), (L, w), (0.0, w)]
    else:
        base = [(0.0, 0.0), (L, 0.0), (L * rng.uniform(0.1, 0.9), w)]
    return _with_extra_vertices(rng, base)


def _place(rng, ring, mode, snap):
    import math
    if mode == "45":
        ang = math.pi / 4
    elif mode == "random":
        ang = rng.uniform(0, 2 * math.pi)
    else:
        ang = 0.0
    c, s = math.cos(ang), math.sin(ang)
    ox, oy = rng.uniform(-500, 500), rng.uniform(-500, 500)
    out = [(ox + x * c - y * s, oy + x * s + y * c) for x, y in ring]
    if snap:
        out = [(round(x, 4), round(y, 4)) for x, y in out]
    return out


class TestRingTooThinCollinear:
    def test_le_carre_a_45_degres_n_est_pas_mince(self):
        assert not ring_too_thin(SQ45)
        assert not ring_too_thin(SQ45 + [SQ45[0]])
        assert not ring_too_thin(list(reversed(SQ45)))

    def test_les_six_plaques_de_la_revue_ne_sont_pas_minces(self):
        for i, plate in enumerate(SNAP_PLATES):
            assert not ring_too_thin(plate), i

    def test_20000_plaques_et_polygones_convexes_avec_sommets_colineaires(self):
        import random
        rng = random.Random(20261118)
        wrong = []
        n = 0
        for i in range(20000):
            ring = _plate(rng)
            mode = ("45", "random", "0")[i % 3]
            ring = _place(rng, ring, mode, snap=bool(i // 3 % 2))
            n += 1
            if ring_too_thin(ring):
                wrong.append((i, mode))
        assert n == 20000
        assert not wrong, f"{len(wrong)} plaques epaisses jugees minces, premieres {wrong[:5]}"

    def test_6000_vraies_lames_avec_sommets_colineaires_sont_minces(self):
        import random
        rng = random.Random(20261119)
        missed = []
        for i in range(6000):
            ring = _place(rng, _sliver(rng), ("45", "random", "0")[i % 3], snap=bool(i // 3 % 2))
            if not ring_too_thin(ring):
                missed.append(i)
        assert not missed, f"{len(missed)} lames non jugees minces, premieres {missed[:5]}"

    def test_5000_anneaux_contre_l_arithmetique_exacte(self):
        import random
        from fractions import Fraction

        def exact_min_width2(ring):
            pts = sorted({(Fraction(x), Fraction(y)) for x, y in ring})

            def cr(o, a, b):
                return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
            lo, up = [], []
            for p in pts:
                while len(lo) >= 2 and cr(lo[-2], lo[-1], p) <= 0:
                    lo.pop()
                lo.append(p)
            for p in reversed(pts):
                while len(up) >= 2 and cr(up[-2], up[-1], p) <= 0:
                    up.pop()
                up.append(p)
            hull = lo[:-1] + up[:-1]
            best = None
            for i, p in enumerate(hull):
                q = hull[(i + 1) % len(hull)]
                len2 = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2
                vals = [cr(p, q, v) for v in hull]
                ext = max(vals) - min(vals)
                w2 = ext * ext / len2
                if best is None or w2 < best:
                    best = w2
            return best

        rng = random.Random(20261120)
        thr = Fraction(MIN_PART_WIDTH_MM) ** 2
        checked = thin = 0
        for i in range(5000):
            kind = i % 4
            if i < 7:
                ring = ([SQ45] + SNAP_PLATES)[i]  # les cas de la revue, tels quels
            elif kind == 0:
                ring = _plate(rng)
            elif kind == 1:
                ring = _sliver(rng)
            elif kind == 2:
                # largeur autour du seuil : 0,1 a 1 % pres
                L = rng.uniform(5, 300)
                w = MIN_PART_WIDTH_MM * rng.uniform(0.99, 1.01)
                ring = _with_extra_vertices(rng, [(0.0, 0.0), (L, 0.0), (L, w), (0.0, w)])
            else:
                import math
                ring = [(rng.uniform(0, 100), rng.uniform(0, 100)) for _ in range(rng.randint(3, 9))]
                ring = _with_extra_vertices(rng, ring) if rng.random() < 0.3 else ring
            if i >= 7:
                ring = _place(rng, ring, ("45", "random", "0")[i % 3], snap=bool(rng.random() < 0.5))
            w2 = exact_min_width2(ring)
            if abs(w2 - thr) <= Fraction(1, 10 ** 9) * thr:
                continue  # a 1e-9 pres sur le seuil : l'arrondi peut trancher dans les deux sens
            checked += 1
            thin += w2 < thr
            assert ring_too_thin(ring) == (w2 < thr), (i, ring, float(w2))
        assert checked > 4900 and thin > 1000
