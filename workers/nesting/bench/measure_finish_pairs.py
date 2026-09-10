"""Mesure les distances entre pièces d'une solution SPP — diagnostic des
rejets `infeasible: pair` de la finition (plan « dernière tôle » §10.4.4).

Entrée : l'instance SPP et la sortie `alternatives.json` d'un rejeu du CLI
natif sur un dump `NEST_FINISH_DUMP`. Sortie : distance minimale entre
pièces (anneaux BRUTS, shapely), nombre de paires sous l'espacement, et la
paire fautive.

À lancer DANS l'image worker (shapely) :

    docker run --rm -i \
        -v "$PWD/.qa-finish:/data" \
        nest2d-nesting-worker:dev \
        python - /data/instance.json /data/out/alternatives.json 2.0 \
        < workers/nesting/bench/measure_finish_pairs.py
"""
import json
import math
import sys

from shapely import affinity
from shapely.geometry import Polygon
from shapely.strtree import STRtree


def rings_of(shape):
    """(anneau externe, trous) depuis une forme externe jagua."""
    kind = shape.get("type")
    data = shape.get("data")
    if kind == "simple_polygon":
        return [tuple(p) for p in data], []
    if kind == "polygon":
        return ([tuple(p) for p in data["outer"]],
                [[tuple(p) for p in ring] for ring in data.get("inner", [])])
    if kind == "rectangle":
        x, y = data["x_min"], data["y_min"]
        w, h = data["width"], data["height"]
        return [(x, y), (x + w, y), (x + w, y + h), (x, y + h), (x, y)], []
    raise ValueError("forme non gérée : %s" % kind)


def main(instance_path, alternatives_path, space):
    inst = json.load(open(instance_path, encoding="utf-8"))
    alts = json.load(open(alternatives_path, encoding="utf-8"))
    base = {}
    for it in inst["items"]:
        outer, holes = rings_of(it["shape"] if "shape" in it else it["base"]["shape"])
        base[int(it["id"] if "id" in it else it["base"]["id"])] = Polygon(outer, holes).buffer(0)

    sol = alts[0].get("solution") or {}
    layout = sol.get("layout") or (sol.get("layouts") or [{}])[0]
    placed = layout.get("placed_items") or []
    polys, ids = [], []
    for pi in placed:
        g = base[int(pi["item_id"])]
        t = pi["transformation"]
        q = affinity.rotate(g, float(t["rotation"]), origin=(0, 0))
        q = affinity.translate(q, float(t["translation"][0]), float(t["translation"][1]))
        polys.append(q)
        ids.append(int(pi["item_id"]))

    tree = STRtree(polys)
    worst = (math.inf, None, None)
    under = 0
    for i, p in enumerate(polys):
        for j in tree.query(p.buffer(space + 1.0)):
            j = int(j)
            if j <= i:
                continue
            d = p.distance(polys[j])
            if d < worst[0]:
                worst = (d, i, j)
            if d < space - 1e-9:
                under += 1
    print(json.dumps({
        "placed": len(polys),
        "space": space,
        "minDistance": None if worst[1] is None else round(worst[0], 4),
        "pairsUnderSpace": under,
        "worstPair": None if worst[1] is None else {
            "a": {"index": worst[1], "itemId": ids[worst[1]],
                  "bounds": [round(v, 3) for v in polys[worst[1]].bounds]},
            "b": {"index": worst[2], "itemId": ids[worst[2]],
                  "bounds": [round(v, 3) for v in polys[worst[2]].bounds]},
        },
    }, indent=1))
    return 1 if under else 0


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1], sys.argv[2], float(sys.argv[3])))
