#!/usr/bin/env bash
# Attend la fin de vitest, puis : harnais 4 mm (deux configurations, partiels
# attendus avec leviers), puis e2e orphelin de l'implémenteur.
set -u
cd "$(dirname "$0")/../../../../.."
V=docs/qa/perf-audit-2026-09-05/l4-verif/verif-fable
until grep -q "vitest exit" "$V/vitest.log" 2>/dev/null; do sleep 5; done
echo "== harnais 4 mm config 1 (2×1000×1000) $(date -u +%FT%TZ)"
QA_OUT="$V/e2e-4mm-cfg1" QA_SPACE=4 node scripts/qa-e2e-local-2sheets.mjs > "$V/e2e-4mm-cfg1.log" 2>&1; echo "exit $?"
grep -E "placed|partial|PARTIEL|lever|LEVIERS|GO|FAIL|Error" "$V/e2e-4mm-cfg1.log" | tail -8
echo "== harnais 4 mm config 2 (1×1000×2000) $(date -u +%FT%TZ)"
QA_OUT="$V/e2e-4mm-cfg2" QA_SPACE=4 QA_SHEET_H=2000 QA_SHEET_COUNT=1 node scripts/qa-e2e-local-2sheets.mjs > "$V/e2e-4mm-cfg2.log" 2>&1; echo "exit $?"
grep -E "placed|partial|PARTIEL|lever|LEVIERS|GO|FAIL|Error" "$V/e2e-4mm-cfg2.log" | tail -8
echo "== e2e orphelin $(date -u +%FT%TZ)"
QA_OUT="$V/e2e-orphan" node docs/qa/perf-audit-2026-09-05/l4-verif/qa-l4-orphan.mjs > "$V/e2e-orphan.log" 2>&1; echo "exit $?"
tail -12 "$V/e2e-orphan.log"
echo "== fin e2e $(date -u +%FT%TZ)"
