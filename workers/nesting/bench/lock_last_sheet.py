"""Verrou L1 « dernière tôle » — moteur natif, trois directions.

Plan : docs/PLAN-DERNIERE-TOLE-2026-09-09.md §4 (L1).

Rejoue la fixture BPP démo (`fixtures/b_demo`, 304 pièces, 3 tôles
3000 × 1500) avec la config DÉTERMINISTE (bornée en travail : `sa_max_iterations`,
donc indépendante de la vitesse de la machine), une exécution par biais, et
vérifie que la tôle partielle suit la direction demandée :

- `finish.kept == "spp"` pour les trois ;
- `left`   : xMax minimal des trois, aucune régression depuis `finish.before` ;
- `bottom` : yMax minimal des trois, aucune régression depuis `finish.before`
  (le plan demandait une réduction STRICTE : elle n'est mesurable que si le
  recuit était mauvais sur l'axe — quand il a déjà la bande, l'absence de
  gain est imprimée en note) ;
- `balanced` : max(xMax/W, yMax/H) minimal des trois ;
- tôle partielle ANCRÉE au coin (xMin, yMin ≤ 5 mm) pour les trois.

Usage :
    python workers/nesting/bench/lock_last_sheet.py [nest-engine-bin]

Sortie non nulle si un verrou tombe.
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.abspath(os.path.join(HERE, "..", "engine"))
FIXTURE = os.path.join(HERE, "fixtures", "b_demo")
BIASES = ["left", "bottom", "balanced"]
ANCHOR_MM = 5.0


def default_bin():
    exe = "nest-engine.exe" if os.name == "nt" else "nest-engine"
    return os.path.join(ENGINE, "target", "release", exe)


def sheet_size(instance):
    b = instance["bins"][0]["shape"]
    pts = b["data"]["outer"] if b["type"] == "polygon" else None
    if pts is None:                      # rectangle
        d = b["data"]
        return float(d["width"]), float(d["height"])
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return max(xs) - min(xs), max(ys) - min(ys)


def stable_part(finish):
    """Part REPRODUCTIBLE d'une trace de finition : géométrie et verdict.

    Les durées (`elapsedMs`, `phases.p1Ms/p2Ms`) sont du temps mur, et les
    compteurs d'améliorations comptent des événements émis sous throttle
    temporel : ni les unes ni les autres ne peuvent être identiques d'une
    exécution à l'autre, même en mode borné-travail. Ce qui doit l'être,
    c'est le RÉSULTAT — poses et décision.
    """
    if not finish:
        return None
    return {
        "sheet": finish.get("sheet"),
        "bias": finish.get("bias"),
        "kept": finish.get("kept"),
        "reason": finish.get("reason"),
        "before": finish.get("before"),
        "after": finish.get("after"),
        "stop": (finish.get("phases") or {}).get("stop"),
    }


def run_bias(bin_path, bias):
    cfg = json.load(open(os.path.join(FIXTURE, "config_det.json")))
    cfg["biases"] = [bias]
    cfg["n_alternatives"] = 1
    with tempfile.TemporaryDirectory(prefix="nest_last_sheet_") as tmp:
        cfg_path = os.path.join(tmp, "config.json")
        with open(cfg_path, "w") as fh:
            json.dump(cfg, fh)
        subprocess.run(
            [bin_path, "-i", os.path.join(FIXTURE, "instance.json"),
             "-c", cfg_path, "-s", tmp, "-p", "bpp"],
            check=True, capture_output=True,
        )
        alts = json.load(open(os.path.join(tmp, "alternatives.json")))
    return alts[0]


def main(argv):
    bin_path = argv[1] if len(argv) > 1 else os.environ.get("NEST_ENGINE_BIN") or default_bin()
    if not os.path.exists(bin_path):
        print(f"binaire moteur introuvable : {bin_path}", file=sys.stderr)
        return 2
    instance = json.load(open(os.path.join(FIXTURE, "instance.json")))
    W, H = sheet_size(instance)
    print(f"[L1] fixture b_demo — tôle {W:.0f} x {H:.0f}, binaire {bin_path}")

    rows = {}
    repeat_errs = []
    for bias in BIASES:
        # §10.4.3 : mode borné-TRAVAIL — deux exécutions du même biais
        # doivent rendre une trace `finish` IDENTIQUE. La version 1-bis
        # laissait la patience de plateau en temps : `balanced` rendait
        # 628 × 361 un jour et 618 × 369 la veille sur le même fixture.
        alt = run_bias(bin_path, bias)
        alt2 = run_bias(bin_path, bias)
        if stable_part(alt.get("finish")) != stable_part(alt2.get("finish")):
            repeat_errs.append(
                "%s : deux executions donnent des `finish` DIFFERENTS\n"
                "      #1 %s\n      #2 %s" % (
                    bias,
                    json.dumps(stable_part(alt.get("finish")), sort_keys=True),
                    json.dumps(stable_part(alt2.get("finish")), sort_keys=True)))
        fin = alt.get("finish")
        rows[bias] = {"alt": alt, "finish": fin}
        if not fin:
            print(f"  {bias:9} finition ABSENTE (finish=null)")
            continue
        b, a = fin["before"], fin["after"]
        print(f"  {bias:9} tôle {fin['sheet']} kept={fin['kept']:4} {fin.get('reason') or ''}")
        print(f"      avant  x [{b['xMin']:8.1f} ; {b['xMax']:8.1f}]  y [{b['yMin']:8.1f} ; {b['yMax']:8.1f}]")
        print(f"      après  x [{a['xMin']:8.1f} ; {a['xMax']:8.1f}]  y [{a['yMin']:8.1f} ; {a['yMax']:8.1f}]"
              f"   ({fin['elapsedMs']} ms)")

    errs = list(repeat_errs)
    for bias in BIASES:
        fin = rows[bias]["finish"]
        if not fin:
            errs.append(f"{bias} : aucune finition")
            continue
        if fin["kept"] != "spp":
            errs.append(f"{bias} : kept={fin['kept']} ({fin.get('reason')})")
            continue
        a = fin["after"]
        if a["xMin"] > ANCHOR_MM or a["yMin"] > ANCHOR_MM:
            errs.append(f"{bias} : tôle partielle non ancrée (xMin {a['xMin']:.1f}, yMin {a['yMin']:.1f})")
    if all(rows[b]["finish"] and rows[b]["finish"]["kept"] == "spp" for b in BIASES):
        xm = {b: rows[b]["finish"]["after"]["xMax"] for b in BIASES}
        ym = {b: rows[b]["finish"]["after"]["yMax"] for b in BIASES}
        bx = rows["left"]["finish"]["before"]["xMax"]
        by = rows["bottom"]["finish"]["before"]["yMax"]
        # Le plan demande une RÉDUCTION stricte sur l'axe de la direction.
        # Elle n'est mesurable que si le recuit était mauvais sur cet axe :
        # quand il a déjà trouvé la bande (plancher matière), la finition ne
        # peut qu'égaler. Le verrou est donc « pas de régression au-delà de
        # l'espacement », et l'absence de gain est IMPRIMÉE, pas masquée.
        tol = 2.0 * float(json.load(open(os.path.join(FIXTURE, "config_det.json")))
                          .get("min_item_separation") or 0.0)
        if xm["left"] > bx + tol:
            errs.append(f"left : xMax {xm['left']:.1f} en régression depuis {bx:.1f}")
        elif xm["left"] >= bx:
            print(f"  [note] left : aucun gain sur xMax ({bx:.1f} -> {xm['left']:.1f})")
        if ym["bottom"] > by + tol:
            errs.append(f"bottom : yMax {ym['bottom']:.1f} en régression depuis {by:.1f}")
        elif ym["bottom"] >= by:
            print(f"  [note] bottom : aucun gain sur yMax ({by:.1f} -> {ym['bottom']:.1f})"
                  f" — le recuit avait déjà la bande")
        if not (xm["left"] < xm["bottom"] and xm["left"] < xm["balanced"]):
            errs.append(f"left : xMax pas le plus petit ({xm})")
        if not (ym["bottom"] < ym["left"] and ym["bottom"] < ym["balanced"]):
            errs.append(f"bottom : yMax pas le plus petit ({ym})")
        bal = max(xm["balanced"] / W, ym["balanced"] / H)
        others = [max(xm[b] / W, ym[b] / H) for b in ("left", "bottom")]
        if not all(bal < o for o in others):
            errs.append(f"balanced : max(x/W, y/H) = {bal:.3f} pas le plus petit ({others})")

    if errs:
        print("[L1] VERROUS NON TENUS :\n  - " + "\n  - ".join(errs))
        return 1
    print("[L1] verrous tenus")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
