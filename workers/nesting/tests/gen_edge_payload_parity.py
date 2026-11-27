"""Génère tests/fixtures/edge_payload_parity.json : les payloads que le worker
Python prépare pour des jobs à distance au bord, rejoués ensuite dans
`buildLocalPayload` par app/tests/edgeDistanceServerParity.test.js.

Chaque cas : {name, input, expected} ; `input` au format du constructeur
navigateur, `expected` = {payload, seed, itemMap} ou, pour un refus,
{error: <code>, edgeDetail: <détail>}.

Usage (depuis workers/nesting) :
  PYTHONPATH="../common;." python tests/gen_edge_payload_parity.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import test_edge_distance as T  # noqa: E402


def main():
    cases = T.build_parity_cases()
    T.PARITY_FILE.parent.mkdir(parents=True, exist_ok=True)
    T.PARITY_FILE.write_text(
        json.dumps(cases, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(cases)} cas écrits dans {T.PARITY_FILE.name}")


if __name__ == "__main__":
    main()
