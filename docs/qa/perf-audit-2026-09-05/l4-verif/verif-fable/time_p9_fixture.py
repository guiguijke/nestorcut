"""Chronométrage P9 : même fixture BPP déterministe (b_demo, config_det),
binaire pré-P9 (6c9283f) contre binaire HEAD (P9), N runs chacun, alternés,
machine à vide. Sortie : temps mur, itérations, ms/itération, médiane."""
import json
import os
import statistics
import subprocess
import sys
import tempfile
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../.."))
FIX = os.path.join(ROOT, "workers/nesting/bench/fixtures/b_demo")
BINS = {
    "pre-P9": r"C:/Users/guiguijke/.claude/jobs/b6cdf1c7/tmp/target-prep9/release/nest-engine.exe",
    "P9": os.path.join(ROOT, "workers/nesting/engine/target/release/nest-engine.exe"),
}
N = int(sys.argv[1]) if len(sys.argv) > 1 else 5
CONFIG = sys.argv[2] if len(sys.argv) > 2 else os.path.join(FIX, "config_det.json")


def run(bin_path):
    with tempfile.TemporaryDirectory(prefix="p9time_") as tmp:
        t0 = time.perf_counter()
        subprocess.run([bin_path, "-i", os.path.join(FIX, "instance.json"),
                        "-c", CONFIG, "-s", tmp, "-p", "bpp"],
                       check=True, capture_output=True)
        dt = time.perf_counter() - t0
        alts = json.load(open(os.path.join(tmp, "alternatives.json")))
    it = alts[0].get("iterations")
    return dt, it, alts[0].get("cost"), alts[0].get("density")


res = {k: [] for k in BINS}
for i in range(N):
    for name, b in BINS.items():
        dt, it, cost, dens = run(b)
        res[name].append((dt, it, cost, dens))
        print(f"{name:7s} run {i+1}: {dt*1000:7.0f} ms  iterations={it}  cost={cost} density={dens}")
for name, rows in res.items():
    ms = [r[0] * 1000 for r in rows]
    its = [r[1] or 0 for r in rows]
    per_it = [m / i for m, i in zip(ms, its) if i]
    print(f"== {name}: médiane {statistics.median(ms):.0f} ms, itérations {its[0]}, "
          f"ms/itération médiane {statistics.median(per_it):.1f}")
