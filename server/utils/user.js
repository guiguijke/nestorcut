import { connectDB } from '~~/server/db/mongo'
import { generateSession, purgeExpiredSessions, pushSessionUpdate, SESSION_TTL_MS } from './auth'
import { sendWelcomeMessage } from '~~/server/features/support/welcomemessage'
import { notifyAdminNewUser } from '~~/server/features/notification/adminNotify'
import { COUNTRY_HEADER_NAME } from '~~/server/tracking/const'
import { downloadAndStoreAvatar } from './avatar'
import logger from './logger'
import { clientIp } from './ratelimit'
import { logRef } from './logRef'

// Une adresse = une méthode de connexion (décision du propriétaire,
// 2026-11-03) : pas de liaison automatique avec un compte e-mail + mot de
// passe. Son titulaire réel le reprend par « mot de passe oublié » — le lien
// part dans sa boîte et la réinitialisation coupe toutes les sessions.
function emailTakenByOtherAccount(provider) {
    const code = provider === 'local' ? 'email_taken_local' : 'email_taken'
    return createError({ statusCode: 409, statusMessage: 'An account with this email already exists', data: { code } })
}

// L'index unique porte sur `email` tel que stocké : l'inscription locale le
// met en minuscules, Google le rend tel quel.
function findOtherAccountWithEmail(db, userId, email) {
    return db.collection('users').findOne(
        { id: { $ne: userId }, email: { $in: [...new Set([email, email.toLowerCase()])] } },
        { projection: { provider: 1 } },
    )
}

export async function createOrUpdateUser({ event, sessionId, providerId, email, name, avatarUrl }) {
    if (!providerId || !email || !name) {
        logger.error('Missing required user data', {
            userRef: logRef(providerId),
            hasProviderId: !!providerId,
            hasEmail: !!email,
            hasName: !!name,
        })
        throw new Error('Missing required user data')
    }

    const session = generateSession()
    const db = await connectDB()

    const userId = `google:${providerId}`
    const isUserExists = await db.collection('users').findOne({ id: userId })

    // Banned accounts cannot authenticate via Google either.
    if (isUserExists?.banned) {
        throw new Error('This account has been suspended')
    }

    // Avant l'avatar : un refus ne laisse aucun fichier orphelin.
    const otherAccount = await findOtherAccountWithEmail(db, userId, email)
    if (otherAccount) {
        throw emailTakenByOtherAccount(otherAccount.provider)
    }

    const avatarKey = await downloadAndStoreAvatar(providerId, avatarUrl)

    // Geo + provenance captured at signup (admin panel). Only meaningful on
    // first insert; we pass them via $setOnInsert so they never overwrite a
    // real signup country on subsequent logins.
    const signupCountry = event ? event.node.req.headers[COUNTRY_HEADER_NAME] || null : null
    const signupIp = event ? clientIp(event) : null

    const updateData = {
        $set: {
            provider: 'google',
            email,
            name,
            avatarFileName: avatarKey,
        },
        $setOnInsert: {
            createdAt: new Date(),
            freeNestingUsed: 0,
            // Measurement unit preference ('mm' | 'inch') — default metric.
            preferredUnit: 'mm',
            signupCountry,
            signupIp,
            // Google accounts are verified by Google itself — no email
            // verification step needed (unlike local signups).
            emailVerified: true,
        },
        $push: {
            sessions: pushSessionUpdate(session),
        },
    }

    // S-4 : purge des sessions expirées avant d'ajouter la nouvelle.
    await purgeExpiredSessions(db, { id: userId })
    try {
        await db.collection('users').updateOne({ id: userId }, updateData, { upsert: true })
    } catch (err) {
        // Compte e-mail créé entre la vérification et l'écriture.
        if (err?.code !== 11000) throw err
        const taken = await findOtherAccountWithEmail(db, userId, email)
        throw emailTakenByOtherAccount(taken?.provider)
    }

    if (!isUserExists) {
        try {
            await sendWelcomeMessage(userId)
        } catch (err) {
            logger.warn('Error sending welcome message', err)
        }
        // Best-effort admin notification for new Google signups.
        if (event) {
            notifyAdminNewUser(event, { id: userId, email, name, provider: 'google' }).catch((err) => {
                logger.warn('Error notifying admin of new signup', err)
            })
        }
    }

    await db
        .collection('tracking')
        .updateMany({ sessionKey: sessionId, userId: { $exists: false } }, { $set: { userId: userId } })

    return session
}

/**
 * Sets the session cookie in the response
 * @param {Object} event - The H3 event object
 * @param {Object} session - The session object containing sessionId and expiresAt
 */
export function setSessionCookie(event, session) {
    setCookie(event, 'sessionId', session.sessionId, {
        expires: new Date(session.expiresAt),
        maxAge: SESSION_TTL_MS / 1000,
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
    })
}
