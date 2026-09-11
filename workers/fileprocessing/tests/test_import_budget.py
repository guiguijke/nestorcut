"""Verrous du lot 2a (`docs/PLAN-IMPORT-2026-09-09.md` §9.2) — les bornes
d'import du worker : plafond d'entités à 10 000 et budget de temps de 60 s
(20 s au navigateur : le budget est une propriété de l'implémentation qui
lit, pas du fichier — arbitrage du 12/09, §9.5 du plan).

Le verdict d'aucun verrou ne dépend de la vitesse de la machine : le budget
est prouvé par un budget NUL (toute mesure le dépasse) sur un dessin que le
budget par défaut lit sans erreur.
"""
import sys
from pathlib import Path

import ezdxf
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.geometry.build_geometry import build_geometry
from core.import_budget import (
    MAX_ENTITY_LIMIT_DEFAULT,
    REASON_ENTITIES,
    REASON_TIME,
    TIME_BUDGET_S_DEFAULT,
    Deadline,
    ImportTooHeavy,
    max_entity_limit_from_env,
    time_budget_s_from_env,
)
from worker_common.geometry.dxf_bounds import MAX_DECOMPOSED_ENTITIES


def _drawing(n=40):
    """n carrés disjoints de 10 mm — n pièces, n entités."""
    doc = ezdxf.new()
    doc.header["$INSUNITS"] = 4
    msp = doc.modelspace()
    for i in range(n):
        x = (i % 20) * 20.0
        y = (i // 20) * 20.0
        msp.add_lwpolyline(
            [(x, y), (x + 10, y), (x + 10, y + 10), (x, y + 10)], close=True
        )
    return doc


class TestLimits:
    def test_defaults_are_the_documented_ones(self):
        assert MAX_ENTITY_LIMIT_DEFAULT == 10000
        # 60 s côté worker, 20 s côté navigateur (geometryClient) : le
        # plafond d'entités est partagé, le budget de temps non.
        assert TIME_BUDGET_S_DEFAULT == 60.0
        # Le plafond DUR d'expansion vaut 10 × le plafond fonctionnel, comme
        # `Limits::expansion_ceiling` en Rust : le refus peut annoncer le
        # nombre exact d'entités.
        assert MAX_DECOMPOSED_ENTITIES == 10 * MAX_ENTITY_LIMIT_DEFAULT

    def test_env_overrides_both_limits(self, monkeypatch):
        monkeypatch.setenv("MAX_ENTITY_LIMIT", "1234")
        monkeypatch.setenv("IMPORT_TIME_BUDGET_S", "3.5")
        assert max_entity_limit_from_env() == 1234
        assert time_budget_s_from_env() == 3.5

    def test_no_budget_never_expires(self):
        d = Deadline(0)
        d.check()
        d.check(0)
        assert not d.expired()


class TestDeadline:
    def test_a_null_budget_stops_build_geometry(self):
        doc = _drawing(40)
        # Budget par défaut : le dessin est lu.
        parts = build_geometry(doc, 0.01, deadline=Deadline(TIME_BUDGET_S_DEFAULT))
        assert len(parts) == 40
        # Budget nul mesurable (1 µs) : le travail s'arrête, avec ses chiffres.
        with pytest.raises(ImportTooHeavy) as exc:
            build_geometry(doc, 0.01, deadline=Deadline(1e-6, entity_count=40))
        heavy = exc.value
        assert heavy.reason == REASON_TIME
        assert heavy.entity_count == 40
        assert heavy.as_dict()["timeBudgetMs"] == 0
        assert heavy.as_dict()["reason"] == "time"

    def test_deadline_is_sampled_like_the_rust_side(self):
        d = Deadline(1e-6)
        # Hors multiple de STRIDE : aucun contrôle (le coût d'horloge est
        # amorti sur la boucle chaude, comme Deadline::STRIDE en Rust).
        d.check(1)
        with pytest.raises(ImportTooHeavy):
            d.check(Deadline.STRIDE)

    def test_without_deadline_build_geometry_is_unchanged(self):
        doc = _drawing(12)
        assert len(build_geometry(doc, 0.01)) == 12


class TestRefusalPayload:
    def test_entity_refusal_carries_the_count_and_the_cap(self):
        heavy = ImportTooHeavy(REASON_ENTITIES, entity_count=12345, max_entities=10000)
        assert heavy.as_dict() == {
            "reason": "entities",
            "entityCount": 12345,
            "maxEntities": 10000,
        }
        assert "12345" in str(heavy)
        assert "10000" in str(heavy)
