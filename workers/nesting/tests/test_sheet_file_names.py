"""Verrou : les fichiers de sortie par tôle sont numérotés 1..N, contigus,
dans l'ordre des tôles — `{slug}_alt{rank}_part_{N}.dxf/.svg`.

Le verrou Free (lot V1) lit le numéro de tôle dans ce nom
(`shared/constants/sheetDownload.constants.js`) : une numérotation décalée
ou dupliquée verrouille les mauvaises tôles.

Cas : un format `count: 0` AVANT ou ENTRE les formats actifs. Le C13 le
filtre avant le moteur (ids moteur consécutifs) ; le V15 retraduisait
ensuite `container_id` via `container_map_back` (clé = id MOTEUR 0-based)
alors que `parse_result_containers` y met le rang 1-based de la tôle —
formats [A×0, B×2, C×1] ⇒ _part_2, _part_2, _part_3 (tôle 1 écrasée par
la 2) ; [B×2, A×0, C×1] ⇒ idem.

Run: PYTHONPATH=workers/common:workers/nesting python -m pytest workers/nesting/tests/test_sheet_file_names.py -q
"""
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "common"))

# worker_common.mongo se connecte à l'import — stub avant core.main.
sys.modules.setdefault(
    "worker_common.mongo",
    types.SimpleNamespace(db=None, get_bucket=lambda name: None),
)

import core.main as m


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def update_one(self, filter, update, *a, **kw):
        doc = next((d for d in self.docs if d.get("_id") == filter.get("_id")
                    or d.get("slug") == filter.get("slug")),
                   self.docs[0] if self.docs else None)
        if doc is None:
            return
        for k, v in update.get("$set", {}).items():
            parts = k.split(".")
            t = doc
            for p in parts[:-1]:
                t = t.setdefault(p, {})
            t[parts[-1]] = v
        for k in update.get("$unset", {}).keys():
            doc.pop(k, None)

    def find_one(self, filter, *a, **kw):
        return next((d for d in self.docs if d.get("_id") == filter.get("_id")), None)


class FakeDb(dict):
    def __getitem__(self, name):
        if name not in self:
            self[name] = FakeCollection()
        return dict.__getitem__(self, name)


def _sq(s):
    return [[-s, -s], [s, -s], [s, s], [-s, s], [-s, -s]]


def _pose(x, y):
    return {"item_id": 0, "transformation": {"rotation": 0.0, "translation": [x, y]}}


_A_EMPTY = {"width": 800.0, "height": 800.0, "count": 0}
_B = {"width": 1000.0, "height": 1000.0, "count": 2}
_C = {"width": 1200.0, "height": 1200.0, "count": 1}


# A (vide) filtré, ids moteur 0→B, 1→C dans les deux cas.
@pytest.mark.parametrize("sheets", [[_A_EMPTY, _B, _C], [_B, _A_EMPTY, _C]],
                         ids=["empty-first", "empty-middle"])
def test_empty_format_keeps_sheet_files_numbered_1_to_n(monkeypatch, sheets):
    monkeypatch.setenv("NEST_REVEAL_STEP_SEC", "0")
    doc = {
        "_id": "job-names", "slug": "names-1", "projectSlug": "p1",
        "ownerId": "u1", "status": "processing",
        "files": [{"slug": "sq", "count": 3, "rotations": [0.0]}],
        "params": {
            "sheets": [dict(s) for s in sheets],
            "space": 2.0, "fillHoles": True, "timeBudgetSec": 3,
            "alternativesCount": 1, "directions": ["left"], "vcores": 1,
        },
    }
    jobs = FakeCollection([doc])
    monkeypatch.setattr(m, "db", FakeDb(nesting_jobs=jobs))
    monkeypatch.setattr(m, "get_dek", lambda db, owner: None)
    monkeypatch.setattr(
        m, "convert_files_to_input_items",
        # Carré 900 mm : une pièce par tôle, rien à consolider.
        lambda files, dek: [
            {"id": 0, "file_slug": "sq", "coords": _sq(450.0), "holes": [],
             "handles": [], "color": None, "count": 3, "rotations": [0.0]},
        ],
    )
    seen = {}

    def fake_run_engine(instance, config, problem_type, on_event=None,
                        should_cancel=None, **kw):
        seen["problem"] = problem_type
        seen["bins"] = [(b["id"], b["stock"]) for b in instance["bins"]]
        # Tôles 1-2 sur B (moteur 0), tôle 3 sur C (moteur 1).
        layouts = [
            {"container_id": 0, "placed_items": [_pose(500.0, 500.0)]},
            {"container_id": 0, "placed_items": [_pose(500.0, 500.0)]},
            {"container_id": 1, "placed_items": [_pose(600.0, 600.0)]},
        ]
        return [{
            "rank": 0, "seed": 1, "bias": "left", "iterations": 1,
            "evaluations": 1, "finish": None,
            "solution": {"layouts": layouts, "density": 0.7, "cost": 3},
            "metrics": {"density": 0.7, "cost": 3, "layout_count": 3},
        }]

    monkeypatch.setattr(m, "run_engine", fake_run_engine)
    # Pas de GridFS : on garde la vraie build_result_dxf_files (le nommage
    # vit là) et on capture seulement les écritures.
    monkeypatch.setattr(m, "build_part", lambda *a, **kw: object())
    written = []
    monkeypatch.setattr(m, "save_dxf_result",
                        lambda owner, name, drawing, dek=None: written.append(name))
    monkeypatch.setattr(m, "save_svg_result",
                        lambda owner, name, *a, **kw: written.append(name))

    m.nesting_process(jobs.docs[0])

    # Le C13 a bien filtré A : deux bins moteur consécutifs.
    assert seen["problem"] == "bpp"
    assert seen["bins"] == [(0, 2), (1, 1)]
    assert doc["status"] != "error", doc.get("information")
    # L'alternative moteur est le rang 0 (une grille éventuelle vient après).
    engine_alt = next(a for a in doc["alternatives"] if a["strategy"] == "left")
    assert engine_alt["dxf_files"] == [f"names-1_alt0_part_{i}.dxf" for i in (1, 2, 3)]
    assert engine_alt["svg_files"] == [f"names-1_alt0_part_{i}.svg" for i in (1, 2, 3)]
    # Les tôles restent dans l'ordre du moteur : 2 × B puis C.
    dims = [(s.get("widthMm"), s.get("heightMm"))
            for s in engine_alt["report"]["sheets"]]
    assert dims == [(1000.0, 1000.0), (1000.0, 1000.0), (1200.0, 1200.0)]
    # Aucun fichier écrasé dans GridFS.
    assert len(written) == len(set(written))
