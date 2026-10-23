import { defineEventHandler } from 'h3'
import { connectDB } from '~~/server/db/mongo'

// Codes d'échec local connus (côté navigateur : localJobPrivate, localPool,
// localSolverRegistry) — seule liste autorisée à entrer dans `error`/`detail`.
const LOCAL_FAIL_CODES = new Set([
    'memory_cap', 'entity_limit', 'geometry_missing', 'local_geometry_missing',
    'all_alternatives_invalid', 'capacity_exceeded', 'item_geometry',
    'part_too_large', 'spacing_too_large', 'crash', 'payload_build',
    'pool_failed', 'merge_failed', 'merge_parse', 'local_interrupted',
    'local_unknown', 'engine_error',
])

/**
 * Phase 2 (flag-gated QA): the browser reports a local solve failure (engine
 * error, allocation refused, timeout). The job is marked failed and the
 * quota consumed at enqueue is REFUNDED inline — same semantics as the
 * worker's refund (worker_common/refund.py stays the reference): free →
 * freeNestingUsed -1, demo → demoNestingUsed -1, grant/subscription →
 * nothing was consumed. Guarded $gt: 0 like the worker.
 */
export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }
    const config = useRuntimeConfig(event)
    const enabled = config.public.localComputeEnabled === true || config.public.localComputeEnabled === 'true'
    if (!enabled) {
        throw createError({ statusCode: 404, statusMessage: 'Not found' })
    }

    const slug = getRouterParam(event, 'slug')
    const db = await connectDB()
    const job = await db.collection('nesting_jobs').findOne({ slug })
    // Owner-only, demo included (same rule as local-result): refunding or
    // failing someone else's job is never allowed.
    if (!job || job.ownerId !== userId) {
        throw createError({ statusCode: 404, statusMessage: 'Job not found' })
    }
    if (job.status !== 'awaiting_local') {
        throw createError({ statusCode: 409, statusMessage: 'Job is not awaiting local compute' })
    }

    const body = await readBody(event)
    // Raison TOUJOURS non vide et stable : `information` garde le message
    // brut du navigateur (code stable `memory_cap`, `payload_build`… ou
    // texte moteur) que l'UI interprète ; `error` (string) et `errorCode`
    // sont posés en plus — c'est ce que lisent l'admin, les stats et les
    // sweepers (constat prod 2026-10-23 : 78 échecs navigateur sur 87
    // n'avaient AUCUN `error` — seul `information` était posé, et la
    // projection admin ne l'expose pas).
    const message = String(body?.error || '').trim().slice(0, 400) || 'local_unknown'
    // Vie privée (décision propriétaire 27/09 : événements navigateur en
    // CATÉGORIES, jamais de nom ni de contenu de fichier) : `detail` est du
    // texte libre côté client (e.message brut) qui peut citer un nom de
    // fichier ou de pièce. On ne le garde QUE s'il est exactement l'un des
    // codes connus ; tout autre texte est jeté. De même `errorCode` n'est
    // posé que pour un code connu, sinon `engine_error` (la catégorie).
    const detailRaw = String(body?.detail || '').trim()
    const detail = LOCAL_FAIL_CODES.has(detailRaw) ? detailRaw : ''
    const errorCode = LOCAL_FAIL_CODES.has(message) ? message : 'engine_error'
    const errorText = detail && detail !== message ? `${message}: ${detail}`.slice(0, 500) : message
    // Plan 2026-09-05 §1.2b : `unfit` structuré (infaisabilité bande /
    // capacité) persisté avec l'échec pour le bandeau UI.
    const unfit = body?.unfit && typeof body.unfit === 'object'
        ? {
            reason: String(body.unfit.reason || 'layout').slice(0, 32),
            ratio: Number.isFinite(Number(body.unfit.ratio)) ? Number(body.unfit.ratio) : undefined,
            sheetsNeeded: Number.isFinite(Number(body.unfit.sheetsNeeded)) ? Number(body.unfit.sheetsNeeded) : undefined,
            maxPartsAtSpacing: Number.isFinite(Number(body.unfit.maxPartsAtSpacing)) ? Number(body.unfit.maxPartsAtSpacing) : undefined,
            maxSpacingForFitMm: Number.isFinite(Number(body.unfit.maxSpacingForFitMm)) ? Number(body.unfit.maxSpacingForFitMm) : undefined,
            bestStripWidthMm: Number.isFinite(Number(body.unfit.bestStripWidthMm)) ? Number(body.unfit.bestStripWidthMm) : undefined,
        }
        : undefined

    // Lot E0 : pièce dont le moteur a refusé la géométrie (slug du fichier +
    // index de la pièce dans ce fichier). Champ ADDITIF : les jobs d'avant
    // n'en ont pas et s'affichent comme avant.
    const geom = body?.geom && typeof body.geom === 'object' && body.geom.slug
        ? {
            slug: String(body.geom.slug).slice(0, 128),
            part: Number.isFinite(Number(body.geom.part)) ? Math.max(0, Math.trunc(Number(body.geom.part))) : 0,
        }
        : undefined

    // Transition ATOMIQUE d'abord (même verrou que expireStaleTakenAwaitingLocal) :
    // filtre sur le statut `awaiting_local`. Un sweeper ou un local-result
    // concurrent qui a déjà basculé le job (done/cancelled/error) fait
    // échouer ce match → 409, aucun remboursement, aucun écrasement d'un job
    // `done`. `charge.refunded` n'est pas dans le filtre : tout chemin qui le
    // pose fait aussi sortir le job de `awaiting_local`. Le remboursement
    // n'a lieu que si CETTE transition a matché exactement 1 document.
    const alreadyRefunded = Boolean(job.charge?.refunded)
    const res = await db.collection('nesting_jobs').updateOne(
        { slug, ownerId: userId, status: 'awaiting_local' },
        {
            $set: {
                status: 'error',
                placed: 0,
                information: message,
                error: errorText,
                errorCode,
                finishedAt: new Date(),
                update_ts: new Date(),
                ...(unfit ? { unfit } : {}),
                ...(geom ? { itemGeometry: geom } : {}),
                ...(alreadyRefunded ? {} : { 'charge.refunded': true }),
            },
            $unset: { progress: '', compute: '', localPayload: '', liveLayout: '' },
        }
    )
    if (res?.matchedCount !== 1) {
        throw createError({ statusCode: 409, statusMessage: 'Job is not awaiting local compute' })
    }

    // Inline refund — mirror of worker_common/refund.py (kept as reference).
    const chargeType = job.charge?.type
    if (!alreadyRefunded && chargeType === 'free') {
        await db.collection('users').updateOne(
            { id: job.ownerId, freeNestingUsed: { $gt: 0 } },
            { $inc: { freeNestingUsed: -1 } }
        )
    } else if (!alreadyRefunded && chargeType === 'demo' && !job.charge?.skippedQuota) {
        await db.collection('users').updateOne(
            { id: job.ownerId, demoNestingUsed: { $gt: 0 } },
            { $inc: { demoNestingUsed: -1 } }
        )
    }
    return { ok: true }
})
