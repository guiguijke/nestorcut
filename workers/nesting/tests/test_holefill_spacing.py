"""§17.3/§17.4 — le hole-fill ne livre jamais une paire sous l'espacement.

Deux verrous :

1. **le cas réel** (fixture du 2026-09-10) : l'alternative `balanced` d'une
   démo navigateur ÉCARTÉE pour recouvrements mesurés — 9 poses dupliquées,
   27 paires sous l'espacement, job remboursé. L'état MOTEUR de cette tôle
   est conforme (2,0001 mm) : la passe seule est en cause. Le Python, dont
   la distance passe par shapely, refusait déjà ces poses : il est la
   RÉFÉRENCE de parité pour le miroir JS
   (`app/tests/holefillParity.test.js` lit la même fixture) ;
2. **le chemin multi-relocalisations** : plusieurs poses appliquées dans la
   même passe doivent se voir entre elles (piège #56 — un seuil ou une
   portée qui ne couvre pas les poses de la même passe laisse passer des
   doublons à distance 0).
"""
import json
import os

from shapely import affinity
from shapely.geometry import Polygon

from core.holefill import PAIR_SLACK_MM, apply_hole_fill

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures",
                       "holefill_parity_20260910.json")


def _items(parts):
    return [{
        "id": int(p["id"]),
        "coords": [tuple(c) for c in p["coords"]],
        "holes": [[tuple(c) for c in h] for h in (p.get("holes") or [])],
        "rotations": [0, 90, 180, 270],
    } for p in parts]


def _material(item, rot, tx, ty):
    g = Polygon(item["coords"], item["holes"])
    return affinity.translate(affinity.rotate(g, rot, origin=(0, 0)), tx, ty)


def measure(items, layouts, space):
    """(paires sous le seuil, poses dupliquées) — mesure INDÉPENDANTE du
    code testé : shapely sur les anneaux bruts, trous soustraits."""
    by_id = {i["id"]: i for i in items}
    under = 0
    dups = 0
    for layout in layouts:
        polys = []
        keys = []
        for pi in layout["placed_items"]:
            it = by_id[int(pi["item_id"])]
            t = pi["transformation"]
            polys.append(_material(it, t["rotation"], t["translation"][0], t["translation"][1]))
            keys.append((int(pi["item_id"]), round(t["rotation"], 6),
                         round(t["translation"][0], 6), round(t["translation"][1], 6)))
        lim = max(0.0, space - PAIR_SLACK_MM)
        for i in range(len(polys)):
            for j in range(i + 1, len(polys)):
                if polys[i].distance(polys[j]) < lim:
                    under += 1
                    if keys[i] == keys[j]:
                        dups += 1
    return under, dups


def test_real_case_no_pair_under_spacing_after_hole_fill():
    fx = json.load(open(FIXTURE, encoding="utf-8"))
    items = _items(fx["parts"])
    layouts = json.loads(json.dumps(fx["layouts"]))
    space = float(fx["space"])
    before = measure(items, layouts, space)
    assert before == (0, 0), f"l'état MOTEUR de la fixture doit être conforme, mesuré {before}"
    post = {}
    apply_hole_fill(items, layouts, space, post)
    after = measure(items, layouts, space)
    assert after == (0, 0), (
        f"le hole-fill a livré {after[0]} paire(s) sous l'espacement dont "
        f"{after[1]} doublon(s) — post_pass={post}")


def test_real_case_matches_the_reference_relocation_count():
    fx = json.load(open(FIXTURE, encoding="utf-8"))
    items = _items(fx["parts"])
    layouts = json.loads(json.dumps(fx["layouts"]))
    n = apply_hole_fill(items, layouts, float(fx["space"]))
    assert n == fx["attendu"]["relocalisations"], fx["attendu"]["commentaire"]


def test_multi_relocation_path_sees_its_own_poses():
    """Un trou large, DEUX fillers libres : les deux poses sont calculées
    contre un trou VIDE. Si la seconde n'est pas revalidée contre la
    première, elles se recouvrent."""
    hole = [(-30.0, -30.0), (30.0, -30.0), (30.0, 30.0), (-30.0, 30.0), (-30.0, -30.0)]
    host = {
        "id": 0,
        "coords": [(-60.0, -60.0), (60.0, -60.0), (60.0, 60.0), (-60.0, 60.0), (-60.0, -60.0)],
        "holes": [hole],
        "rotations": [0],
        "count": 1,
    }
    fill = {
        "id": 1,
        "coords": [(-8.0, -8.0), (8.0, -8.0), (8.0, 8.0), (-8.0, 8.0), (-8.0, -8.0)],
        "holes": [],
        "rotations": [0, 90, 180, 270],
        "count": 2,
    }
    layouts = [{"placed_items": [
        {"item_id": 0, "transformation": {"rotation": 0, "translation": [500.0, 500.0]}},
        {"item_id": 1, "transformation": {"rotation": 0, "translation": [200.0, 200.0]}},
        {"item_id": 1, "transformation": {"rotation": 0, "translation": [240.0, 200.0]}},
    ]}]
    items = [host, fill]
    n = apply_hole_fill(items, layouts, 2.0)
    under, dups = measure(items, layouts, 2.0)
    assert (under, dups) == (0, 0), (
        f"{n} relocalisation(s) ont produit {under} paire(s) sous l'espacement "
        f"dont {dups} doublon(s)")
