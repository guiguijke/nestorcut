"""Banc « dernière tôle » (plan docs/PLAN-DERNIERE-TOLE-2026-09-09.md).

Rejoue le projet démo (24 pièces marine, tôle 1500 × 3000 × 3, espacement
2, rotations 0/90/180/270) en job SERVEUR avec les trois directions, puis
mesure la TÔLE PARTIELLE de chaque alternative depuis le DXF livré (calque
`BIN_BOUNDARY` exclu) : x_min / x_max / y_min / y_max, pièces, densité, et
les statistiques du post-pass du rapport. À lancer DANS l'image worker,
la pile locale démarrée (le projet démo est semé au boot de l'app) :

    docker run --rm -i --network nestorcut_nest2d \
        -e MONGO_URI=mongodb://mongo:27017/nest2d \
        -e BENCH_BUDGET=120 -e BENCH_TAG=r1- \
        nest2d-nesting-worker:dev python - < workers/nesting/bench/seed_demo_dirs.py

Variables : BENCH_BUDGET (s, défaut 120), BENCH_DIRS (défaut
left,bottom,balanced), BENCH_TAG (préfixe du slug), BENCH_ASSERT=1 pour
appliquer les verrous comparatifs du plan (§4 L3) et sortir en erreur.

Repère : X = largeur de tôle (1500), Y = longueur (3000) — repère moteur,
la vue live tourne l'affichage mais pas les axes.
"""
import io
import json
import os
import sys
import time
from datetime import datetime

from pymongo import MongoClient

BUDGET = int(os.environ.get("BENCH_BUDGET", "120"))
DIRS = os.environ.get("BENCH_DIRS", "left,bottom,balanced").split(",")
TAG = os.environ.get("BENCH_TAG", "")
ASSERT = os.environ.get("BENCH_ASSERT") == "1"
SHEET = {"width": 1500.0, "height": 3000.0, "count": 3}
SPACE = 2.0


def sheet_extents(dxf_text):
    """AABB des entités hors calque BIN_BOUNDARY (et hors rectangle plein
    format), par calque."""
    import ezdxf
    from ezdxf import bbox as _bbox

    d = ezdxf.read(io.StringIO(dxf_text))
    ext = None
    for e in d.modelspace():
        if e.dxf.layer == "BIN_BOUNDARY":
            continue
        try:
            bb = _bbox.extents([e], fast=True)
        except Exception:
            continue
        if not bb.has_data:
            continue
        x0, y0, x1, y1 = bb.extmin.x, bb.extmin.y, bb.extmax.x, bb.extmax.y
        if x1 - x0 >= SHEET["width"] - 1 and y1 - y0 >= SHEET["height"] - 1:
            continue
        if ext is None:
            ext = [x0, y0, x1, y1]
        else:
            ext = [min(ext[0], x0), min(ext[1], y0), max(ext[2], x1), max(ext[3], y1)]
    return ext


def main():
    db = MongoClient(os.environ["MONGO_URI"]).get_default_database()
    files = list(db["user_dxf_files"].find(
        {"projectSlug": "demo", "processingStatus": "completed"},
        {"slug": 1, "demoQuantity": 1}))
    assert len(files) == 24, f"projet démo incomplet : {len(files)} fichiers"
    job_files = [{"slug": f["slug"], "count": int(f["demoQuantity"]),
                  "rotations": [0, 90, 180, 270]} for f in files]
    slug = f"bench-demo-dirs-{TAG}{int(time.time())}"
    db["nesting_jobs"].insert_one({
        "slug": slug, "projectSlug": "demo", "ownerId": "demo",
        "files": job_files,
        "params": {"sheets": [SHEET], "width": SHEET["width"],
                   "height": SHEET["height"], "sheetCount": SHEET["count"],
                   "space": SPACE, "addOutShape": False, "fillHoles": True,
                   "directions": DIRS, "vcores": 4, "timeBudgetSec": BUDGET,
                   "alternativesCount": len(DIRS), "computeLevel": "standard",
                   "outputUnit": "mm"},
        "status": "pending", "priority": 20, "createdAt": datetime.now(),
    })
    print(f"[bench] job {slug} ({BUDGET}s, dirs={DIRS})", flush=True)
    t0 = time.time()
    deadline = t0 + BUDGET * 2 + 300
    while time.time() < deadline:
        doc = db["nesting_jobs"].find_one({"slug": slug}, {"status": 1})
        if doc.get("status") in ("done", "error", "cancelled"):
            break
        time.sleep(5)
    doc = db["nesting_jobs"].find_one({"slug": slug})
    print(f"[bench] status {doc.get('status')} {doc.get('error') or ''} "
          f"wall {time.time() - t0:.0f}s timeTaken {doc.get('timeTaken')}", flush=True)
    if doc.get("status") != "done":
        sys.exit(1)

    sys.path.insert(0, "/app")
    from worker_common.mongo import get_bucket
    from worker_common.crypto import read_gridfs

    bucket = get_bucket("nestDxf")
    W, H = SHEET["width"], SHEET["height"]
    out = []
    for alt in doc.get("alternatives") or []:
        rep = alt.get("report") or {}
        sheets = rep.get("sheets") or []
        rows = []
        for k, name in enumerate(alt.get("dxf_files") or []):
            text = read_gridfs(bucket, name, doc["ownerId"], None).decode("utf-8", "ignore")
            ext = sheet_extents(text) or [None] * 4
            s = sheets[k] if k < len(sheets) else {}
            rows.append({"sheet": k, "parts": s.get("partCount"),
                         "densityPct": s.get("densityPct"),
                         "partsAreaMm2": s.get("partsAreaMm2"),
                         "xMin": ext[0], "yMin": ext[1], "xMax": ext[2], "yMax": ext[3]})
        partial = min(rows, key=lambda r: ((r["densityPct"] or 0), -r["sheet"])) if rows else None
        out.append({"strategy": alt.get("strategy"), "sheets": len(rows),
                    "density": alt.get("density"),
                    "overlapFree": rep.get("overlapFree"), "spacingOk": rep.get("spacingOk"),
                    "insideSheet": rep.get("insideSheet"), "unplaced": rep.get("unplaced"),
                    "postPass": (rep.get("postPass") or {}).get("perPass"),
                    "finish": alt.get("finish"),
                    "partial": partial, "rows": rows})

    print("\n[bench] tôle partielle par direction (mm, repère moteur X=1500 Y=3000) :")
    print(f"  {'dir':9} {'tôles':>5} {'pièces':>6} {'xMin':>7} {'xMax':>7} {'yMin':>7} {'yMax':>7} {'dens%':>6}  badges")
    for a in out:
        p = a["partial"] or {}
        badges = f"overlapFree={a['overlapFree']} spacingOk={a['spacingOk']} insideSheet={a['insideSheet']}"
        print(f"  {a['strategy']:9} {a['sheets']:>5} {p.get('parts') or 0:>6} "
              f"{(p.get('xMin') or 0):>7.1f} {(p.get('xMax') or 0):>7.1f} "
              f"{(p.get('yMin') or 0):>7.1f} {(p.get('yMax') or 0):>7.1f} "
              f"{(p.get('densityPct') or 0):>6.1f}  {badges}")
    print("")
    print("[bench] finition de la tôle partielle (moteur) :")
    for a in out:
        f = a.get("finish")
        if not f:
            print(f"  {a['strategy']:9} finish absent")
            continue
        b, af = f["before"], f["after"]
        print(f"  {a['strategy']:9} tôle {f['sheet']} kept={f['kept']:4} {f.get('reason') or ''}"
              f"  avant x≤{b['xMax']:7.1f} y≤{b['yMax']:7.1f}"
              f"  après x≤{af['xMax']:7.1f} y≤{af['yMax']:7.1f}  ({f['elapsedMs']} ms)")
    print("@@RESULT@@" + json.dumps({"slug": slug, "placed": doc.get("placed"),
                                     "timeTaken": doc.get("timeTaken"),
                                     "alternatives": out}) + "@@END@@", flush=True)

    if ASSERT:
        by = {a["strategy"]: a for a in out}
        errs = []
        for name, a in by.items():
            p = a["partial"] or {}
            if not (a["overlapFree"] and a["spacingOk"] and a["insideSheet"]):
                errs.append(f"{name}: badges de vérification non verts")
            if p.get("xMin") is None or p["xMin"] > 2 * SPACE + 1 or p["yMin"] > 2 * SPACE + 1:
                errs.append(f"{name}: tôle partielle non ancrée au coin (xMin {p.get('xMin')}, yMin {p.get('yMin')})")
        # Verrou APPLES-TO-APPLES : chaque direction contre SA PROPRE
        # entrée. La comparaison croisée ci-dessous n'est valable que si les
        # trois tôles partielles portent des pièces comparables — ce n'est
        # pas garanti (chaque direction est un walk différent, donc une
        # affectation pièces→tôles différente : une tôle qui hérite d'une
        # pièce de 300 mm ne peut pas faire une bande plus étroite).
        for name, a in by.items():
            f = a.get("finish")
            if not f:
                errs.append(f"{name}: aucune trace de finition (finish absent)")
                continue
            if f["kept"] != "spp":
                errs.append(f"{name}: finition non appliquée (kept={f['kept']}, {f.get('reason')})")
                continue
            axis = "yMax" if name == "bottom" else "xMax"
            if f["after"][axis] > f["before"][axis] + 2 * SPACE:
                errs.append(f"{name}: {axis} en régression "
                            f"({f['before'][axis]:.1f} -> {f['after'][axis]:.1f})")
        if {"left", "bottom", "balanced"} <= set(by):
            xm = {k: by[k]["partial"]["xMax"] for k in by}
            ym = {k: by[k]["partial"]["yMax"] for k in by}
            if not (xm["left"] < xm["bottom"] and xm["left"] < xm["balanced"]):
                errs.append(f"left : xMax {xm['left']} n'est pas le plus petit ({xm})")
            if not (ym["bottom"] < ym["left"] and ym["bottom"] < ym["balanced"]):
                errs.append(f"bottom : yMax {ym['bottom']} n'est pas le plus petit ({ym})")
            bal = max(xm["balanced"] / W, ym["balanced"] / H)
            if not (bal < max(xm["left"] / W, ym["left"] / H) and bal < max(xm["bottom"] / W, ym["bottom"] / H)):
                errs.append(f"balanced : max(x/W, y/H) = {bal:.3f} n'est pas le plus petit")
        if errs:
            print("[bench] VERROUS NON TENUS :\n  - " + "\n  - ".join(errs), flush=True)
            sys.exit(2)
        print("[bench] verrous L3 tenus", flush=True)


if __name__ == "__main__":
    main()
