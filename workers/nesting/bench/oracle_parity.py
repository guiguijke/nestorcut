"""Parité de l'oracle de distance du moteur contre shapely (§12.3.2).

L'oracle Rust (`nest-engine::geometry_check`) est ce sur quoi la garde de la
finition REJETTE désormais. Un oracle géométrique maison qu'on ne confronte
pas à une référence est un pari : ce verrou le confronte à **shapely**, la
mesure de référence du pipeline (celle qui produit `spacingOk` côté serveur
et qui a servi à trancher au §11.2).

Entrée : un répertoire de dumps `NEST_FINISH_DUMP`. Chaque finition — livrée
ou rejetée — y écrit `finish-<bias>-<raison>-<stamp>-meta.json` avec :
les FORMES des pièces posées (indexées par id BPP), les POSES, l'espacement
demandé, et `engineMinDistanceMm`, la distance minimale que le moteur a
mesurée. Le script recalcule cette distance avec shapely et compare.

Deux comparaisons, pas une :

* **la valeur** : `|d_rust − min(d_shapely, plafond)| ≤ TOL` (0,001 mm) —
  le moteur plafonne sa mesure à `space + 1 mm` (au-delà, la valeur exacte
  ne change aucune décision), donc la référence est plafonnée pareil ;
* **le verdict** : `d < space − 0,01` doit tomber du même côté des deux
  côtés. C'est lui qui décide de garder ou de jeter une finition.

Usage (DANS l'image worker, shapely) :

    docker run --rm -i -v "$PWD/.qa-finish:/data" nest2d-nesting-worker:dev \
        python - /data 50 < workers/nesting/bench/oracle_parity.py

Le second argument est le nombre MINIMAL de layouts attendus (défaut 50) :
en dessous, le verrou échoue — un verrou qui ne mesure rien est vide.
"""
import glob
import json
import math
import os
import sys

from shapely import affinity
from shapely.geometry import Polygon
from shapely.strtree import STRtree

TOL_MM = 1e-3
SLACK_MM = 0.01


def rings_of(shape):
    """(anneau externe, trous) d'une forme externe jagua."""
    kind = shape.get("type")
    data = shape.get("data")
    if kind == "simple_polygon":
        return [tuple(p) for p in data], []
    if kind == "polygon":
        return ([tuple(p) for p in data["outer"]],
                [[tuple(p) for p in r] for r in data.get("inner", [])])
    if kind == "rectangle":
        x, y = data["x_min"], data["y_min"]
        w, h = data["width"], data["height"]
        return [(x, y), (x + w, y), (x + w, y + h), (x, y + h)], []
    if kind == "multi_polygon":
        # Une seule matière par item dans nos instances ; on prend la
        # première et on le dit.
        outer = [tuple(p) for p in data[0]["outer"]]
        return outer, [[tuple(p) for p in r] for r in data[0].get("inner", [])]
    raise ValueError("forme non gérée : %s" % kind)


def placed_polygons(meta):
    """Polygones POSÉS (anneaux BRUTS, trous compris) d'un dump."""
    shapes = {}
    for entry in meta.get("itemShapes") or []:
        outer, holes = rings_of(entry["shape"])
        shapes[int(entry["id"])] = Polygon(outer, holes)
    out = []
    for pi in meta.get("placed") or []:
        g = shapes.get(int(pi["item_id"]))
        if g is None:
            continue
        t = pi["transformation"]
        q = affinity.rotate(g, float(t["rotation"]), origin=(0, 0))
        q = affinity.translate(q, float(t["translation"][0]), float(t["translation"][1]))
        out.append(q)
    return out


def shapely_min_distance(polys, ceiling):
    """Distance minimale entre matières, plafonnée comme côté moteur."""
    if len(polys) < 2:
        return ceiling
    tree = STRtree(polys)
    best = ceiling
    for i, p in enumerate(polys):
        for j in tree.query(p.buffer(ceiling)):
            j = int(j)
            if j <= i:
                continue
            d = p.distance(polys[j])
            if d < best:
                best = d
    return best


def main(directory, want):
    metas = sorted(glob.glob(os.path.join(directory, "**", "*-meta.json"), recursive=True))
    rows, bad_value, bad_verdict, skipped = [], [], [], 0
    for path in metas:
        try:
            meta = json.load(open(path, encoding="utf-8"))
        except Exception as exc:  # dump tronqué : on le dit, on ne l'ignore pas
            skipped += 1
            print("ILLISIBLE %s : %s" % (os.path.basename(path), exc))
            continue
        if meta.get("engineMinDistanceMm") is None or not meta.get("placed"):
            skipped += 1
            continue
        space = float(meta.get("spaceMm") or 0.0)
        ceiling = space + 1.0
        polys = placed_polygons(meta)
        if len(polys) < 2:
            skipped += 1
            continue
        d_rust = float(meta["engineMinDistanceMm"])
        d_ref = shapely_min_distance(polys, ceiling)
        limit = max(0.0, space - SLACK_MM)
        v_rust = d_rust < limit
        v_ref = d_ref < limit
        row = {
            "dump": os.path.basename(path),
            "bias": meta.get("bias"),
            "reason": meta.get("reason"),
            "pieces": len(polys),
            "spaceMm": space,
            "dRust": round(d_rust, 4),
            "dShapely": round(d_ref, 4),
            "ecart": round(abs(d_rust - d_ref), 6),
            "verdictRust": v_rust,
            "verdictShapely": v_ref,
            "polygonesInvalides": sum(1 for p in polys if not p.is_valid),
        }
        rows.append(row)
        if abs(d_rust - d_ref) > TOL_MM:
            bad_value.append(row)
        if v_rust != v_ref:
            bad_verdict.append(row)

    print(json.dumps({
        "layoutsMesures": len(rows),
        "layoutsAttendus": want,
        "dumpsIgnores": skipped,
        "ecartMax": max((r["ecart"] for r in rows), default=None),
        "desaccordsDeValeur": len(bad_value),
        "desaccordsDeVerdict": len(bad_verdict),
        "rejetsRust": sum(1 for r in rows if r["verdictRust"]),
    }, indent=1, ensure_ascii=False))
    for r in (bad_value + bad_verdict)[:10]:
        print("DÉSACCORD " + json.dumps(r, ensure_ascii=False))

    ok = True
    if len(rows) < want:
        print("VERROU NON TENU : %d layouts mesurés, %d attendus" % (len(rows), want))
        ok = False
    if bad_value:
        print("VERROU NON TENU : %d écarts > %s mm" % (len(bad_value), TOL_MM))
        ok = False
    if bad_verdict:
        print("VERROU NON TENU : %d verdicts opposés" % len(bad_verdict))
        ok = False
    print("PARITÉ ORACLE : " + ("TENUE" if ok else "ÉCHEC"))
    return 0 if ok else 1


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 50))
