import { requireAdmin } from '../../utils/auth'
import { connectDB, COL } from '../../db/mongo'
import { csvCell } from '../../utils/csv'

// Paginated, searchable user list with filters.
//
// Query params:
//   q        — free text (matches email/name/id, case-insensitive)
//   provider — 'local' | 'google'
//   status   — 'active' | 'banned' | 'subscriber' | 'granted'
//   country  — signup country code (exact)
//   sort     — 'lastActive' (lastActiveAt desc) | default: createdAt desc
//   page     — 1-based (default 1)
//   limit    — page size (default 50, max 200)
//   emails=1 — e-mails of the NEWSLETTER OPT-IN users only (consent)
//   format=csv — export; the e-mail column is filled for opt-in users only
//
// Every e-mail copy / CSV export is traced in `adminActions` (count only,
// never the addresses).
export default defineEventHandler(async (event) => {
    requireAdmin(event)
    const q = getQuery(event)

    const page = Math.max(1, parseInt(q.page as string) || 1)
    const limit = Math.min(200, Math.max(1, parseInt(q.limit as string) || 50))
    const skip = (page - 1) * limit

    const query: any = {}
    const search = String(q.q || '').trim()
    if (search) {
        const r = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
        query.$or = [{ email: r }, { name: r }, { id: r }]
    }
    if (q.provider) query.provider = q.provider
    if (q.status === 'banned') query.banned = true
    if (q.status === 'subscriber') query['subscription.status'] = { $in: ['trialing', 'active'] }
    if (q.status === 'granted') query.grantedUntil = { $gt: new Date() }
    if (q.status === 'active') query.lastActiveAt = { $gte: new Date(Date.now() - 5 * 60 * 1000) }
    if (q.country) query.signupCountry = String(q.country).toUpperCase()

    // lastActiveAt is a plain user field maintained by the main app (touched
    // on authenticated activity) — sorting on it needs no tracking lookup.
    const sort: Record<string, 1 | -1> = q.sort === 'lastActive' ? { lastActiveAt: -1 } : { createdAt: -1 }

    const db = await connectDB()
    const users = db.collection(COL.users)

    // Bulk-email mode: same filters, but return every matching email (no
    // pagination) so the UI can "copy all filtered emails" in one click —
    // e.g. paste a segment straight into listmonk. Capped defensively.
    if (q.emails === '1') {
        const docs = await users
            .find({ ...query, newsletterOptIn: true }, { projection: { _id: 0, email: 1 } })
            .sort(sort)
            .limit(10000)
            .toArray()
        traceExport(db, event, 'copyEmails', docs.length, q)
        return { emails: docs.map((d: any) => d.email).filter(Boolean), total: docs.length }
    }

    // CSV export mode: same filters, returns a downloadable spreadsheet.
    // BOM + CRLF so Excel opens it with correct accents out of the box.
    if (q.format === 'csv') {
        const docs = await users
            .find(query, {
                projection: {
                    _id: 0, id: 1, email: 1, name: 1, provider: 1, signupCountry: 1,
                    createdAt: 1, lastActiveAt: 1, banned: 1, grantedUntil: 1, subscription: 1,
                    newsletterOptIn: 1,
                },
            })
            .sort(sort)
            .limit(10000)
            .toArray()
        const esc = csvCell
        const statut = (u: any) => {
            if (u.banned) return 'banni'
            if (u.subscription?.status === 'active' || u.subscription?.status === 'trialing') return 'abonne'
            if (u.grantedUntil && new Date(u.grantedUntil) > new Date()) return 'offert'
            return 'gratuit'
        }
        const iso = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : '')
        const header = ['email', 'nom', 'provider', 'pays', 'statut', 'inscrit le', 'derniere activite', 'abonnement', 'fin abonnement', 'newsletter']
        const lines = [header.join(',')]
        for (const u of docs) {
            lines.push(
                [
                    u.newsletterOptIn === true ? u.email || '' : '',
                    u.name || '',
                    u.provider || '',
                    u.signupCountry || '',
                    statut(u),
                    iso(u.createdAt),
                    iso(u.lastActiveAt),
                    u.subscription?.status || '',
                    iso(u.subscription?.currentPeriodEnd),
                    u.newsletterOptIn === true ? 'oui' : 'non',
                ]
                    .map(esc)
                    .join(',')
            )
        }
        traceExport(db, event, 'exportCsv', docs.length, q)
        setHeader(event, 'content-type', 'text/csv; charset=utf-8')
        setHeader(event, 'content-disposition', `attachment; filename="utilisateurs-${new Date().toISOString().slice(0, 10)}.csv"`)
        return '\uFEFF' + lines.join('\r\n')
    }

    const [total, items] = await Promise.all([
        users.countDocuments(query),
        users
            .find(query, {
                projection: {
                    _id: 0,
                    id: 1,
                    provider: 1,
                    email: 1,
                    name: 1,
                    createdAt: 1,
                    lastActiveAt: 1,
                    banned: 1,
                    bannedAt: 1,
                    bannedReason: 1,
                    grantedUntil: 1,
                    subscription: 1,
                    signupCountry: 1,
                    signupIp: 1,
                    isAdmin: 1,
                },
            })
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .toArray(),
    ])

    return {
        items,
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
    }
})

// Audit trail (fire-and-forget, same shape as the other admin actions). The
// trace carries the non-free filters and the row count, never the e-mail list.
function traceExport(db: any, event: any, action: string, count: number, q: Record<string, any>) {
    const admin = requireAdmin(event)
    // The free-text search (`q`) is often an e-mail: only its presence is kept,
    // so the trace holds no personal data that account deletion could miss.
    const filters: Record<string, any> = Object.fromEntries(
        ['provider', 'status', 'country', 'sort'].filter((k) => q[k]).map((k) => [k, String(q[k])]),
    )
    filters.hasSearch = Boolean(String(q.q || '').trim())
    db.collection('adminActions')
        .insertOne({
            targetUserId: null,
            adminId: admin.id,
            adminEmail: admin.email,
            action,
            summary:
                action === 'copyEmails'
                    ? `Copie de ${count} e-mail(s) (newsletter uniquement)`
                    : `Export CSV de ${count} utilisateur(s)`,
            raw: { count, filters },
            at: new Date(),
        })
        .catch(() => {})
}
