"""Distance au bord : portage exact (tôles rectangulaires) du constructeur
navigateur (app/composables/localPayloadBuilder.js, piège 68 de AGENTS.md).

Le moteur ne connaît que l'espacement `s` (entre pièces ET au bord). Pour tenir
les pièces à `e` du bord, on lui donne une tôle décalée de `d = e - s` :
rectangle (W - 2d) x (H - 2d), longueurs arrondies PAR DÉFAUT au f32 (le moteur
les lit en f32 et ne doit jamais avoir plus de place que la vraie limite). Une
pose moteur (x, y) vaut (x + d, y + d) sur la vraie tôle.

Même arrondis, même ordre d'opérations flottantes que le JS : le payload doit
sortir identique au bit près (fixtures de parité dans tests/fixtures).
Rien ici ne touche le chemin d'avant : `d == 0` ne passe jamais par ce module
pour construire des tôles.
"""
import math
import struct

# Seuil sous lequel un bord « égal à l'espacement » compte comme non réglé.
EDGE_EPS_MM = 1e-6
# Un peu SOUS l'ajustement exact que le moteur refuse (maximum annoncé).
EDGE_FIT_SLACK_MM = 0.02


class EdgeRefusal(Exception):
    """Refus « distance au bord » : `code` nu (ex. edge_too_large) et `detail`
    chiffré, comme l'erreur `__edge` du constructeur JS."""

    def __init__(self, code, detail=None):
        super().__init__(code)
        self.code = code
        self.detail = dict(detail or {})


def _finite(x):
    return isinstance(x, (int, float)) and math.isfinite(x)


def _num(x):
    """Number(x) || 0 du JS, pour les valeurs d'un job."""
    try:
        n = float(x)
    except (TypeError, ValueError):
        return 0.0
    return n if math.isfinite(n) else 0.0


def js_round(x):
    """Math.round du JS : demi vers +infini (pas l'arrondi pair de Python)."""
    f = math.floor(x)
    return f + 1 if x - f >= 0.5 else f


def floor_centi(x):
    """Arrondi PAR DÉFAUT au centième : la valeur annoncée doit passer."""
    if not math.isfinite(x):
        return x
    return math.floor(x * 100 + 1e-9) / 100


def f32_at_or_below(x):
    """Plus grand flottant 32 bits <= x (Math.fround arrondit au plus proche)."""
    try:
        f = struct.unpack("<f", struct.pack("<f", x))[0]
    except OverflowError:
        f = math.inf if x > 0 else -math.inf
    if not (f > x):
        return f
    # f > x : f ne peut pas être le plus petit flottant ; un cran vers -infini.
    bits = struct.unpack("<i", struct.pack("<f", f))[0]
    if f > 0:
        bits -= 1
    elif f < 0:
        bits += 1
    if f == 0:
        bits = -2147483647  # -0 > x : le plus petit négatif dénormal
    return struct.unpack("<f", struct.pack("<i", bits))[0]


def edge_request_of(params):
    """Distance au bord demandée (mm) des params, ou None (vide = comme
    l'espacement)."""
    v = (params or {}).get("edgeDistance")
    if v is None or v == "":
        return None
    if isinstance(v, str):
        s = v.strip()
        if s == "":
            n = 0.0
        elif "_" in s:
            return None
        else:
            try:
                n = float(s)
            except ValueError:
                return None
    else:
        try:
            n = float(v)
        except (TypeError, ValueError):
            return None
    return n if math.isfinite(n) else None


def edge_shift_mm(space_mm, edge_mm):
    """Décalage moteur d = e - s (0 si le bord n'est pas réglé ou vaut
    l'espacement à EDGE_EPS_MM près)."""
    if edge_mm is None:
        return 0
    e = float(edge_mm)
    if not math.isfinite(e):
        return 0
    d = e - (_num(space_mm) or 0)
    return 0 if abs(d) < EDGE_EPS_MM else d


def rotated_bbox_size(ring, angle_deg):
    """Boîte [w, h] de l'anneau tourné de `angle_deg` (anti-horaire, autour de
    (0, 0))."""
    if angle_deg:
        r = (angle_deg * math.pi) / 180
        c = math.cos(r)
        s = math.sin(r)
        pts = [(c * x - s * y, s * x + c * y) for x, y in ring]
    else:
        pts = [(x, y) for x, y in ring]
    min_x = min(p[0] for p in pts)
    min_y = min(p[1] for p in pts)
    max_x = max(p[0] for p in pts)
    max_y = max(p[1] for p in pts)
    return [max_x - min_x, max_y - min_y]


def _rotations(item, default):
    return item.get("rotations", default) or [0.0]


def _active(sheets):
    return [s for s in sheets if _num(s.get("count")) > 0]


def part_fits_sheet(w, h, sheet, space):
    return (w + 2 * space <= float(sheet.get("width")) + 1e-6
            and h + 2 * space <= float(sheet.get("height")) + 1e-6)


def item_fits_sheets(coords, rotations, sheets, space):
    """La pièce tient-elle dans au moins une tôle, dans une rotation permise ?"""
    rots = rotations or [0]
    boxes = [rotated_bbox_size(coords, _num(a)) for a in rots]
    for sheet in sheets:
        if any(part_fits_sheet(w, h, sheet, space) for w, h in boxes):
            return True
    return False


class EdgeCtx:
    """Contexte des refus chiffrés : vraies tôles, pièces, marge de courbes,
    espacement demandé et interne, rotations par défaut, lecteur de nom."""

    def __init__(self, sheets, items, margin, requested_space, space,
                 default_rotations, name_of=None):
        self.sheets = sheets
        self.items = items
        self.margin = margin
        self.requested_space = requested_space
        self.space = space
        self.default_rotations = default_rotations
        self.name_of = name_of or (lambda slug: slug)


def edge_box_bound(items, sheets, margin, default_rotations):
    """Plus grande distance au bord DEMANDÉE (mm, non arrondie) que les boîtes
    permettent (rectangles : exacte)."""
    active = _active(sheets)
    pool = active if active else sheets
    bound = math.inf
    for s in pool:
        bound = min(bound, min(float(s.get("width")), float(s.get("height"))) / 2)
    for item in items:
        if not (_num(item.get("count")) > 0):
            continue
        best = -math.inf
        for angle in _rotations(item, default_rotations):
            w, h = rotated_bbox_size(item["coords"], _num(angle))
            for s in pool:
                best = max(best, min((float(s.get("width")) - w) / 2,
                                     (float(s.get("height")) - h) / 2))
        bound = min(bound, best)
    return bound - margin


def max_edge_for_fit(items, sheets, margin, default_rotations):
    """Plus grande distance au bord demandée qui passe, au centième par
    défaut, un peu sous l'ajustement exact."""
    return max(0, floor_centi(
        edge_box_bound(items, sheets, margin, default_rotations)
        - EDGE_FIT_SLACK_MM))


def edge_builds(ctx, e):
    """Le job se construit-il avec la distance au bord demandée `e` ? Ne lève
    jamais : un refus quelconque vaut « non »."""
    d = edge_shift_mm(ctx.requested_space, e)
    engine = ctx.sheets
    if d != 0:
        try:
            engine = edge_engine_sheets(ctx, e, d, probe=True)
        except EdgeRefusal:
            return False
    return all(
        item_fits_sheets(item["coords"], _rotations(item, ctx.default_rotations),
                         engine, ctx.space)
        for item in ctx.items)


def edge_too_large_detail(ctx, requested_edge):
    """Détail du refus edge_too_large : {maxEdgeMm} (valeur qui passe), ou {}
    quand aucune valeur sûre n'est connue."""
    v = max_edge_for_fit(ctx.items, ctx.sheets, ctx.margin, ctx.default_rotations)
    for c in (v, js_round((v - 0.01) * 100) / 100):
        if c >= 0 and edge_builds(ctx, c):
            return {"maxEdgeMm": c}
    return {}


def overhang_cap_of(items, default_rotations):
    """Surplomb maximal (mm) d'une distance au bord négative et la pièce qui
    le limite : moitié du plus petit côté de la boîte de chaque pièce
    PHYSIQUE (chaque pièce d'un bloc), sur ses rotations permises, dans les
    deux sens."""
    cap = math.inf
    limiting = None
    for item in items:
        if not (_num(item.get("count")) > 0):
            continue
        rots = _rotations(item, default_rotations)
        if item.get("blockParts"):
            bodies = [bp["coords"] for bp in item["blockParts"]]
        else:
            bodies = [item["coords"]]
        for ring in bodies:
            if not isinstance(ring, (list, tuple)) or len(ring) < 3:
                continue
            side = math.inf
            for angle in rots:
                a = _num(angle)
                for sgn in ([1] if a == 0 else [1, -1]):
                    w, h = rotated_bbox_size(ring, sgn * a)
                    side = min(side, w, h)
            if side / 2 < cap:
                cap = side / 2
                limiting = item.get("file_slug")
    return cap, limiting


def edge_engine_sheets(ctx, requested_edge, d, probe=False):
    """Tôles MOTEUR (rectangles) d'un job à distance au bord (d != 0), alignées
    index par index sur les vraies tôles. Refuse AVANT tout calcul lourd :
    surplomb trop grand (edge_overhang_too_large), tôle moteur vide
    (edge_too_large). `probe` : les refus partent sans chiffre."""
    sheets = ctx.sheets

    def too_large():
        if probe:
            return EdgeRefusal("edge_too_large")
        return EdgeRefusal("edge_too_large",
                           edge_too_large_detail(ctx, requested_edge))

    if requested_edge < 0:
        cap, limiting = overhang_cap_of(ctx.items, ctx.default_rotations)
        if math.isfinite(cap) and -requested_edge > cap + 1e-9:
            raise EdgeRefusal("edge_overhang_too_large", {
                "maxOverhangMm": floor_centi(cap),
                "part": ctx.name_of(limiting),
            })
    # Tôle moteur dégénérée (bord plus grand que la demi-tôle) : refus chiffré.
    # Les tôles actives comptent ; aucune active : toutes.
    active = _active(sheets)
    if d > 0 and any(
            not (float(s.get("width")) - 2 * d > 0)
            or not (float(s.get("height")) - 2 * d > 0)
            for s in (active if active else sheets)):
        raise too_large()
    out = []
    for s in sheets:
        out.append({
            "width": f32_at_or_below(float(s.get("width")) - 2 * d),
            "height": f32_at_or_below(float(s.get("height")) - 2 * d),
            "count": s.get("count"),
        })
    return out


def sheet_frame_of(sheet):
    """Repère RÉEL d'une tôle (payload.sheetFrames)."""
    return {"width": float(sheet.get("width")), "height": float(sheet.get("height"))}


# ---------------------------------------------------------------------------
# JSON canonique au format EXACT du navigateur (canonicalJson, JSON.stringify)
# ---------------------------------------------------------------------------

def js_number_str(x):
    """Écriture de `String(x)` du JS (Number.prototype.toString) : flottant
    entier sans « .0 », décimale de 1e-6 à 1e21 exclus, sinon exposant sans zéro
    de tête et avec signe (1e-7, 1.5e+21) ; -0 s'écrit 0."""
    from decimal import Decimal
    if isinstance(x, bool):
        raise TypeError("bool n'est pas un nombre")
    if x == 0:
        return "0"
    if isinstance(x, int):
        x = float(x) if abs(x) >= 2 ** 53 else x
        if isinstance(x, int):
            return str(x)
    if not math.isfinite(x):
        return "null"
    sign = "-" if x < 0 else ""
    t = Decimal(repr(abs(x))).as_tuple()
    digits = "".join(map(str, t.digits))
    n = len(digits) + t.exponent  # valeur = 0.DIGITS x 10^n
    digits = digits.rstrip("0")  # repr = plus court aller-retour, comme le JS
    k = len(digits)
    if k <= n <= 21:
        body = digits + "0" * (n - k)
    elif 0 < n <= 21:
        body = digits[:n] + "." + digits[n:]
    elif -6 < n <= 0:
        body = "0." + "0" * (-n) + digits
    else:
        e = n - 1
        mant = digits[0] + ("." + digits[1:] if k > 1 else "")
        body = f"{mant}e{'+' if e >= 0 else '-'}{abs(e)}"
    return sign + body


_JS_SIMPLE_ESCAPES = {"\n": "n", "\r": "r", "\t": "t", "\b": "b", "\f": "f"}


def _js_json_string(s):
    out = ['"']
    for ch in str(s):
        cp = ord(ch)
        if ch == '"':
            out.append('\\"')
        elif ch == "\\":
            out.append("\\\\")
        elif ch in _JS_SIMPLE_ESCAPES:
            out.append("\\" + _JS_SIMPLE_ESCAPES[ch])
        elif cp < 0x20:
            out.append("\\u%04x" % cp)
        elif cp < 0x7F:
            out.append(ch)
        elif cp <= 0xFFFF:
            out.append("\\u%04x" % cp)
        else:
            v = cp - 0x10000
            out.append("\\u%x\\u%x" % (0xD800 + (v >> 10), 0xDC00 + (v & 0x3FF)))
    out.append('"')
    return "".join(out)


def js_canonical_json(value):
    """Miroir de `canonicalJson` (localPayloadBuilder.js) : clés triées
    récursivement, sans espaces, nombres écrits comme `String(n)`."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return js_number_str(value)
    if isinstance(value, str):
        return _js_json_string(value)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(js_canonical_json(v) for v in value) + "]"
    keys = sorted(value)
    return "{" + ",".join(
        _js_json_string(k) + ":" + js_canonical_json(value[k]) for k in keys) + "}"


def js_deterministic_seed(payload):
    """Graine 63 bits au format de `deterministicSeed` (JS) : sha256 du JSON
    canonique, 8 premiers octets, masque 63 bits."""
    import hashlib
    digest = hashlib.sha256(js_canonical_json(payload).encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") & 0x7FFF_FFFF_FFFF_FFFF
