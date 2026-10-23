import { requireAdmin } from '../../utils/auth'
import { connectDB, COL } from '../../db/mongo'

// Browse the `tracking` event collection (written by server/tracking/add.ts in
// the main app). Each record: { action, country, data, sessionKey, timestamp,
// userBalance, userId }.
//
// Query params: action, userId, country, q (action/userId), page, limit.
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const q = getQuery(event)

  const page = Math.max(1, parseInt(q.page as string) || 1)
  const limit = Math.min(200, Math.max(1, parseInt(q.limit as string) || 100))

  const query: any = {}
  if (q.action) query.action = String(q.action)
  if (q.userId) query.userId = String(q.userId)
  if (q.country) query.country = String(q.country).toUpperCase()
  const search = String(q.q || '').trim()
  if (search) {
    const r = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    query.$or = [{ action: r }, { userId: r }]
  }

  const db = await connectDB()
  const [total, items] = await Promise.all([
    db.collection(COL.tracking).countDocuments(query),
    db
      .collection(COL.tracking)
      .find(query, { projection: { _id: 0, data: 1, action: 1, country: 1, timestamp: 1, userId: 1, userBalance: 1, sessionKey: 1 } })
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray(),
  ])

  return { items, page, limit, total, pages: Math.ceil(total / limit) || 1 }
})
