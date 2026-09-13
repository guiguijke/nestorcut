#!/usr/bin/env bash
# Corpus T-A..T-K sur image = HEAD, puis fiche eval_corpus (avec perPass).
set -u
cd "$(dirname "$0")/../../../../.."
NET=nestorcut_nest2d
IMG=nest2d-nesting-worker:dev
MONGO="docker exec nestorcut-mongo-1 mongosh --quiet nest2d --eval"
export MSYS_NO_PATHCONV=1
SINCE=$(date +%s)
echo "== corpus seed $(date -u +%FT%TZ) SINCE=$SINCE"
docker run --rm -i --network $NET -e MONGO_URI=mongodb://mongo:27017/nest2d -e CORPUS_CASES=A,B,C,D,E,F,G,H,I,J,K $IMG python - < workers/nesting/bench/seed_corpus.py 2>/dev/null | tail -3
for i in $(seq 1 120); do
  n=$($MONGO "print(db.nesting_jobs.countDocuments({slug:{\$regex:'^bench-corpus-'},createdAt:{\$gte:new Date($SINCE*1000)},status:{\$in:['pending','processing','awaiting_local']}}))")
  [ "$n" = "0" ] && break
  sleep 5
done
echo "== eval $(date -u +%FT%TZ)"
docker run --rm -i --network $NET -e MONGO_URI=mongodb://mongo:27017/nest2d -e CORPUS_SINCE=$SINCE $IMG python - < workers/nesting/bench/eval_corpus.py 2>/dev/null
echo "== fin corpus $(date -u +%FT%TZ)"
