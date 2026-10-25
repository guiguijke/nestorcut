import bcrypt from 'bcryptjs'
import { connectDB } from '../../db/mongo'
import { generateSession, setAdminSessionCookie } from '../../utils/sessions'
import { reserveLoginAttempt, resetLoginFailures } from '../../utils/loginRateLimit'

// Admin login. Email + password → bcrypt verify → session cookie.
//
// We compare against a dummy hash when the admin is unknown so that timing
// stays constant (limits user enumeration), mirroring the main app's login.
const DUMMY_HASH =
  '$2a$10$CwTycUXWue0Thq9StjUM0uJ8.0a7sQ2f3AaFv1lFq1nU5Xm9c.W.'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const email = String(body?.email || '').trim().toLowerCase()
  const password = String(body?.password || '')

  if (!email || !password) {
    throw createError({ statusCode: 400, statusMessage: 'Email et mot de passe requis.' })
  }

  // S-6 : 5 échecs / 15 min par IP et par identifiant. IP = adresse du socket
  // (jamais X-Forwarded-For, falsifiable ; l'admin n'est pas derrière Cloudflare).
  const ip = getRequestIP(event, { xForwardedFor: false }) || 'unknown'
  // La tentative est RÉSERVÉE avant le bcrypt (une rafale parallèle ne passe pas).
  const waitMs = reserveLoginAttempt(ip, email)
  if (waitMs > 0) {
    const retryAfterSec = Math.max(1, Math.ceil(waitMs / 1000))
    setHeader(event, 'Retry-After', String(retryAfterSec))
    throw createError({ statusCode: 429, statusMessage: 'Trop de tentatives. Réessayez plus tard.', data: { retryAfterSec } })
  }

  const db = await connectDB()
  const admin = await db.collection('admins').findOne({ email })

  const hash = admin?.passwordHash || DUMMY_HASH
  const ok = await bcrypt.compare(password, hash)

  if (!admin || !ok) {
    throw createError({ statusCode: 401, statusMessage: 'Identifiants invalides.' })
  }

  resetLoginFailures(email, ip)
  const session = generateSession()
  await db.collection('admins').updateOne(
    { _id: admin._id },
    {
      $push: { sessions: { tokenHash: session.tokenHash, createdAt: session.createdAt, expiresAt: session.expiresAt } },
      $set: { lastActiveAt: new Date() },
    },
  )

  setAdminSessionCookie(event, session.token, session.expiresAt)

  return {
    ok: true,
    admin: {
      id: admin.id,
      email: admin.email,
      name: admin.name,
    },
  }
})
