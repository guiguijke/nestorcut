"""Cross-target determinism lock (Phase 2 foundation): the SAME job run
through the native nest-engine binary and through the browser-target wasm
artifact (in Node/V8) must produce BIT-IDENTICAL alternatives — SHA-256 of
the canonical form, tolerance 0.

Quatre fixtures, toutes verrouillées :
  - `b_demo`      (BPP) : le job de démo, pièces convexes.
  - `e0_volute`   (SPP) : trois volutes synthétiques dont le gonflement passe
    par le REPLI robuste de `offset_shape` (lot E0) — le repli tourne aussi
    en navigateur, il doit rendre les mêmes octets que le natif.
  - `j7a_defaut`  (MERGE) : le CHEMIN PAR DÉFAUT d'un petit job — réglages
    d'usine (tôle 1000×2000, espacement 2, direction left), 2 pièces de
    40×40 mm. Le payload sort du vrai `buildLocalPayload` (bascule J7-a en
    BPP), deux walks wasm bornés en travail, puis `merge_alternatives` avec
    finition de la tôle partielle : natif (`nest-engine --merge`) et wasm.
    Avant le lot A ce chemin paniquait (strip.rs, « Offset resulted in an
    empty polygon ») ; l'entrée est `fixtures/j7a_defaut/merge_input.json`,
    produite par `make_j7a_fixture.mjs`.
  - `j7a_limite`  (SPP) : le job À LA LIMITE de cette bascule — mêmes réglages,
    un rectangle de 40×100 mm dont l'aire dépasse 4000 d'un epsilon : la largeur
    initiale tombe dans la fenêtre sans conteneur, le moteur élargit la bande.
    Natif et wasm doivent construire, ou refuser, les mêmes largeurs. Payload du
    vrai import et du vrai `buildLocalPayload`, produit par
    `make_limit_fixture.mjs`. Avant : panique (strip.rs).

The fixture config is work-bounded (sa_max_iterations), so both targets do
exactly the same work regardless of machine speed (AGENTS.md moteur — libm).

Usage:
    python workers/nesting/bench/determinism_lock.py [nest-engine-bin]

Requires: the release binary built (cargo build --release) and the wasm
artifact installed (bash workers/nesting/engine/build-wasm.sh), plus node.
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.abspath(os.path.join(HERE, "..", "engine"))
FIXTURES = [("b_demo", "bpp"), ("e0_volute", "spp"), ("j7a_defaut", "merge"), ("j7a_limite", "spp")]


def jsnum(x):
    """JS String(x) equivalent for tame magnitudes: integers without '.0'."""
    f = float(x)
    if f.is_integer() and abs(f) < 1e15:
        return str(int(f))
    return repr(f)


def canon(alternatives):
    lines = []
    for alt in alternatives:
        cost = alt.get("cost")
        strip = alt.get("strip_width")
        head = ",".join([
            str(alt.get("rank")),
            jsnum(cost) if cost is not None else jsnum(strip),
            jsnum(alt.get("density")),
            str(alt.get("iterations") if alt.get("iterations") is not None else alt.get("evaluations")),
        ])
        sol = alt.get("solution") or {}
        layouts = sol.get("layouts") or ([sol.get("layout")] if sol.get("layout") else [])
        lay_lines = []
        for l in layouts:
            items = []
            for pi in l["placed_items"]:
                t = pi["transformation"]
                items.append(",".join([
                    str(pi["item_id"]),
                    jsnum(t["rotation"]),
                    jsnum(t["translation"][0]),
                    jsnum(t["translation"][1]),
                ]))
            lay_lines.append(";".join(sorted(items)))
        lines.append(head + "#" + "|".join(lay_lines))
    return "\n".join(lines)


def native_hash(bin_path, fixture, problem):
    d = os.path.join(HERE, "fixtures", fixture)
    if problem == "merge":
        # Entrée de `merge_alternatives` (pool de walks navigateur) : même
        # fonction que l'export wasm, appelée par le mode `--merge` du CLI.
        with tempfile.TemporaryDirectory(prefix="nest_det_lock_") as tmp:
            subprocess.run(
                [bin_path, "--merge", os.path.join(d, "merge_input.json"), "-s", tmp],
                check=True, capture_output=True,
            )
            merged = json.load(open(os.path.join(tmp, "merged.json")))
        alternatives = merged["alternatives"]
        return hashlib.sha256(canon(alternatives).encode()).hexdigest(), alternatives
    with tempfile.TemporaryDirectory(prefix="nest_det_lock_") as tmp:
        subprocess.run(
            [bin_path, "-i", os.path.join(d, "instance.json"),
             "-c", os.path.join(d, "config_det.json"),
             "-s", tmp, "-p", problem],
            check=True, capture_output=True,
        )
        alternatives = json.load(open(os.path.join(tmp, "alternatives.json")))
    return hashlib.sha256(canon(alternatives).encode()).hexdigest(), alternatives


def wasm_hash(fixture):
    r = subprocess.run(
        ["node", os.path.join(HERE, "wasm_canon_hash.mjs"), fixture],
        check=True, capture_output=True, text=True,
    )
    return r.stdout.strip().splitlines()[-1]


def main():
    bin_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        ENGINE, "target", "release",
        "nest-engine.exe" if os.name == "nt" else "nest-engine",
    )
    print(f"[lock] native binary: {bin_path}")
    failed = []
    for fixture, problem in FIXTURES:
        nh, alts = native_hash(bin_path, fixture, problem)
        wh = wasm_hash(fixture)
        a = alts[0]
        print(f"[lock] {fixture} ({problem})")
        print(f"[lock]   native SHA-256: {nh}")
        print(f"[lock]   wasm   SHA-256: {wh}")
        print(f"[lock]   native best: cost={a.get('cost')} "
              f"strip_width={a.get('strip_width')} density={a.get('density')} "
              f"iterations={a.get('iterations') or a.get('evaluations')}")
        if nh != wh:
            print(f"[lock]   FAIL — alternatives diverge between native and wasm")
            failed.append(fixture)
    if failed:
        print("[lock] FAIL — " + ", ".join(failed))
        sys.exit(1)
    print(f"[lock] OK — {len(FIXTURES)} fixtures bit-identical (tolerance 0)")


if __name__ == "__main__":
    main()
