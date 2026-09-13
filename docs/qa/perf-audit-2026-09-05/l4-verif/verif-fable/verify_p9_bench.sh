#!/usr/bin/env bash
# Vérification phase A (lot 4) — 6 runs T-A séquentiels à 0,1 sur image = HEAD,
# machine à vide : secs création→fin, décomposition (prise, moteur, post-pass),
# grille, perPass, postPassTimingsMs. Puis 2 runs à 2 (compaction / fusion).
set -u
cd "$(dirname "$0")/../../../../.."
NET=nestorcut_nest2d
IMG=nest2d-nesting-worker:dev
MONGO="docker exec nestorcut-mongo-1 mongosh --quiet nest2d --eval"
export MSYS_NO_PATHCONV=1

seed_and_wait () {  # <space>
  sp=$1
  slug=$(docker run --rm -i --network $NET -e MONGO_URI=mongodb://mongo:27017/nest2d -e BENCH_SPACE=$sp -e BENCH_BUDGET=120 $IMG python - < workers/nesting/bench/seed_bpp_2sheets.py 2>/dev/null | grep JOB | awk '{print $2}')
  [ -z "$slug" ] && { echo "SEED FAIL"; return; }
  for i in $(seq 1 60); do
    st=$($MONGO "print(db.nesting_jobs.findOne({slug:'$slug'}).status)")
    case "$st" in done|completed|error|failed|cancelled) break;; esac
    sleep 2
  done
  $MONGO "const j=db.nesting_jobs.findOne({slug:'$slug'});const a=(j.result&&j.result.alternatives)||j.alternatives||[];const ts=Object.keys(j).filter(k=>/At$|_ts$|Time|Ms$/.test(k)).reduce((o,k)=>{o[k]=j[k];return o},{});print(JSON.stringify({slug:j.slug,status:j.status,secs:(j.finishedAt-j.createdAt)/1000,pickup:j.startedAt?(j.startedAt-j.createdAt)/1000:null,ts,engineSec:j.report&&(j.report.elapsedSec||j.report.engineElapsedSec),ppMs:j.postPassTimingsMs,discarded:(j.discardedAlternatives||[]).length,alts:a.map(x=>({s:x.strategy,off:x.offcut&&x.offcut.width,counts:(x.report&&x.report.sheets||[]).map(s=>s.partCount),lastOff:(x.report&&x.report.sheets||[]).slice(-1).map(s=>s.offcut&&s.offcut.widthMm+'x'+s.offcut.heightMm)[0],pp:x.report&&x.report.postPass&&{moved:x.report.postPass.residualMoved,merged:x.report.postPass.mergedReceivers,rb:x.report.postPass.compactRollbackReason,okRelayed:x.report.postPass.okRelayed,perPass:x.report.postPass.perPass}}))}))"
}

echo "== $(date -u +%FT%TZ) début P9 — 6 runs à 0,1"
for i in 1 2 3 4 5 6; do seed_and_wait 0.1; done
echo "== 6 runs à 2"
for i in 1 2 3 4 5 6; do seed_and_wait 2; done
echo "== fin $(date -u +%FT%TZ)"
