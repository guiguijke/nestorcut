import { requireAdmin } from '../../utils/auth'
import { connectDB, COL } from '../../db/mongo'

// Job monitoring of the nesting queue. (Le pipeline « strip » a été retiré
// le 2026-09-13 : sa file est figée, ses documents restent en base.)
//
// Query params:
//   status  — pending | processing | awaiting_local | done | error | cancelled (default: pending | processing | awaiting_local | error)
//   ownerId — filter by user
//   page, limit
//
// Returns a merged, recent list. We project a small set of fields to keep the
// payload light; jobs can carry large result blobs we never need here.
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const q = getQuery(event)

  const page = Math.max(1, parseInt(q.page as string) || 1)
  const limit = Math.min(200, Math.max(1, parseInt(q.limit as string) || 50))

  const baseQuery: any = {}
  if (q.status) baseQuery.status = String(q.status)
  else baseQuery.status = { $in: ['pending', 'processing', 'awaiting_local', 'error'] }
  if (q.ownerId) baseQuery.ownerId = String(q.ownerId)

  // `information` : avant le 23/10, local-fail n'écrivait la cause d'un échec
  // navigateur QUE là (jamais dans `error`) — sans ce champ, 81 échecs sur 87
  // paraissaient sans motif. `reason` = la cause lisible, quel que soit le champ.
  const proj = { _id: 0, slug: 1, ownerId: 1, status: 1, processingStatus: 1, projectSlug: 1, createdAt: 1, update_ts: 1, error: 1, errorCode: 1, information: 1, priority: 1 }

  const db = await connectDB()
  const merged = (
    await db
      .collection(COL.nestingJobs)
      .find(baseQuery, { projection: proj })
      .sort({ update_ts: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray()
  ).map((r: any) => {
    const info = r.status === 'error' && r.information != null
      ? (typeof r.information === 'string' ? r.information : JSON.stringify(r.information))
      : null
    return { ...r, reason: r.error || info || r.errorCode || null, system: 'nesting' }
  })

  return {
    items: merged.slice(0, limit),
    page,
    limit,
    counts: {
      classic: await db.collection(COL.nestingJobs).countDocuments({ status: baseQuery.status }),
    },
  }
})
