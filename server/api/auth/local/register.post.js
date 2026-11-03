import bcrypt from 'bcryptjs'
import { connectDB } from '~~/server/db/mongo'
import { generateSession, storedSession } from '~~/server/utils/auth'
import { setSessionCookie } from '~~/server/utils/user'
import { sendWelcomeMessage } from '~~/server/features/support/welcomemessage'
import { notifyAdminNewUser } from '~~/server/features/notification/adminNotify'
import { sendEmailVerification } from '~~/server/features/notification/emailVerification'
import { subscribeToNewsletter } from '~~/server/features/listmonk/subscribe'
import { COUNTRY_HEADER_NAME } from '~~/server/tracking/const'
import logger from '~~/server/utils/logger'
import { assertRateLimit, clientIp } from '~~/server/utils/ratelimit'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Adresse prise par un compte Google : « connectez-vous » ne suffit pas, le
// mot de passe n'existe pas — le client propose la connexion Google.
function emailTaken(provider) {
    const code = provider === 'google' ? 'email_taken_google' : 'email_taken'
    return createError({ statusCode: 409, statusMessage: 'An account with this email already exists', data: { code, field: 'email' } })
}

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig(event)
    if (config.public.localAuthEnabled === false || config.public.localAuthEnabled === 'false') {
        throw createError({ statusCode: 403, statusMessage: 'Local authentication is disabled', data: { code: 'auth_disabled' } })
    }

    const body = await readBody(event)
    const email = String(body?.email || '')
        .trim()
        .toLowerCase()
    const name = String(body?.name || '').trim()
    const password = String(body?.password || '')
    // GDPR: newsletter is strictly opt-in (checkbox never pre-ticked).
    const newsletterOptIn = body?.newsletterOptIn === true

    if (!EMAIL_RE.test(email)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid email', data: { code: 'invalid_email', field: 'email' } })
    }
    if (!name || name.length < 1 || name.length > 80) {
        throw createError({ statusCode: 400, statusMessage: 'Name is required', data: { code: 'name_required', field: 'name' } })
    }
    if (password.length < 8) {
        throw createError({ statusCode: 400, statusMessage: 'Password must be at least 8 characters', data: { code: 'password_too_short', field: 'password' } })
    }

    assertRateLimit(event, 'register-ip', { limit: 5, windowMs: 60 * 60_000 })

    const db = await connectDB()
    const userId = `local:${email}`

    // L'index unique porte sur `email`, tous fournisseurs confondus : une
    // adresse déjà prise par un compte Google passait le contrôle par `id`
    // et finissait en E11000 → 500 (constat 2026-11-03).
    const existing = await db.collection('users').findOne(
        { $or: [{ id: userId }, { email }] },
        { projection: { provider: 1 } },
    )
    if (existing) {
        throw emailTaken(existing.provider)
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const session = generateSession()

    try {
        await db.collection('users').insertOne({
            id: userId,
            provider: 'local',
            email,
            name,
            // No avatar file; /api/user/avatar returns a generated placeholder.
            avatarFileName: null,
            avatarUrl: null,
            passwordHash,
            sessions: [storedSession(session)],
            createdAt: new Date(),
            freeNestingUsed: 0,
            // Measurement unit preference ('mm' | 'inch') — default metric;
            // switchable via PATCH /api/user/preferences.
            preferredUnit: 'mm',
            // Local signups must verify their email before nesting (anti-fake).
            emailVerified: false,
            newsletterOptIn,
            newsletterOptInAt: newsletterOptIn ? new Date() : null,
            // Geo + provenance, captured at signup for the admin panel. Country
            // comes from Cloudflare's cf-ipcountry header (null without it).
            signupCountry: event.node.req.headers[COUNTRY_HEADER_NAME] || null,
            signupIp: clientIp(event),
        })
    } catch (err) {
        // Deux inscriptions simultanées (ou une connexion Google) entre le
        // contrôle et l'insertion : même réponse que le contrôle.
        if (err?.code === 11000) throw emailTaken()
        throw err
    }

    // The verification email is the core of the anti-fake flow, but a mailer
    // outage must not break the signup — the user can request a new link
    // from the check-email page.
    try {
        await sendEmailVerification(event, userId, email)
    } catch (err) {
        logger.error('Failed to send verification email:', err)
    }

    if (newsletterOptIn) {
        // Best-effort, never blocks registration.
        subscribeToNewsletter(event, { email, name }).catch((err) => {
            logger.warn('listmonk subscription error:', err)
        })
    }

    // D7 (C1-b) : fire-and-forget — les 3 s d'écriture du message de
    // bienvenue ne tiennent plus la réponse d'inscription.
    sendWelcomeMessage(userId).catch((err) => {
        logger.warn('Error sending welcome message', err)
    })

    // Best-effort admin notification (never blocks registration).
    notifyAdminNewUser(event, { id: userId, email, name, provider: 'local' }).catch((err) => {
        logger.warn('Error notifying admin of new signup', err)
    })

    setSessionCookie(event, session)
    // C1-a : l'e-mail revient avec la réponse — la page check-email
    // l'affiche (faute de frappe visible immédiatement).
    return { ok: true, needsVerification: true, email }
})
