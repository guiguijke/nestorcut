"""Unit tests for worker_common.geometry.units ($INSUNITS normalization)."""
import sys
from pathlib import Path

import ezdxf
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from worker_common.geometry.units import (
    insunits_code,
    insunits_to_mm,
    output_scale_and_headers,
)


def _doc_with_insunits(code):
    doc = ezdxf.new()
    if code is None:
        # Simulate a header without the variable at all.
        try:
            del doc.header["$INSUNITS"]
        except Exception:
            pass
    else:
        doc.header["$INSUNITS"] = code
    return doc


@pytest.mark.parametrize(
    "code,expected",
    [
        (0, 1.0),          # unitless -> historical mm behaviour
        (1, 25.4),         # inches
        (2, 304.8),        # feet
        (4, 1.0),          # millimeters
        (5, 10.0),         # centimeters
        (6, 1000.0),       # meters
        (8, 2.54e-5),      # microinches
        (9, 0.0254),       # mils
        (99, 1.0),         # unknown code -> mm + warning
        (None, 1.0),       # missing variable -> mm
    ],
)
def test_insunits_to_mm(code, expected):
    assert insunits_to_mm(_doc_with_insunits(code)) == pytest.approx(expected)


def test_insunits_code_reads_header():
    assert insunits_code(_doc_with_insunits(1)) == 1
    assert insunits_code(_doc_with_insunits(0)) == 0


def test_output_scale_and_headers_mm():
    scale, insunits, measurement = output_scale_and_headers("mm")
    assert scale == 1.0
    assert insunits == 4
    assert measurement == 1


def test_output_scale_and_headers_inch():
    scale, insunits, measurement = output_scale_and_headers("inch")
    assert scale == pytest.approx(1.0 / 25.4)
    assert insunits == 1
    assert measurement == 0


def test_output_scale_and_headers_unknown_defaults_mm():
    # Legacy jobs without outputUnit, or unexpected values, must export mm.
    assert output_scale_and_headers(None) == output_scale_and_headers("mm")
    assert output_scale_and_headers("cubits") == output_scale_and_headers("mm")


# --------------------------------------------------------------- lot 2b
# Table complète 0-20, code écrit en flottant, et constats d'unité :
# `docs/PLAN-IMPORT-2026-09-09.md` §9.2. Les valeurs doivent être EXACTEMENT
# celles du miroir Rust (nest-import/src/units.rs) — mêmes facteurs, mêmes
# noms, mêmes textes de constat.
from worker_common.geometry.units import (  # noqa: E402
    IMPLAUSIBLE_FACTOR_MM,
    INSUNITS_TO_MM,
    insunits_detail,
    unit_name,
)


@pytest.mark.parametrize(
    "code,expected",
    [
        (3, 1609344.0),             # miles
        (7, 1.0e6),                 # kilometers
        (10, 914.4),                # yards
        (11, 1.0e-7),               # angstroms
        (12, 1.0e-6),               # nanometers
        (13, 1.0e-3),               # microns
        (14, 100.0),                # decimeters
        (15, 10000.0),              # decameters
        (16, 100000.0),             # hectometers
        (17, 1.0e12),               # gigameters
        (18, 1.495978707e14),       # astronomical units
        (19, 9.4607304725808e18),   # light years
        (20, 3.0856775814913673e19),  # parsecs
    ],
)
def test_codes_that_were_read_x1_now_convert(code, expected):
    """Avant le lot 2b, ces treize codes n'étaient pas dans la table : le
    facteur valait 1.0 et le dessin était lu au millimètre, en silence."""
    assert INSUNITS_TO_MM[code] == expected
    assert insunits_to_mm(_doc_with_insunits(code)) == expected


def test_the_whole_table_zero_to_twenty_is_covered():
    for code in range(1, 21):
        assert code in INSUNITS_TO_MM, f"code {code} absent = x1 silencieux"
        assert unit_name(code) != "unknown", f"code {code} sans nom"
    assert unit_name(0) == "unitless"
    # Facteurs EXACTS, pas ceux (arrondis) de ezdxf.units.METER_FACTOR.
    assert INSUNITS_TO_MM[1] == 25.4 != 1000.0 / 39.37007874


class _StubHeader(dict):
    """Header minimal : ezdxf VALIDE ce qu'on lui pose par API (il refuse la
    chaîne « 1.0 »), mais son LECTEUR de fichier, lui, tolère le flottant et
    rend déjà un entier. Le bug du flottant était donc côté Rust seulement ;
    la tolérance Python est une ceinture, et c'est elle qu'on verrouille
    ici — sans passer par l'API qui valide."""

    def get(self, key, default=None):
        return dict.get(self, key, default)


class _StubDoc:
    def __init__(self, raw):
        self.header = _StubHeader({"$INSUNITS": raw})


def test_a_float_written_code_is_accepted():
    """Le code 70 est un entier par la spec ; notre propre exporteur DXF
    écrivait « 4.0 » jusqu'au lot 2b, et le repli valait « sans unité » —
    donc un export en POUCES relu x1 au lieu de x25,4 (côté navigateur)."""
    assert insunits_code(_StubDoc("1.0")) == 1
    assert insunits_to_mm(_StubDoc("1.0")) == 25.4
    assert insunits_code(_StubDoc("4.0")) == 4
    assert insunits_code(_StubDoc(4.0)) == 4
    assert insunits_code(_StubDoc(1)) == 1
    assert insunits_code(_StubDoc("pas un nombre")) == 0
    assert insunits_code(_StubDoc(None)) == 0


def test_no_unit_is_ever_assumed_in_silence():
    # absent / 0 -> constat
    code, name, factor, warnings = insunits_detail(_doc_with_insunits(0))
    assert (code, name, factor) == (0, "unitless", 1.0)
    assert warnings == ["$INSUNITS missing or 0 — assuming millimeters"]
    # mm déclaré -> rien à dire
    assert insunits_detail(_doc_with_insunits(4))[3] == []
    # pouces -> conversion exacte, rien à dire (l'unité EST déclarée)
    code, name, factor, warnings = insunits_detail(_doc_with_insunits(1))
    assert (name, factor, warnings) == ("inch", 25.4, [])
    # code hors table -> constat d'inconnu
    code, name, factor, warnings = insunits_detail(_doc_with_insunits(99))
    assert (name, factor) == ("unknown", 1.0)
    assert warnings == ["unknown $INSUNITS=99 — assuming millimeters"]
    # unité invraisemblable pour de la tôle -> convertie EXACTEMENT, annoncée
    code, name, factor, warnings = insunits_detail(_doc_with_insunits(7))
    assert (name, factor) == ("km", 1.0e6)
    assert factor >= IMPLAUSIBLE_FACTOR_MM
    assert warnings == ["$INSUNITS=7 (km) — geometry scaled x1e+06 to mm"]
