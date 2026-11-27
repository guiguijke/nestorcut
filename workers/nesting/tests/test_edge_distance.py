"""Distance au bord sur les projets « Nos serveurs » (piège 68 de AGENTS.md).

Le serveur route un calcul avec distance au bord vers le navigateur
(`computeLocation == "local"`) ; le worker ne fait que PRÉPARER le payload
moteur, qui doit être identique au bit près à celui de `buildLocalPayload`
(app/composables/localPayloadBuilder.js), refus compris.

Run: PYTHONPATH=workers/common:workers/nesting python -m pytest workers/nesting/tests/test_edge_distance.py -q
"""
import copy
import json
import math
import struct
import sys
import types
from pathlib import Path

import pytest
from _pytest.monkeypatch import MonkeyPatch

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "common"))

# worker_common.mongo se connecte à l'import : on le remplace avant main.
sys.modules.setdefault(
    "worker_common.mongo",
    types.SimpleNamespace(db=None, get_bucket=lambda name: None),
)

import core.main as m
from core import edge as E

PARITY_FILE = Path(__file__).parent / "fixtures" / "edge_payload_parity.json"


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])
        self.sets = []
        self.unsets = []

    def update_one(self, filter, update, *a, **kw):
        doc = next((d for d in self.docs
                    if d.get("_id") == filter.get("_id") or d.get("slug") == filter.get("slug")),
                   self.docs[0] if self.docs else None)
        if doc is None:
            return
        for k, v in update.get("$set", {}).items():
            doc[k] = v
        for k in update.get("$unset", {}).keys():
            self.unsets.append(k)
            doc.pop(k, None)
        self.sets.append(update.get("$set", {}))

    def find_one(self, filter, *a, **kw):
        return next((d for d in self.docs
                     if all(d.get(k) == v for k, v in filter.items())), None)


class FakeDb(dict):
    def __getitem__(self, name):
        if name not in self:
            self[name] = FakeCollection()
        return dict.__getitem__(self, name)


def rect(w, h):
    return [[0, 0], [w, 0], [w, h], [0, h], [0, 0]]


def make_file(slug, name, count, w, h, rotations=(0, 90, 180, 270), color=None):
    """Entrée « fichier » au format du constructeur JS (une pièce, sans trou)."""
    return {
        "slug": slug, "name": name, "count": count, "rotations": list(rotations),
        "parts": [{"coordinates": rect(w, h), "holes": [], "width": w, "height": h,
                   "handles": ["A1"], "color": color}],
    }


def make_input(files, sheets, space=2, edge=None, directions=None,
               alternatives=1, budget=13):
    params = {
        "sheets": sheets, "space": space, "fillHoles": True, "addOutShape": False,
        "outputUnit": "mm", "alternativesCount": alternatives,
    }
    if directions:
        params["directions"] = directions
    if edge is not None:
        params["edgeDistance"] = edge
    return {"files": files, "params": params,
            "profile": {"timeBudgetSec": budget, "vcores": 1, "maxDirections": 1,
                        "level": "browser"}}


def run_job(mp, inp, local=True):
    """Rejoue l'entrée « navigateur » dans le worker (vrai
    convert_files_to_input_items, base factice). Rend (job, exception)."""
    files_db = FakeCollection([
        {"slug": f["slug"], "name": f["name"], "ownerId": "u1",
         "polygonParts": [{"coordinates": p["coordinates"], "holes": p["holes"],
                           "handles": p["handles"], "color": p["color"]}
                          for p in f["parts"]]}
        for f in inp["files"]
    ])
    params = {
        "sheets": [dict(s) for s in inp["params"]["sheets"]],
        "space": inp["params"]["space"], "fillHoles": inp["params"]["fillHoles"],
        "addOutShape": inp["params"]["addOutShape"],
        "outputUnit": inp["params"]["outputUnit"],
        "timeBudgetSec": inp["profile"]["timeBudgetSec"],
        "alternativesCount": inp["params"]["alternativesCount"],
        "vcores": 1, "computeLevel": "browser",
    }
    if inp["params"].get("directions"):
        params["directions"] = inp["params"]["directions"]
    if "edgeDistance" in inp["params"]:
        params["edgeDistance"] = inp["params"]["edgeDistance"]
    if local:
        params["computeLocation"] = "local"
    job = {
        "_id": "job1", "slug": "job-k3x9q2", "projectSlug": "p1", "ownerId": "u1",
        "status": "processing",
        "files": [{"slug": f["slug"], "count": f["count"], "rotations": f["rotations"]}
                  for f in inp["files"]],
        "params": params,
    }
    jobs = FakeCollection([job])
    mp.setattr(m, "db", FakeDb(nesting_jobs=jobs, user_dxf_files=files_db))
    mp.setattr(m, "get_dek", lambda db, owner: None)

    def forbidden_run_engine(*a, **kw):
        raise AssertionError("run_engine ne doit jamais tourner pour un job local")

    mp.setattr(m, "run_engine", forbidden_run_engine)
    exc = None
    try:
        m.nesting_process(job)
    except Exception as e:  # noqa: BLE001 - on rend le refus au test
        exc = e
    return job, exc


def payload_of(job):
    assert job["status"] == "awaiting_local", job.get("information")
    return job["localPayload"]


def canon(payload):
    return json.dumps(payload, sort_keys=True)


def to_js_shape(job):
    """Le localPayload Python au format `expected` des fixtures de parité :
    sans les clés que seul le worker écrit (walks, concurrency), graine en
    string (63 bits > 2^53, piège 16).

    Bord réglé : graine et nom d'instance sont ceux que PRODUIT le worker
    (convention du navigateur). Bord absent ou égal à l'espacement : le chemin
    d'avant, qui hache `json.dumps` (80.0) et nomme l'instance du slug du job,
    garde ses valeurs ; on les ramène à la convention du navigateur pour
    comparer le reste."""
    p = copy.deepcopy(job["localPayload"])
    p.pop("walks", None)
    p.pop("concurrency", None)
    if "edgeShift" not in p:
        p["instance"]["name"] = "nest2d"
        cfg = p["engineConfig"]
        cfg["prng_seed"] = E.js_deterministic_seed(
            {"instance": p["instance"], "space": cfg["min_item_separation"] or 0,
             "budget": cfg["time_budget_sec"]})
    seed = str(p["engineConfig"]["prng_seed"])
    p["engineConfig"]["prng_seed"] = seed
    return {
        "payload": p,
        "seed": seed,
        "itemMap": job["itemMap"],
    }


def is_f32(x):
    return struct.unpack("<f", struct.pack("<f", x))[0] == x


BIG_FILES = [make_file("sq-a1b2.dxf", "carre.dxf", 4, 80, 80)]
ONE_SHEET = [{"width": 1500, "height": 1000, "count": 1}]


# ---------------------------------------------------------------------------
# Le test qui échoue sans le changement
# ---------------------------------------------------------------------------

def test_strip_edge_10_gives_shifted_sheet_and_frames():
    """Bord 10, espacement 2, tôle 1500 x 1000, bande : d = 8, tôle moteur
    1484 x 984 (f32 par défaut), repère réel rendu pour le retour."""
    with MonkeyPatch.context() as mp:
        job, exc = run_job(mp, make_input(BIG_FILES, ONE_SHEET, space=2, edge=10,
                                          directions=["left"]))
    assert exc is None
    p = payload_of(job)
    assert p["problem"] == "spp"
    h = p["instance"]["strip_height"]
    w = p["engineConfig"]["max_strip_width"]
    assert is_f32(h) and h <= 984
    assert is_f32(w) and w <= 1484
    assert p["requestedEdge"] == 10
    assert p["edgeShift"] == 8
    assert p["sheetFrames"] == [{"width": 1500, "height": 1000}]
    assert p["requestedSpace"] == 2


# ---------------------------------------------------------------------------
# d = 0 : rien ne change
# ---------------------------------------------------------------------------

def test_edge_equal_to_spacing_or_absent_is_identical():
    inp_absent = make_input(BIG_FILES, ONE_SHEET, space=2, directions=["left"])
    inp_equal = make_input(BIG_FILES, ONE_SHEET, space=2, edge=2, directions=["left"])
    inp_empty = make_input(BIG_FILES, ONE_SHEET, space=2, edge="", directions=["left"])
    with MonkeyPatch.context() as mp:
        a, _ = run_job(mp, inp_absent)
        b, _ = run_job(mp, inp_equal)
        c, _ = run_job(mp, inp_empty)
    assert canon(payload_of(a)) == canon(payload_of(b)) == canon(payload_of(c))
    for k in ("requestedEdge", "edgeShift", "sheetFrames"):
        assert k not in payload_of(a)
    assert payload_of(a)["instance"]["strip_height"] == 1000


# ---------------------------------------------------------------------------
# Multi-tôles
# ---------------------------------------------------------------------------

def test_multi_sheet_with_zero_count_format_in_the_middle_negative_edge():
    sheets = [{"width": 1500, "height": 1000, "count": 2},
              {"width": 1200, "height": 800, "count": 0},
              {"width": 2000, "height": 1200, "count": 1}]
    files = [make_file("sq-a1b2.dxf", "carre.dxf", 6, 80, 80)]
    with MonkeyPatch.context() as mp:
        job, exc = run_job(mp, make_input(files, sheets, space=2, edge=-2))
    assert exc is None
    p = payload_of(job)
    assert p["problem"] == "bpp"
    assert p["edgeShift"] == -4
    assert p["requestedEdge"] == -2
    bins = p["instance"]["bins"]
    assert [b["id"] for b in bins] == [0, 1]
    assert [b["stock"] for b in bins] == [2, 1]
    assert bins[0]["shape"]["data"]["outer"][2] == [1508.0, 1008.0]
    assert bins[1]["shape"]["data"]["outer"][2] == [2008.0, 1208.0]
    # Coût sur l'aire MOTEUR.
    assert bins[0]["cost"] == 100
    assert bins[1]["cost"] == round(2008 * 1208 / (1508 * 1008) * 100)
    # Repère réel : les formats actifs, dans l'ordre, avec leurs vraies cotes.
    assert p["sheetFrames"] == [{"width": 1500, "height": 1000},
                                {"width": 2000, "height": 1200}]
    # Les ids de conteneur moteur retournent aux ids de format d'origine.
    assert p["containerMapBack"] == [[0, 0], [1, 2]]


def test_f32_bites_and_never_gives_more_room():
    """W - 2d = 1485.4 : Math.fround arrondirait au plus proche (au-dessus),
    le moteur doit recevoir le f32 juste en dessous."""
    near = struct.unpack("<f", struct.pack("<f", 1485.4))[0]
    assert near > 1485.4  # précondition : l'arrondi « au plus proche » mord
    below = E.f32_at_or_below(1485.4)
    assert is_f32(below) and below <= 1485.4 and below < near
    # d = 7,3 (bord 9,3, espacement 2).
    sheets = [{"width": 1500, "height": 1000, "count": 1},
              {"width": 1800, "height": 1100, "count": 1}]
    with MonkeyPatch.context() as mp:
        job, exc = run_job(mp, make_input(BIG_FILES, sheets, space=2, edge=9.3))
    assert exc is None
    out = payload_of(job)["instance"]["bins"][0]["shape"]["data"]["outer"]
    assert out[1][0] == below
    assert out[2][1] == E.f32_at_or_below(1000 - 2 * (9.3 - 2))


def test_f32_at_or_below_cases():
    for x in (1485.4, 984.0, 0.1, -0.1, 3002.6, 1e-50, -1e-50, 0.0, 16777217.0):
        f = E.f32_at_or_below(x)
        assert is_f32(f) and f <= x
    # 0 -> rien à abaisser ; un tout petit négatif -> plus petit négatif dénormal.
    assert E.f32_at_or_below(0.0) == 0.0
    assert E.f32_at_or_below(-1e-50) == struct.unpack("<f", struct.pack("<i", -2147483647))[0]


# ---------------------------------------------------------------------------
# Refus
# ---------------------------------------------------------------------------

def _refusal(job, exc):
    assert isinstance(exc, m.UserFacingError)
    assert job["status"] == "error"
    assert job["placed"] == 0
    assert str(exc) == job["information"]
    return job["information"], job.get("edgeDetail")


def test_overhang_refusal_names_file_and_caps_per_physical_part():
    # 100 x 30, rotations 0 et 45 : plus petit côté 30 (à 0°) -> plafond 15.
    files = [make_file("bar-c3d4.dxf", "barre.dxf", 2, 100, 30, rotations=(0, 45))]
    with MonkeyPatch.context() as mp:
        job, exc = run_job(mp, make_input(files, ONE_SHEET, space=2, edge=-15))
        assert exc is None  # pile au plafond : passe
        job, exc = run_job(mp, make_input(files, ONE_SHEET, space=2, edge=-16))
    code, detail = _refusal(job, exc)
    assert code == "edge_overhang_too_large"
    assert detail == {"maxOverhangMm": 15, "part": "barre.dxf"}


def test_overhang_cap_reads_each_physical_part_of_a_block_not_its_hull():
    # Une fiche de deux pièces non éclatées = UN bloc ; sa boîte est large
    # (140 x 100), mais le plafond vient de la plus étroite des pièces (20).
    f = {"slug": "bloc-e5f6.dxf", "name": "bloc.dxf", "count": 1,
         "rotations": [0, 90],
         "parts": [
             {"coordinates": [[0, 0], [20, 0], [20, 100], [0, 100], [0, 0]],
              "holes": [], "handles": ["A"], "color": None},
             {"coordinates": [[120, 0], [140, 0], [140, 100], [120, 100], [120, 0]],
              "holes": [], "handles": ["B"], "color": None}]}
    with MonkeyPatch.context() as mp:
        job, exc = run_job(mp, make_input([f], ONE_SHEET, space=2, edge=-11))
    code, detail = _refusal(job, exc)
    assert code == "edge_overhang_too_large"
    assert detail == {"maxOverhangMm": 10, "part": "bloc.dxf"}


def test_edge_too_large_announces_a_value_that_passes():
    with MonkeyPatch.context() as mp:
        job, exc = run_job(mp, make_input(BIG_FILES, ONE_SHEET, space=2, edge=600))
        code, detail = _refusal(job, exc)
        assert code == "edge_too_large"
        v = detail["maxEdgeMm"]
        assert 0 < v < 460
        # La valeur annoncée, retapée, passe ; 5 centièmes de plus refusent.
        ok, exc = run_job(mp, make_input(BIG_FILES, ONE_SHEET, space=2, edge=v))
        assert exc is None and ok["status"] == "awaiting_local"
        ko, exc = run_job(mp, make_input(BIG_FILES, ONE_SHEET, space=2, edge=round(v + 0.05, 2)))
        assert isinstance(exc, m.UserFacingError)


def test_part_that_no_longer_fits_the_engine_sheet_is_edge_too_large():
    # d = 463 : la tôle moteur 574 x 74 n'est pas dégénérée mais une pièce de
    # 80 (+ 2 x 2) n'y tient plus, alors qu'elle tient sur la vraie tôle.
    with MonkeyPatch.context() as mp:
        job, exc = run_job(mp, make_input(BIG_FILES, ONE_SHEET, space=2, edge=465))
    code, detail = _refusal(job, exc)
    assert code == "edge_too_large"
    assert "maxEdgeMm" in detail


def test_part_too_large_even_without_edge_keeps_the_old_refusal():
    files = [make_file("big-0a1b.dxf", "grande.dxf", 1, 2000, 50, rotations=(0,))]
    with MonkeyPatch.context() as mp:
        job, exc = run_job(mp, make_input(files, ONE_SHEET, space=2, edge=10))
    assert isinstance(exc, m.UserFacingError)
    assert job["status"] == "error"
    assert "Part(s) too large for the sheet" in job["information"]
    assert "edgeDetail" not in job


def test_edge_without_browser_compute_is_refused():
    with MonkeyPatch.context() as mp:
        job, exc = run_job(mp, make_input(BIG_FILES, ONE_SHEET, space=2, edge=10),
                           local=False)
    assert isinstance(exc, m.UserFacingError)
    assert job["status"] == "error"
    assert job["information"] == "Edge distance requires the in-browser computation."
    assert "localPayload" not in job


def test_no_edge_without_browser_compute_is_not_refused_by_the_defense():
    # Sans bord, le chemin serveur d'avant n'est pas touché par la défense :
    # il part vers le moteur (ici interdit : l'assertion le prouve).
    with MonkeyPatch.context() as mp:
        job, exc = run_job(mp, make_input(BIG_FILES, ONE_SHEET, space=2), local=False)
    assert "run_engine" in str(exc)
    assert job["status"] != "awaiting_local"
    assert "Edge distance" not in str(job.get("information", ""))


# ---------------------------------------------------------------------------
# Parité Python -> JS
# ---------------------------------------------------------------------------

def parity_inputs():
    """Cas rejoués des deux côtés (fichier de fixtures + vitest)."""
    two = [{"width": 1500, "height": 1000, "count": 2},
           {"width": 2000, "height": 1200, "count": 1}]
    mid0 = [{"width": 1500, "height": 1000, "count": 2},
            {"width": 1200, "height": 800, "count": 0},
            {"width": 2000, "height": 1200, "count": 1}]
    rect_a = [make_file("sq-a1b2.dxf", "carre.dxf", 4, 80, 80)]
    rect_b = [make_file("plaque-c3d4.dxf", "plaque.dxf", 6, 120, 60)]
    bar = [make_file("bar-c3d4.dxf", "barre.dxf", 2, 100, 30, rotations=(0, 45))]
    bloc = [{"slug": "bloc-e5f6.dxf", "name": "bloc.dxf", "count": 1,
             "rotations": [0, 90],
             "parts": [
                 {"coordinates": [[0, 0], [20, 0], [20, 100], [0, 100], [0, 0]],
                  "holes": [], "handles": ["A"], "color": None},
                 {"coordinates": [[120, 0], [140, 0], [140, 100], [120, 100], [120, 0]],
                  "holes": [], "handles": ["B"], "color": None}]}]
    return [
        ("bande bord 10", make_input(rect_a, ONE_SHEET, space=2, edge=10, directions=["left"])),
        ("bande bord -5", make_input(rect_a, ONE_SHEET, space=2, edge=-5, directions=["left"])),
        ("deux formats bord 7,3", make_input(rect_b, two, space=2, edge=7.3)),
        ("format a quantite 0 au milieu bord -2", make_input(rect_a, mid0, space=2, edge=-2)),
        ("bord egal a l'espacement", make_input(rect_a, ONE_SHEET, space=2, edge=2, directions=["left"])),
        ("depassement trop grand", make_input(bar, ONE_SHEET, space=2, edge=-16)),
        ("depassement trop grand, bloc", make_input(bloc, ONE_SHEET, space=2, edge=-11)),
        ("bord trop grand", make_input(rect_a, ONE_SHEET, space=2, edge=600)),
        ("piece ne tient plus", make_input(rect_a, ONE_SHEET, space=2, edge=465)),
        ("f32 qui mord, bord 9,3", make_input(rect_a, [{"width": 1500, "height": 1000, "count": 1},
                                                         {"width": 1800, "height": 1100, "count": 1}],
                                              space=2, edge=9.3)),
    ]


def build_parity_cases():
    cases = []
    for name, inp in parity_inputs():
        with MonkeyPatch.context() as mp:
            job, exc = run_job(mp, inp)
        if exc is None:
            expected = to_js_shape(job)
        else:
            assert isinstance(exc, m.UserFacingError), (name, exc)
            expected = {"error": job["information"], "edgeDetail": job.get("edgeDetail")}
        cases.append({"name": name, "input": inp, "expected": expected})
    return cases


def test_parity_fixture_is_up_to_date():
    """Le fichier lu par vitest (edgeDistanceServerParity) est celui que le
    worker produit aujourd'hui : s'il diffère, relancer
    `python tests/gen_edge_payload_parity.py`."""
    assert PARITY_FILE.exists()
    on_disk = json.loads(PARITY_FILE.read_text(encoding="utf-8"))
    fresh = json.loads(json.dumps(build_parity_cases()))
    assert on_disk == fresh


def test_edge_job_seed_and_name_follow_the_browser_convention():
    with MonkeyPatch.context() as mp:
        job, exc = run_job(mp, make_input(BIG_FILES, ONE_SHEET, space=2, edge=10,
                                          directions=["left"]))
        old, _ = run_job(mp, make_input(BIG_FILES, ONE_SHEET, space=2,
                                        directions=["left"]))
    p = payload_of(job)
    assert p["instance"]["name"] == "nest2d"
    cfg = p["engineConfig"]
    assert cfg["prng_seed"] == E.js_deterministic_seed(
        {"instance": p["instance"], "space": cfg["min_item_separation"],
         "budget": cfg["time_budget_sec"]})
    # Sans bord : le chemin d'avant (nom = slug du job, graine json.dumps).
    assert payload_of(old)["instance"]["name"] == "job-k3x9q2"


HARD_NUMBERS = [0, -0.0, 80.0, 1e-7, 5e-7, 1e-6, 1.5e-6, 1e-5, 5e-5, 0.0001,
                2.1431318985078682e-15, 123456.789, 1e16, 1e20, 1e21, 1.5e21,
                -3.25, 1484.4000244140625, -1e-7, 1e300, 0.5, 100.0, 1.7976931348623157e308]


def test_js_number_str_matches_node():
    import shutil
    import subprocess
    node = shutil.which("node")
    if not node:
        pytest.skip("node absent")
    js = ("const v=" + json.dumps([repr(float(x)) for x in HARD_NUMBERS])
          + ".map(Number);process.stdout.write(JSON.stringify(v.map(String)))")
    out = subprocess.run([node, "-e", js], capture_output=True, text=True, check=True).stdout
    expected = json.loads(out)
    assert [E.js_number_str(x) for x in HARD_NUMBERS] == expected


def test_js_canonical_json_shape():
    quote, bslash = chr(34), chr(92)
    got = E.js_canonical_json({"b": [80.0, -0.0, 1e-7], "a": "x" + chr(233) + quote,
                               "c": None, "d": True})
    want = ('{"a":"x' + bslash + 'u00e9' + bslash + quote + '","b":[80,0,1e-7],'
            '"c":null,"d":true}')
    assert got == want
