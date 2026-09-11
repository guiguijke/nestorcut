"""Mesure les écarts d'un layout depuis les SVG de tôles — diagnostic d'un
badge « espacement » rouge (`spacingOk: false`).

Le badge vient de `nest-report::verify_layout`, qui prend le MINIMUM de deux
familles : distance entre pièces, ET distance de chaque pièce au bord de la
tôle. Un badge rouge ne dit donc pas laquelle des deux a manqué, ni sur
quelle tôle. Ce script le dit, tôle par tôle, sur les anneaux BRUTS écrits
dans le SVG (les mêmes que le DXF livré, trous compris, `fill-rule
evenodd`).

Entrée : le dump du harnais L5 (`spacing-fail-<dir>-<n>.json`).

DEUX modes, selon ce que le dump contient :

* `alternative.svgs` → mesure des tôles LIVRÉES (anneaux bruts du SVG) ;
* `alternative.qaPrePostPass` (drapeau `QA_DUMP_PRE_POSTPASS`, §17.2) →
  mesure de l'état MOTEUR (avant expansion meta, hole-fill et bandes
  résiduelles) ET de l'état livré, sur les MÊMES anneaux bruts, avec les
  deux poses de la paire fautive. C'est cette comparaison qui dit si
  l'écart sort du solveur ou d'une passe.

À lancer DANS l'image worker (shapely) :

    docker run --rm -i -v "$PWD/.qa:/data" nest2d-nesting-worker:dev \
        python - /data/spacing-fail-balanced.json \
        < workers/nesting/bench/measure_svg_gaps.py

Sortie : par tôle, l'écart minimal entre pièces (avec la paire), l'écart
minimal au bord, et le verdict `space - 0,01` du rapport.
"""
import json
import math
import re
import sys

from shapely import affinity
from shapely.geometry import Polygon
from shapely.strtree import STRtree

PATH_RE = re.compile(r'<path d="([^"]+)" transform="translate\(([-\d.]+) ([-\d.]+)\) '
                     r'scale\(1 -1\) rotate\(([-\d.]+)\)"')
SVG_RE = re.compile(r'<svg[^>]*viewBox="0 0 ([\d.]+) ([\d.]+)"')


def rings_of_path(d):
    """Sous-chemins `M x y x y … Z` → anneaux (le premier est l'extérieur)."""
    rings = []
    for chunk in d.split("M"):
        chunk = chunk.strip().rstrip("Z").strip()
        if not chunk:
            continue
        nums = [float(v) for v in chunk.replace(",", " ").split()]
        pts = list(zip(nums[0::2], nums[1::2]))
        if len(pts) > 2:
            rings.append(pts)
    return rings


def placed_polygons(svg):
    """Polygones POSÉS d'une tôle, dans le repère du SVG (y bas).

    Les transformations SVG s'appliquent de droite à gauche :
    translate ∘ scale(1,-1) ∘ rotate. `scale(1,-1)` et la rotation sont des
    isométries, les distances mesurées ici sont donc celles du repère
    moteur.
    """
    out = []
    for d, tx, ty, deg in PATH_RE.findall(svg):
        rings = rings_of_path(d)
        if not rings:
            continue
        g = Polygon(rings[0], rings[1:])
        g = affinity.rotate(g, float(deg), origin=(0, 0))
        g = affinity.scale(g, xfact=1.0, yfact=-1.0, origin=(0, 0))
        g = affinity.translate(g, float(tx), float(ty))
        out.append(g)
    return out


def sheet_size(svg):
    m = SVG_RE.search(svg)
    return (float(m.group(1)), float(m.group(2))) if m else (None, None)


def rings_of_part(part):
    """(anneau externe, trous) d'une pièce du payload navigateur."""
    outer = [tuple(p) for p in part.get("coords") or []]
    while len(outer) > 1 and outer[-1] == outer[0]:
        outer.pop()
    holes = []
    for h in part.get("holes") or []:
        ring = [tuple(p) for p in h]
        while len(ring) > 1 and ring[-1] == ring[0]:
            ring.pop()
        holes.append(ring)
    return outer, holes


def polys_of_layout(layout, base):
    """Polygones posés d'une tôle, à partir des poses.

    `placed_items[].transformation.rotation` est en DEGRÉS — c'est la
    convention externe du moteur, et `layoutTransforms` (localBridge) lui
    applique `degToRad` pour le SVG. Convertir ici serait une erreur de
    facteur 57 qui rendrait toute la mesure absurde sans le dire.
    """
    out, ids = [], []
    for pi in layout.get("placed_items") or []:
        rings = base.get(str(pi["item_id"]))
        if rings is None:
            continue
        outer, holes = rings
        g = Polygon(outer, holes)
        t = pi.get("transformation") or {}
        deg = float(t.get("rotation") or 0.0)
        tx, ty = (t.get("translation") or [0.0, 0.0])[:2]
        g = affinity.rotate(g, deg, origin=(0, 0))
        g = affinity.translate(g, float(tx), float(ty))
        out.append(g)
        ids.append(int(pi["item_id"]))
    return out, ids


def min_pair(polys, space):
    """(écart minimal, paire, nombre de paires sous le seuil) d'une tôle."""
    if len(polys) < 2:
        return math.inf, None, 0
    tree = STRtree(polys)
    best, pair, under = math.inf, None, 0
    limit = space - 0.01
    for i, p in enumerate(polys):
        for j in tree.query(p.buffer(space + 1.0)):
            j = int(j)
            if j <= i:
                continue
            d = p.distance(polys[j])
            if d < best:
                best, pair = d, (i, j)
            if d < limit:
                under += 1
    return best, pair, under


def measure_poses(data):
    """Mode POSES : l'état moteur contre l'état livré (§17.2)."""
    alt = data.get("alternative") or {}
    qa = alt.get("qaPrePostPass") or {}
    space = float(qa.get("space") or data.get("space") or 0.0)
    base = {str(p["id"]): rings_of_part(p) for p in qa.get("parts") or []}
    verdicts = []
    for label, key in (("moteur (avant post-pass)", "layoutsPre"),
                       ("livré (après post-pass)", "layoutsPost")):
        rows = []
        for k, layout in enumerate(qa.get(key) or []):
            polys, ids = polys_of_layout(layout, base)
            d, pair, under = min_pair(polys, space)
            rows.append({
                "tole": k, "pieces": len(polys),
                "ecartMin": None if d is math.inf else round(d, 4),
                "pairesSousSeuil": under,
                "paire": None if not pair else {
                    "itemIds": [ids[pair[0]], ids[pair[1]]],
                    "poses": [
                        [round(v, 3) for v in polys[pair[0]].bounds],
                        [round(v, 3) for v in polys[pair[1]].bounds],
                    ],
                },
            })
        worst = min((r for r in rows if r["ecartMin"] is not None),
                    key=lambda r: r["ecartMin"], default=None)
        verdicts.append({"etat": label, "toles": rows,
                         "ecartMinGlobal": worst["ecartMin"] if worst else None,
                         "toleFautive": worst["tole"] if worst else None,
                         "pairesSousSeuil": sum(r["pairesSousSeuil"] for r in rows)})
    print(json.dumps({
        "space": space,
        "seuil": round(space - 0.01, 4),
        "spacingOkRapporte": (alt.get("report") or {}).get("spacingOk"),
        "ecartMinRapporte": (alt.get("report") or {}).get("smallestGapMm"),
        "etats": verdicts,
    }, ensure_ascii=False, indent=1))
    pre, post = verdicts[0], verdicts[1]
    limit = space - 0.01
    if pre["pairesSousSeuil"] > 0:
        verdict = "(a) L'ÉCART EXISTE DÉJÀ AVANT POST-PASS — cause côté solve"
    elif post["pairesSousSeuil"] > 0:
        verdict = "(b) L'ÉCART APPARAÎT APRÈS POST-PASS — cause côté passe"
    else:
        verdict = "(c) AUCUN des deux états ne montre de paire sous le seuil"
    print("VERDICT " + verdict)
    print("   avant : %s mm (tôle %s) · après : %s mm (tôle %s) · seuil %.4f"
          % (pre["ecartMinGlobal"], pre["toleFautive"],
             post["ecartMinGlobal"], post["toleFautive"], limit))
    return 0


def main(path):
    data = json.load(open(path, encoding="utf-8"))
    # Dump d'un REJET TOTAL : une entrée par alternative écartée.
    if data.get("discarded"):
        rc = 0
        for entry in data["discarded"]:
            print("=== alternative écartée : %s (%s) ===" % (
                entry.get("strategy"), entry.get("reason")))
            print("    vérification livrée : " + json.dumps(
                entry.get("verification") or {}, ensure_ascii=False))
            rc |= measure_poses({"space": data.get("space"), "alternative": entry})
        return rc
    if ((data.get("alternative") or {}).get("qaPrePostPass") or {}).get("layoutsPre"):
        return measure_poses(data)
    space = float(data.get("space") or 0.0)
    alt = data.get("alternative") or {}
    svgs = alt.get("svgs") or []
    limit = space - 0.01
    print(json.dumps({"space": space, "seuilRapport": round(limit, 4),
                      "toles": len(svgs),
                      "spacingOkRapporte": (alt.get("report") or {}).get("spacingOk"),
                      "ecartMinRapporte": (alt.get("report") or {}).get("smallestGapMm")},
                     ensure_ascii=False))
    worst_overall = (math.inf, None)
    for k, svg in enumerate(svgs):
        polys = placed_polygons(svg)
        w, h = sheet_size(svg)
        if not polys:
            print(f"tôle {k}: aucun path")
            continue
        invalid = sum(1 for p in polys if not p.is_valid)
        # bord de tôle : distance de chaque anneau aux quatre côtés
        edge_min, edge_idx = math.inf, None
        for i, p in enumerate(polys):
            x0, y0, x1, y1 = p.bounds
            d = min(x0, y0, (w - x1) if w else math.inf, (h - y1) if h else math.inf)
            if d < edge_min:
                edge_min, edge_idx = d, i
        # paires : broadphase sur space + 1 mm, comme le rapport
        tree = STRtree(polys)
        pair_min, pair = math.inf, None
        under = 0
        for i, p in enumerate(polys):
            for j in tree.query(p.buffer(space + 1.0)):
                j = int(j)
                if j <= i:
                    continue
                d = p.distance(polys[j])
                if d < pair_min:
                    pair_min, pair = d, (i, j)
                if d < limit:
                    under += 1
        sheet_min = min(pair_min, edge_min)
        if sheet_min < worst_overall[0]:
            worst_overall = (sheet_min, k)
        print(json.dumps({
            "tole": k, "pieces": len(polys), "anneauxInvalides": invalid,
            "tole_mm": [w, h],
            "ecartPaires": None if pair_min is math.inf else round(pair_min, 4),
            "pairesSousSeuil": under,
            "pireePaire": None if not pair else {
                "a": {"index": pair[0], "bounds": [round(v, 2) for v in polys[pair[0]].bounds]},
                "b": {"index": pair[1], "bounds": [round(v, 2) for v in polys[pair[1]].bounds]},
            },
            "ecartBord": round(edge_min, 4),
            "pieceLaPlusProcheDuBord": None if edge_idx is None else {
                "index": edge_idx,
                "bounds": [round(v, 2) for v in polys[edge_idx].bounds],
            },
            "verdictTole": "OK" if sheet_min >= limit else "SOUS LE SEUIL",
            "cause": "paires" if pair_min < edge_min else "bord de tôle",
        }, ensure_ascii=False, indent=1))
    print(json.dumps({"ecartMinMesure": None if worst_overall[1] is None else round(worst_overall[0], 4),
                      "tole": worst_overall[1]}, ensure_ascii=False))
    return 0 if worst_overall[0] >= limit else 1


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
