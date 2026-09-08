from worker_common.mongo import db
from worker_common.refund import refund_charge
import os

from worker_common.worker_loop import WorkerConfig, run_worker

from core.main import JobCancelled, nesting_process

nesting_jobs = db["nesting_jobs"]


def _on_success(doc):
    db["users"].update_one({"id": doc["ownerId"]}, {"$inc": {"nesting_count": 1}})


def _token_cost(doc):
    """Job cost in the shared vcore pool: the tier's vcores, set server-side
    at enqueue (params.vcores). Legacy jobs without the field cost 1.

    LOCAL-PREP jobs (computeLocation=local, the worker only builds the
    payload — the browser solves) cost 1: they burn no engine vcores, and
    charging the full tier (8 for Pro > pool 4 sur le serveur 2 vCPU,
    constat QA 2026-08-30) gelait la préparation ET la vue client."""
    if (doc.get("params") or {}).get("computeLocation") == "local" or doc.get("computeLocation") == "local":
        return 1
    return max(1, int((doc.get("params") or {}).get("vcores") or 1))


run_worker(
    WorkerConfig(
        name="main_nesting",
        collection="nesting_jobs",
        process=nesting_process,
        status_field="status",
        done_status="done",
        error_field="error",
        # Priority queue: lower priority value dequeued first (tiered compute),
        # FIFO within the same priority. Jobs without the field (enqueued before
        # the feature) sort as null and are picked up first — they waited longest.
        sort=[("priority", 1), ("createdAt", 1)],
        # Phase B (instruction vérificateur, verrou 15 s) : délai de
        # sondage de la file en env — défaut 1 s (l'ancien 5 s coûtait
        # ~2,5 s en moyenne par job sur la latence création→fin).
        idle_sleep=float(os.environ.get("NEST_WORKER_POLL_SEC", "1")),
        track_timing=True,
        on_success=_on_success,
        refund=lambda doc: refund_charge(nesting_jobs, doc),
        cancelled_exception=JobCancelled,
        token_cost=_token_cost,
    )
)
