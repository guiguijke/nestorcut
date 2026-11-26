"""Nettoyage géométrique de l'import — MIROIR PYTHON du Rust (lot E1 de
docs/PLAN-ECLATEMENT-2026-09-12.md §3).

Deux règles, les mêmes des deux côtés :

1. **Un micro-vide n'est pas un trou.** Un trou d'aire < 1 mm² ou dont le
   plus petit côté fait moins de 0,5 mm est un artefact de dessin (deux
   traits qui ne se rejoignent pas tout à fait, un congé dégénéré) : il est
   REBOUCHÉ — la matière reprend sa place — et compté. Le garder coûterait
   cher et ne servirait à rien : jagua ouvre chaque trou par un canal
   capillaire (piège AGENTS #2) et un canal dans un vide de 0,3 mm² écrase
   l'anneau.

2. **Un aller-retour de largeur nulle n'est pas de la matière.** Le tracé
   part de A, va en B et revient en A' à moins de 0,01 mm de A : `reduce_ring`
   ne le voit pas (A et B sont loin, A et A' ne sont pas consécutifs) et ce
   qui reste est un ergot d'aire nulle. Mesuré au lot E0 : c'est ce motif qui
   fait échouer le *surrogate* de jagua (« no pole found with 10 levels of
   recursion ») et tue le job à l'import.

Les seuils sont ceux de `workers/geometry/crates/nest-import/src/assemble.rs` ;
un test les relit DANS le fichier Rust (pas une copie de constantes).
"""

import math

MICRO_VOID_AREA_MM2 = 1.0
MICRO_VOID_MIN_DIM_MM = 0.5
SPUR_EPS_MM = 0.01
# Regle W : un corps dont la LARGEUR MINIMALE (plus petit ecart entre deux
# droites paralleles qui l'enserrent) est sous ce seuil n'est pas une piece.
MIN_PART_WIDTH_MM = 0.1
# Écart, en pas de grille (1e-4 mm) et par axe, sous lequel deux bouts sont le
# MÊME point. Même valeur que le Rust (assemble.rs), qui dit pourquoi.
JOIN_STEPS = 2


def snap(v: float) -> float:
    return math.floor(v * 1e4 + 0.5) / 1e4


def opens_on_grid(coords) -> bool:
    """Vrai si les deux bouts d'un tracé fermé s'arrondissent à JOIN_STEPS pas au
    plus l'un de l'autre, mais PAS sur le même point : il s'ouvrirait. Un tracé
    plus petit que MIN_PART_WIDTH_MM est un petit arc ouvert, il le reste."""
    (ax, ay), (bx, by) = ((snap(x), snap(y)) for x, y in (coords[0], coords[-1]))
    near = (JOIN_STEPS + 0.5) * 1e-4  # demi-pas : marge d'arrondi
    if (ax, ay) == (bx, by) or abs(ax - bx) > near or abs(ay - by) > near:
        return False
    xs, ys = [p[0] for p in coords], [p[1] for p in coords]
    return min(max(xs) - min(xs), max(ys) - min(ys)) >= MIN_PART_WIDTH_MM


def join_free_ends(lines, deadline=None):
    """Déplacements des bouts LIBRES voisins d'un autre sommet : {point: point}.

    `lines` : listes de points (x, y) noués et posés sur la grille 1e-4. Miroir
    de `snap_edges_until` (assemble.rs) : le bout d'un segment est écrit, celui
    d'un arc est calculé, et ils s'arrondissent parfois d'un pas l'un à côté de
    l'autre. Seul un bout libre (un seul voisin) bouge, et jamais vers son propre
    voisin. Les sommets sont comparés par case de grille : GEOS les rend en
    multiples de 1e-4, au dernier bit près.
    """
    only = {}
    point_at = {}
    for line_idx, line in enumerate(lines):
        if deadline is not None:
            deadline.check(line_idx)
        cells = [(round(x * 1e4), round(y * 1e4)) for x, y in line]
        point_at.update(zip(cells, line))
        for a, b in zip(cells, cells[1:]):
            if a == b:
                continue
            for p, q in ((a, b), (b, a)):
                if only.setdefault(p, q) != q:
                    only[p] = None
    moved = {}
    held = set()
    for p in sorted(k for k, n in only.items() if n is not None):
        if p in held:
            continue
        own = only[p]
        # Le plus proche ; à égalité un sommet déjà relié passe avant un autre
        # bout libre, puis le plus petit (x puis y).
        best = None
        for r in range(1, JOIN_STEPS + 1):
            for dx in range(-r, r + 1):
                for dy in range(-r, r + 1):
                    if max(abs(dx), abs(dy)) != r:
                        continue
                    c = (p[0] + dx, p[1] + dy)
                    if c == own or c in moved or c not in only:
                        continue
                    is_free = only[c] is not None
                    if best is None or (best[0] and not is_free):
                        best = (is_free, c)
            if best is not None:
                break
        if best is not None:
            moved[p] = best[1]
            held.add(best[1])
    return {point_at[p]: point_at[c] for p, c in moved.items()}


def _cross(o, a, b) -> float:
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def ring_too_thin(ring) -> bool:
    """Regle W : la largeur minimale de l'anneau est-elle sous MIN_PART_WIDTH_MM ?

    Enveloppe convexe (chaine monotone d'Andrew) puis calipers tournants : la
    largeur minimale est atteinte sur un cote de l'enveloppe. Meme arithmetique,
    meme ordre d'operations que `ring_too_thin` de assemble.rs (ni hypot, ni
    sqrt, ni FMA) : meme anneau, meme decision, au bit pres. L'anneau peut etre
    ouvert ou ferme (les points egaux sont dedoubles).
    """
    pts = sorted((float(p[0]), float(p[1])) for p in ring)
    pts = [p for i, p in enumerate(pts) if i == 0 or p != pts[i - 1]]
    if len(pts) < 3:
        return True
    lower = []
    for p in pts:
        while len(lower) >= 2 and _cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and _cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    hull = lower[:-1] + upper[:-1]
    m = len(hull)
    if m < 3:
        return True
    w2 = MIN_PART_WIDTH_MM * MIN_PART_WIDTH_MM
    j = 1
    for i in range(m):
        p = hull[i]
        q = hull[(i + 1) % m]
        dx = q[0] - p[0]
        dy = q[1] - p[1]
        len2 = dx * dx + dy * dy
        steps = 0
        while steps < m and _cross(p, q, hull[(j + 1) % m]) > _cross(p, q, hull[j]):
            j = (j + 1) % m
            steps += 1
        c = _cross(p, q, hull[j])
        if c * c < w2 * len2:
            # Les calibres ne sont qu'un FILTRE : en flottant, l'enveloppe garde
            # des sommets colineaires a l'arrondi pres, la boucle ci-dessus
            # s'arrete sur un faux plateau et `c` est une largeur fausse et
            # minuscule (revue B1). On confirme par un balayage complet du cote.
            lo = 0.0
            hi = 0.0
            for k in range(m):
                v = _cross(p, q, hull[k])
                if v < lo:
                    lo = v
                if v > hi:
                    hi = v
            e = hi - lo
            if e * e < w2 * len2:
                return True
    return False


def _ring_signed_area(ring) -> float:
    n = len(ring)
    if n < 3:
        return 0.0
    a = 0.0
    for i in range(n):
        x0, y0 = ring[i][0], ring[i][1]
        x1, y1 = ring[(i + 1) % n][0], ring[(i + 1) % n][1]
        a += x0 * y1 - x1 * y0
    return a / 2.0


def is_micro_void(ring) -> bool:
    """Un trou trop petit pour être découpé (aire ou plus petit côté)."""
    if len(ring) < 3:
        return True
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    w = max(xs) - min(xs)
    h = max(ys) - min(ys)
    return (abs(_ring_signed_area(ring)) < MICRO_VOID_AREA_MM2
            or min(w, h) < MICRO_VOID_MIN_DIM_MM)


def strip_spurs(ring):
    """Retire les aller-retours de largeur nulle d'un anneau OUVERT cyclique.

    Rend `(anneau, sommets retirés)`. On garde A, on jette B et A' ; itératif,
    un ergot niché dans un ergot disparaît au passage suivant.
    """
    eps2 = SPUR_EPS_MM * SPUR_EPS_MM
    pts = [list(p) for p in ring]
    total = 0
    while True:
        n = len(pts)
        if n < 4:
            return pts, total
        keep = [True] * n
        removed = 0
        i = 0
        while i < n:
            prev = (i + n - 1) % n
            nxt = (i + 1) % n
            if keep[i] and keep[prev] and keep[nxt] and prev != nxt:
                ax, ay = pts[prev][0], pts[prev][1]
                cx, cy = pts[nxt][0], pts[nxt][1]
                if (ax - cx) ** 2 + (ay - cy) ** 2 <= eps2:
                    keep[i] = False
                    keep[nxt] = False
                    removed += 2
                    i += 2
                    continue
            i += 1
        if removed == 0:
            return pts, total
        pts = [p for p, k in zip(pts, keep) if k]
        total += removed
