"""Régénère `out_user_layouts_post_py.json` — la référence Python du test de
parité JS ↔ Python (`app/tests/replayUserBpp.test.js`).

L'ancien générateur (`audit_replay_user.py`) rejouait un job Mongo vivant et
resolvait l'instance ; il n'est plus rejouable. Ici on repart des deux
fixtures COMMITÉES (`out_user_payload.json`, `out_user_layouts_pre.json`) et
on applique exactement la chaîne de post-pass du worker :
idMap → expand_meta → apply_hole_fill → fill_residual_bands.

À lancer DANS l'image worker, le dossier bench monté en écriture :

    docker run --rm -i \
        -v "$PWD/workers/nesting/bench:/app/bench" \
        nest2d-nesting-worker:dev python - < workers/nesting/bench/regen_user_post_py.py
"""
import copy
import json
import sys

sys.path.insert(0, "/app")

from core.holefill import expand_meta, apply_hole_fill      # noqa: E402
from core.residual import fill_residual_bands               # noqa: E402

lp = json.load(open("/app/bench/out_user_payload.json"))
pre = json.load(open("/app/bench/out_user_layouts_pre.json"))

post = copy.deepcopy(pre["layouts"])
items = copy.deepcopy(lp["parts"])
meta = lp.get("meta") or {}
space = float((lp.get("engineConfig") or {}).get("min_item_separation") or 0)

if meta.get("idMap"):
    for l in post:
        for pi in l.get("placed_items", []):
            pid = pi.get("item_id")
            if isinstance(pid, int) and 0 <= pid < len(meta["idMap"]):
                pi["item_id"] = meta["idMap"][pid]
if meta and not meta.get("packs"):
    post = expand_meta(items, meta["host"], meta["fill"],
                       meta.get("slots") or [], post,
                       meta.get("ringRotations"))
n_hf = apply_hole_fill(items, post, space)
stats = {}
n_res = fill_residual_bands(post, items, {0: (1000.0, 1000.0)}, space, stats=stats)

with open("/app/bench/out_user_layouts_post_py.json", "w") as f:
    json.dump({"layouts": post, "holeFill": n_hf, "residualMoved": n_res,
               "stats": stats}, f)
print("post-pass Python régénéré :",
      [len(l.get("placed_items") or []) for l in post],
      "| holeFill", n_hf, "| residualMoved", n_res,
      "| rollback", stats.get("compactRollback"), flush=True)
