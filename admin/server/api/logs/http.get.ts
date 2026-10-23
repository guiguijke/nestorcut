import { requireAdmin } from '../../utils/auth'
import { connectDB, COL } from '../../db/mongo'

// Browse the `http` request-log collection (written by the main app's
// middleware 1_log-requests.js).
//
// Le journal ne contient que { method, route, statusCode, duration, isSSE,
// timestamp } (S-1) : ni URL, ni userId, ni contenu, 14 jours de rétention.
//
// Query params: route (motif de route), method, statusMin, statusMax, windowDays, page, limit.
// The collection can be huge, so we ALWAYS filter by a recent time window
// (default 24h, max 14d) and rely on the timestamp index.
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const q = getQuery(event)

  const windowDays = Math.min(14, Math.max(1, parseInt(q.windowDays as string) || 1))
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)

  const page = Math.max(1, parseInt(q.page as string) || 1)
  const limit = Math.min(200, Math.max(1, parseInt(q.limit as string) || 100))

  const query: any = { timestamp: { $gte: since } }
  const route = String(q.route || '').trim()
  if (route) {
    query.route = new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  }
  if (q.method) query.method = String(q.method).toUpperCase()
  const statusMin = parseInt(q.statusMin as string)
  const statusMax = parseInt(q.statusMax as string)
  if (!isNaN(statusMin) || !isNaN(statusMax)) {
    query.statusCode = {}
    if (!isNaN(statusMin)) query.statusCode.$gte = statusMin
    if (!isNaN(statusMax)) query.statusCode.$lte = statusMax
  }

  const db = await connectDB()
  const [total, items] = await Promise.all([
    db.collection(COL.http).countDocuments(query),
    db
      .collection(COL.http)
      .find(query, { projection: { _id: 0, method: 1, route: 1, statusCode: 1, duration: 1, isSSE: 1, timestamp: 1 } })
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray(),
  ])

  return { items, page, limit, total, pages: Math.ceil(total / limit) || 1, windowDays }
})
