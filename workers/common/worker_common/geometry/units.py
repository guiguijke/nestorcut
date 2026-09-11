"""
DXF drawing-unit normalization ($INSUNITS).

The canonical internal unit is ALWAYS millimeters. Files authored in other
units are scaled at import time — decompose first (block INSERTs resolved
into flat primitives), then a uniform scale — so every downstream constant
(tolerances, channel widths, engine config) keeps its mm semantics.

$MEASUREMENT only toggles dimension-text units in CAD — ignored here.

Lot 2b (`docs/PLAN-IMPORT-2026-09-09.md` §9.2) : la table couvre les codes
**0 à 20** (sept codes seulement avant : un dessin déclaré en kilomètres ou
en yards était lu ×1, en silence, donc au millimètre), le code écrit en
**flottant** est accepté (notre propre exporteur DXF écrivait « 4.0 »), et
plus aucune unité n'est supposée sans **constat** (`insunits_detail`).

Les facteurs sont EXACTS par définition (le pouce VAUT 25,4 mm), pas ceux de
`ezdxf.units.METER_FACTOR` qui sont arrondis (1000/39.37007874 =
25,400000000101603). Le miroir Rust (`nest-import::units`) porte les mêmes
valeurs et les mêmes noms — c'est la parité des deux importeurs qui compte.
"""

from worker_common.logger import setup_logger

logger = setup_logger("units")

# $INSUNITS code -> multiplication factor to millimeters (exact).
INSUNITS_TO_MM = {
    1: 25.4,                        # inches
    2: 304.8,                       # feet
    3: 1609344.0,                   # miles
    4: 1.0,                         # millimeters
    5: 10.0,                        # centimeters
    6: 1000.0,                      # meters
    7: 1.0e6,                       # kilometers
    8: 2.54e-5,                     # microinches
    9: 0.0254,                      # mils (thousandths of an inch)
    10: 914.4,                      # yards
    11: 1.0e-7,                     # angstroms
    12: 1.0e-6,                     # nanometers
    13: 1.0e-3,                     # microns
    14: 100.0,                      # decimeters
    15: 10000.0,                    # decameters
    16: 100000.0,                   # hectometers
    17: 1.0e12,                     # gigameters
    18: 1.495978707e14,             # astronomical units (SI exact)
    19: 9.4607304725808e18,         # light years (SI exact)
    20: 3.0856775814913673e19,      # parsecs (SI exact)
}

# Identifiant canonique de l'unité — MÊMES chaînes que nest-import::units
# (le verrou de parité compare `unitDetected` entre les deux importeurs).
INSUNITS_NAME = {
    0: "unitless",
    1: "inch",
    2: "foot",
    3: "mile",
    4: "mm",
    5: "cm",
    6: "m",
    7: "km",
    8: "microinch",
    9: "mil",
    10: "yard",
    11: "angstrom",
    12: "nanometer",
    13: "micron",
    14: "decimeter",
    15: "decameter",
    16: "hectometer",
    17: "gigameter",
    18: "au",
    19: "lightyear",
    20: "parsec",
}

INSUNITS_MM = 4
MEASUREMENT_METRIC = 1

MM_PER_INCH = 25.4

# Au-delà de ce facteur (10 m par unité), l'unité déclarée ne peut pas être
# celle d'une pièce de tôlerie : la conversion reste EXACTE (jamais un repli
# silencieux sur le millimètre), mais elle est annoncée.
IMPLAUSIBLE_FACTOR_MM = 1.0e4


def output_scale_and_headers(output_unit: str):
    """
    (scale factor FROM mm, $INSUNITS, $MEASUREMENT) for result DXF export.

    Geometry is computed in canonical mm and converted only at this export
    boundary, full precision — never round geometry. Inches get
    $MEASUREMENT=0 (imperial) so both headers agree with the numbers.
    Unknown units fall back to mm (safe default for legacy jobs).
    """
    if output_unit == "inch":
        return 1.0 / MM_PER_INCH, 1, 0
    return 1.0, INSUNITS_MM, MEASUREMENT_METRIC


def unit_name(code: int) -> str:
    """Identifiant canonique de l'unité d'un code $INSUNITS."""
    return INSUNITS_NAME.get(code, "unknown")


def insunits_code(doc) -> int:
    """Declared $INSUNITS of a DXF document (0 = unitless / missing).

    TOLÉRANT AU FLOTTANT (lot 2b) : le code 70 est un entier par la spec,
    mais des producteurs l'écrivent « 4.0 » — dont notre propre exporteur DXF
    jusqu'au lot 2b. `int("4.0")` lève, et le repli valait « sans unité ».
    """
    try:
        raw = doc.header.get("$INSUNITS", 0)
    except Exception:
        return 0
    if raw is None or raw == "":
        return 0
    try:
        return int(raw)
    except (TypeError, ValueError):
        pass
    try:
        return int(round(float(str(raw).strip())))
    except (TypeError, ValueError):
        return 0


def insunits_detail(doc):
    """(code, nom canonique, facteur vers mm, constats) — lot 2b.

    Les textes des constats sont IDENTIQUES à ceux du miroir Rust
    (`nest-import::dxf::canonical`) : les deux importeurs disent la même
    chose du même fichier. La mise en forme utilisateur (FR/EN, niveau
    d'alerte) est le lot 2c.
    """
    code = insunits_code(doc)
    warnings = []
    if code in (0, INSUNITS_MM):
        factor = 1.0
        if code == 0:
            warnings.append("$INSUNITS missing or 0 — assuming millimeters")
        return code, unit_name(code), factor, warnings
    factor = INSUNITS_TO_MM.get(code)
    if factor is None:
        warnings.append(f"unknown $INSUNITS={code} — assuming millimeters")
        return code, unit_name(code), 1.0, warnings
    if factor >= IMPLAUSIBLE_FACTOR_MM:
        warnings.append(
            f"$INSUNITS={code} ({unit_name(code)}) — geometry scaled "
            f"x{factor:g} to mm"
        )
    return code, unit_name(code), factor, warnings


def insunits_to_mm(doc) -> float:
    """
    Multiplication factor converting the document's drawing units to mm.
    Unitless (0) or unknown codes fall back to 1.0 — i.e. treated as mm,
    which is the historical behaviour for every file uploaded so far.
    """
    code, name, factor, warnings = insunits_detail(doc)
    for message in warnings:
        logger.warning(message)
    if factor != 1.0:
        logger.info(
            f"DXF declared $INSUNITS={code} ({name}) -> scaling geometry "
            f"x{factor:g} to mm."
        )
    return factor
