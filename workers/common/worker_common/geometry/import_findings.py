"""Constats d'import — ce que l'importeur a **perdu, supposé ou aplati**,
sous une forme que l'interface peut afficher (lot 2c,
`docs/PLAN-IMPORT-2026-09-09.md` §9.2 ; textes dans
`docs/qa/import-2026-09-09/rapport-reparation.md`).

MIROIR EXACT de `nest-import/src/findings.rs` : mêmes tables matière/bruit,
mêmes codes, mêmes niveaux, même ordre. Deux listes qui divergent, et le
même fichier serait « attention » sur un chemin et « info » sur l'autre —
l'écart que le lot D a mesuré sur vingt fichiers.

Deux règles portées ici, et pas ailleurs :

1. le partage « matière » / « bruit » vit dans UNE table par importeur,
   verrouillée par un test qui compare les deux ;
2. **une entité inconnue compte comme de la MATIÈRE** : on ne sait pas ce
   qu'on a jeté, donc on le dit. Le silence est réservé au bruit connu.

Aucune phrase ici : des codes, des niveaux, des comptes.
"""

# Entités qui décrivent de la MATIÈRE : les écarter fait perdre de la découpe.
MATERIAL_ENTITIES = (
    "HATCH", "SOLID", "TRACE", "3DFACE", "SHAPE", "REGION", "3DSOLID", "BODY",
    "SURFACE", "MLINE", "ACAD_PROXY_ENTITY", "OLE2FRAME", "ACAD_TABLE",
    "REPEAT", "ENDREP", "MESH", "POLYFACE",
)

# Entités qui ne décrivent pas de matière découpable : annotations, cotes,
# aides de dessin. Les écarter est le comportement voulu.
NOISE_ENTITIES = (
    "TEXT", "MTEXT", "ATTDEF", "ATTRIB", "SEQEND", "DIMENSION", "LEADER",
    "VIEWPORT", "IMAGE", "TOLERANCE", "XLINE", "RAY", "WIPEOUT", "MULTILEADER",
    "ACAD_TABLESTYLE", "LAYOUT", "VERTEX",
)

LEVEL_INFO = "info"
LEVEL_ATTENTION = "attention"

# Nom canonique de l'unité et seuil d'invraisemblance : units.py est la
# source unique (miroir Rust : nest-import::units).
from worker_common.geometry.units import (  # noqa: E402
    IMPLAUSIBLE_FACTOR_MM,
    unit_name,
)


def is_material(kind) -> bool:
    """True si écarter cette entité fait perdre de la matière. Un type
    INCONNU compte comme de la matière (règle 2)."""
    k = str(kind or "").strip().upper()
    return k not in NOISE_ENTITIES


def empty_stats() -> dict:
    """Le dictionnaire de constats, tous les champs à zéro."""
    return {
        "skipped": {},          # type d'entité -> occurrences
        "insunits": 4,          # code $INSUNITS lu (0 = absent)
        "unitFactor": 1.0,      # facteur appliqué vers le mm
        "unitUnknown": False,   # code hors table -> mm supposés
        "blocksFlattened": 0,   # INSERT résolus
        "splines": 0,           # SPLINE échantillonnées
        "danglingPaths": 0,     # tracés ouverts ne refermant aucune pièce
        "droppedParts": 0,      # corps écartés à l'émission
        "microVoids": 0,        # trous rebouchés, trop petits pour la découpe
        "spursRemoved": 0,      # sommets d'aller-retours de largeur nulle
    }


def _finding(code, level, count, types=None, value=None) -> dict:
    out = {"code": code, "level": level, "count": count}
    if types:
        out["types"] = list(types)
    if value is not None:
        out["value"] = str(value)
    return out


def build_findings(stats: dict) -> list:
    """Les constats, gravité d'abord (attention avant info) puis compte
    décroissant — l'ordre d'affichage du §4 du catalogue. Un fichier sans
    rien à dire rend une liste VIDE (et l'interface n'affiche rien)."""
    stats = {**empty_stats(), **(stats or {})}
    out = []

    material, noise = [], []
    for kind, n in (stats.get("skipped") or {}).items():
        (material if is_material(kind) else noise).append((str(kind).upper(), int(n)))

    if material:
        material.sort(key=lambda kv: (-kv[1], kv[0]))
        out.append(_finding(
            "import.entitiesSkipped", LEVEL_ATTENTION,
            sum(n for _, n in material), [k for k, _ in material],
        ))
    if stats["danglingPaths"] > 0:
        out.append(_finding("import.contoursDropped", LEVEL_ATTENTION, stats["danglingPaths"]))
    if stats["droppedParts"] > 0:
        out.append(_finding("import.partsDropped", LEVEL_ATTENTION, stats["droppedParts"]))
    if stats["unitUnknown"]:
        out.append(_finding("import.unitUnknown", LEVEL_ATTENTION, 1, value=stats["insunits"]))
    elif stats["unitFactor"] >= IMPLAUSIBLE_FACTOR_MM:
        # Kilomètres, hectomètres, années-lumière : conversion exacte, mais
        # une pièce de 80 mètres ne sort pas d'un atelier — c'est le cas qui
        # multipliait la géométrie par un million en silence avant le lot 2b.
        out.append(_finding("import.unitImplausible", LEVEL_ATTENTION, 1,
                            value=unit_name(stats["insunits"])))

    if noise:
        noise.sort(key=lambda kv: (-kv[1], kv[0]))
        out.append(_finding(
            "import.annotationsSkipped", LEVEL_INFO,
            sum(n for _, n in noise), [k for k, _ in noise],
        ))
    if (not stats["unitUnknown"]
            and stats["unitFactor"] != 1.0
            and stats["unitFactor"] < IMPLAUSIBLE_FACTOR_MM):
        out.append(_finding("import.unitConverted", LEVEL_INFO, 1,
                            value=unit_name(stats["insunits"])))
    if stats["insunits"] == 0:
        out.append(_finding("import.unitAssumed", LEVEL_INFO, 1))
    if stats["blocksFlattened"] > 0:
        out.append(_finding("import.blocksFlattened", LEVEL_INFO, stats["blocksFlattened"]))
    if stats["splines"] > 0:
        out.append(_finding("import.splinesSampled", LEVEL_INFO, stats["splines"]))
    # Lot E1 : ce que le nettoyage géométrique a retiré. Information, pas
    # attention — un micro-vide rebouché REND de la matière — mais on ne
    # modifie pas un dessin en silence.
    if stats["microVoids"] > 0:
        out.append(_finding("import.microVoidsFilled", LEVEL_INFO, stats["microVoids"]))
    if stats["spursRemoved"] > 0:
        out.append(_finding("import.spursRemoved", LEVEL_INFO, stats["spursRemoved"]))
    return out
