"""Verrous du lot 2c — les constats d'import côté Python, et la PARITÉ de la
table matière/bruit avec le miroir Rust (`nest-import/src/findings.rs`).

Deux listes qui divergent, et le même fichier serait « attention » sur un
chemin et « info » sur l'autre : c'est l'écart que le lot D a mesuré sur
vingt fichiers. Le test lit le fichier Rust — pas une copie.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from worker_common.geometry.import_findings import (
    LEVEL_ATTENTION,
    LEVEL_INFO,
    MATERIAL_ENTITIES,
    NOISE_ENTITIES,
    build_findings,
    empty_stats,
    is_material,
)

RUST = (Path(__file__).parents[3] / "workers" / "geometry" / "crates"
        / "nest-import" / "src" / "findings.rs")


def _rust_table(name):
    text = RUST.read_text(encoding="utf-8")
    m = re.search(name + r": &\[&str\] = &\[(.*?)\];", text, re.S)
    assert m, f"table {name} introuvable dans {RUST}"
    return tuple(re.findall(r'"([^"]+)"', m.group(1)))


class TestParityWithRust:
    def test_the_material_and_noise_tables_are_the_same_on_both_sides(self):
        assert MATERIAL_ENTITIES == _rust_table("MATERIAL_ENTITIES")
        assert NOISE_ENTITIES == _rust_table("NOISE_ENTITIES")

    def test_an_unknown_entity_counts_as_material_on_both_sides(self):
        # Règle 2 du module : on ne sait pas ce qu'on jette, donc on le dit.
        assert is_material("WHATEVER_NEW_ENTITY")
        assert is_material("HATCH")
        assert not is_material("TEXT")
        assert not is_material("dimension")  # insensible à la casse
        rust = RUST.read_text(encoding="utf-8")
        assert "compte comme de la MATIÈRE" in rust


class TestFindings:
    def test_a_clean_file_says_nothing(self):
        assert build_findings(empty_stats()) == []
        assert build_findings(None) == []

    def test_material_loss_is_attention_with_its_count_and_types(self):
        stats = {**empty_stats(), "skipped": {"HATCH": 2, "TEXT": 5, "REGION": 3}}
        out = build_findings(stats)
        first = out[0]
        assert first["code"] == "import.entitiesSkipped"
        assert first["level"] == LEVEL_ATTENTION
        assert first["count"] == 5           # 2 HATCH + 3 REGION
        assert first["types"] == ["REGION", "HATCH"]   # les plus gros d'abord
        noise = [f for f in out if f["code"] == "import.annotationsSkipped"][0]
        assert (noise["level"], noise["count"]) == (LEVEL_INFO, 5)

    def test_attention_comes_before_info(self):
        stats = {**empty_stats(), "danglingPaths": 12, "blocksFlattened": 3,
                 "splines": 4, "skipped": {"TEXT": 1}}
        levels = [f["level"] for f in build_findings(stats)]
        first_info = levels.index(LEVEL_INFO)
        assert all(l == LEVEL_ATTENTION for l in levels[:first_info]), levels
        assert build_findings(stats)[0]["code"] == "import.contoursDropped"

    def test_implausible_unit_is_attention_not_info(self):
        km = {**empty_stats(), "insunits": 7, "unitFactor": 1.0e6}
        out = build_findings(km)
        assert out[0]["code"] == "import.unitImplausible"
        assert out[0]["level"] == LEVEL_ATTENTION
        assert out[0]["value"] == "km"
        assert all(f["code"] != "import.unitConverted" for f in out)
        inch = {**empty_stats(), "insunits": 1, "unitFactor": 25.4}
        assert build_findings(inch)[0]["code"] == "import.unitConverted"
        assert build_findings(inch)[0]["level"] == LEVEL_INFO

    def test_unknown_unit_names_its_code(self):
        out = build_findings({**empty_stats(), "insunits": 42, "unitUnknown": True})
        assert out[0]["code"] == "import.unitUnknown"
        assert out[0]["level"] == LEVEL_ATTENTION
        assert out[0]["value"] == "42"

    def test_dropped_parts_are_attention(self):
        out = build_findings({**empty_stats(), "droppedParts": 3})
        assert out == [{"code": "import.partsDropped", "level": LEVEL_ATTENTION, "count": 3}]

    # --- Lot E2 : la mise à l'échelle demandée à la dépose -----------------

    def test_scale_applied_is_info_with_the_factor_as_value(self):
        out = build_findings({**empty_stats(), "scaleApplied": 2.5})
        assert out == [{"code": "import.scaleApplied", "level": LEVEL_INFO,
                        "count": 1, "value": "2.5"}]

    def test_scale_applied_writes_the_value_like_javascript(self):
        # Le navigateur écrit `String(Math.round(f*1e4)/1e4)` : un entier sort
        # SANS « .0 ». Deux textes différents pour le même facteur seraient un
        # écart visible à l'écran entre le chemin local et le chemin serveur.
        assert build_findings({**empty_stats(), "scaleApplied": 5.0})[0]["value"] == "5"
        assert build_findings({**empty_stats(), "scaleApplied": 0.25})[0]["value"] == "0.25"
        # Arrondi à quatre décimales, comme au navigateur.
        rounded = build_findings({**empty_stats(), "scaleApplied": 1 / 3})[0]["value"]
        assert rounded == "0.3333"

    def test_scale_of_one_says_nothing(self):
        # Aucune mise à l'échelle demandée : pas de constat (et l'absence du
        # champ sur un fichier d'avant le lot E2 ne doit rien casser).
        assert build_findings(empty_stats()) == []
        assert build_findings({**empty_stats(), "scaleApplied": 1.0}) == []
        stats = empty_stats()
        del stats["scaleApplied"]
        assert build_findings(stats) == []
