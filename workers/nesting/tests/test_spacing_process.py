"""nesting_process avec un VRAI disque (statistiques d'écart remplies, aucun
bouchon de convert_files_to_input_items) : la configuration du moteur reçoit
l'espacement INTERNE, verify_layout reçoit le DEMANDÉ et la marge."""
import math
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "common"))

sys.modules.setdefault(
    "worker_common.mongo",
    types.SimpleNamespace(db=None, get_bucket=lambda name: None),
)

import core.main as m


def _disc(r, n=160):
    pts = [[r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n)] for i in range(n)]
    return pts + [pts[0]]


class _Coll:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def update_one(self, flt, update, *a, **kw):
        doc = next((d for d in self.docs
                    if d.get("_id") == flt.get("_id") or d.get("slug") == flt.get("slug")),
                   self.docs[0] if self.docs else None)
        if doc is None:
            return
        for k, v in update.get("$set", {}).items():
            t = doc
            parts = k.split(".")
            for p in parts[:-1]:
                t = t.setdefault(p, {})
            t[parts[-1]] = v
        for k in update.get("$unset", {}):
            doc.pop(k, None)

    def find_one(self, flt, *a, **kw):
        return next((d for d in self.docs
                     if all(d.get(k) == v for k, v in flt.items())), {"slug": flt.get("slug")})

    def insert_one(self, *a, **kw):
        return None


class _Db(dict):
    def __getitem__(self, name):
        if name not in self:
            self[name] = _Coll()
        return dict.__getitem__(self, name)


def test_engine_gets_internal_and_verify_layout_gets_requested(monkeypatch):
    monkeypatch.setenv("NEST_REVEAL_STEP_SEC", "0")
    ring = _disc(50)
    doc = {
        "_id": "job-sp", "slug": "sp-1", "projectSlug": "p1", "ownerId": "u1",
        "status": "processing",
        "files": [{"slug": "disc", "count": 2, "rotations": [0.0]}],
        "params": {"sheets": [{"width": 1000.0, "height": 1000.0, "count": 1}],
                   "space": 2.0, "fillHoles": True, "timeBudgetSec": 3,
                   "alternativesCount": 1, "directions": ["left"], "vcores": 1},
    }
    jobs = _Coll([doc])
    monkeypatch.setattr(m, "db", _Db(nesting_jobs=jobs))
    monkeypatch.setattr(m, "get_dek", lambda db, owner: None)
    # Seule la lecture des polygones est remplacée : la conversion, la
    # simplification et les statistiques d'écart sont les VRAIES.
    monkeypatch.setattr(m, "resolve_polygon_parts", lambda db_, d, dek: [
        {"coordinates": ring, "holes": [], "handles": ["A"], "color": None}])

    seen = {}

    def fake_run_engine(instance, config, problem_type, on_event=None,
                        should_cancel=None, **kw):
        seen["config"] = config
        return [{
            "rank": 0, "seed": 1, "bias": "left", "iterations": 1,
            "evaluations": 1, "used_height": 100.0, "finish": None,
            "solution": {"layouts": [{"container_id": 0, "placed_items": [
                {"item_id": 0, "transformation": {"rotation": 0.0, "translation": [100.0, 100.0]}},
                {"item_id": 0, "transformation": {"rotation": 0.0, "translation": [300.0, 100.0]}},
            ]}], "density": 0.1, "cost": 1, "strip_width": 400.0},
            "metrics": {"density": 0.1, "cost": 1, "strip_width": 400.0, "layout_count": 1},
        }]

    monkeypatch.setattr(m, "run_engine", fake_run_engine)

    calls = []
    real_verify = m.verify_layout

    def spy_verify(containers, input_items, space=0.0, margin=0.0):
        calls.append((space, margin))
        return real_verify(containers, input_items, space, margin)

    monkeypatch.setattr(m, "verify_layout", spy_verify)

    try:
        m.nesting_process(doc)
    except Exception:
        # La suite (export, enregistrement) n'est pas l'objet du test ; ce
        # qui compte est ce que le moteur et la vérification ont reçu.
        pass

    internal = seen["config"]["min_item_separation"]
    margin = internal - 2.0
    assert 0 < margin <= 0.12
    assert calls, "verify_layout n'a pas été appelé"
    for space, m_ in calls:
        assert space == 2.0  # le DEMANDÉ, jamais l'interne
        assert m_ == pytest.approx(margin, abs=1e-9)
