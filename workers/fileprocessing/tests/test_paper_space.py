"""Espace papier côté serveur : ezdxf ne le met pas dans `modelspace()`, donc il
n'a jamais fait de pièce ici. Le défaut était le silence : un cadre écarté sans le
dire, et un dessin entièrement en espace papier qui ressortait vide.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import core.main as main_mod  # noqa: E402
from core.geometry.build_geometry import build_geometry  # noqa: E402
from dxf_utils import PAPER_SPACE_ONLY, PaperSpaceOnly, read_dxf, read_dxf_file  # noqa: E402

CORPUS = Path(__file__).parents[2] / "geometry" / "parity" / "corpus_extra"


@pytest.mark.parametrize("name,paper", [
    ("paperspace_r12.dxf", 5),
    ("paperspace_r2000.dxf", 5),
    ("paperspace_r2010.dxf", 10),
])
def test_paper_space_is_skipped_and_counted(name, paper):
    drawing = read_dxf_file(str(CORPUS / name))
    assert drawing.import_stats["paperSpaceSkipped"] == paper
    assert len(drawing.modelspace()) == 5
    parts = build_geometry(drawing, 0.01)
    assert len(parts) == 1


@pytest.mark.parametrize("name", ["paperspace_only_r12.dxf", "paperspace_only_r2010.dxf"])
def test_a_drawing_entirely_in_paper_space_is_refused(name):
    with pytest.raises(PaperSpaceOnly) as exc:
        read_dxf_file(str(CORPUS / name))
    assert exc.value.entities == 5


def test_a_copy_written_by_the_pipeline_is_not_refused_on_reread(tmp_path):
    # La relecture de la copie canonique n'a plus d'espace papier : son compte vaut
    # 0, d'où le champ du document pour que le constat survive à cette relecture.
    drawing = read_dxf_file(str(CORPUS / "paperspace_r2010.dxf"))
    path = tmp_path / "copy.dxf"
    drawing.saveas(path)
    with open(path, "rb") as f:
        again = read_dxf(f, normalize_units=False)
    assert again.import_stats["paperSpaceSkipped"] == 0


def test_the_worker_records_the_reason_of_the_refusal(monkeypatch):
    # Le vrai chemin : _make_dxf_copy pose `importErrorCode`, lu par la carte.
    doc = {"_id": 1, "slug": "s", "ownerId": "u", "isDxfCopyExist": False}
    data = (CORPUS / "paperspace_only_r2010.dxf").read_bytes()
    recorded = []
    monkeypatch.setattr(main_mod, "get_dek", lambda *a, **k: None)
    monkeypatch.setattr(main_mod, "read_gridfs", lambda *a, **k: data)
    monkeypatch.setattr(main_mod, "_record_import_error", lambda d, code: recorded.append(code))
    with pytest.raises(PaperSpaceOnly):
        main_mod._make_dxf_copy(doc)
    assert recorded == [PAPER_SPACE_ONLY]


def test_the_finding_survives_the_reread_of_the_canonical_copy(monkeypatch):
    # Le constat est porté par le document fichier entre la copie et l'assemblage :
    # _getting_drawing relit une copie déjà nettoyée, qui ne sait plus rien.
    doc = {"_id": 1, "slug": "s2", "ownerId": "u", "isDxfCopyExist": False, "flattening": 0.01}
    data = (CORPUS / "paperspace_r2010.dxf").read_bytes()
    written = {}
    monkeypatch.setattr(main_mod, "get_dek", lambda *a, **k: None)
    monkeypatch.setattr(main_mod, "read_gridfs",
                        lambda bucket, slug, owner, dek: written.get("copy", data))
    monkeypatch.setattr(main_mod, "write_gridfs",
                        lambda bucket, slug, payload, owner, dek: written.__setitem__("copy", payload))
    main_mod._drawing_cache.clear()
    main_mod._make_dxf_copy(doc)
    assert doc["paperSpaceSkipped"] == 10
    _, parts = main_mod._close_polygon_from_dxf(doc, "test")
    assert len(parts) == 1
    report = [c.args[1]["$set"]["importReport"] for c in main_mod.db["user_dxf_files"].update_one.call_args_list
              if "importReport" in c.args[1].get("$set", {})][-1]
    codes = {f["code"]: f["count"] for f in report["findings"]}
    assert codes["import.paperSpaceSkipped"] == 10
