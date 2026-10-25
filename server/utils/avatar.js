import { getAvatarBucket } from '../db/mongo'
import logger from './logger'
import { logRef } from './logRef'

// L'URL d'avatar vient de Google (champ `picture` de server/api/auth/google/login.post.js) :
// on ne telecharge que du https vers *.googleusercontent.com, jamais un hote arbitraire (SSRF).
const ALLOWED_HOST_SUFFIX = '.googleusercontent.com'
export const AVATAR_FETCH_TIMEOUT_MS = 10_000
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024

/**
 * @param {string} avatarUrl
 * @returns {URL} l'URL validee (https + hote Google d'avatar), sinon throw
 */
export function assertAllowedAvatarUrl(avatarUrl) {
    let url
    try {
        url = new URL(avatarUrl)
    } catch {
        throw new Error('Avatar URL invalid')
    }
    if (url.protocol !== 'https:') throw new Error('Avatar URL must be https')
    if (url.username || url.password || url.port) throw new Error('Avatar URL not allowed')
    if (!url.hostname.endsWith(ALLOWED_HOST_SUFFIX)) throw new Error('Avatar host not allowed')
    return url
}

/**
 * Telecharge un avatar avec allowlist d'hote, timeout, plafond de taille
 * (controle sur le flux) et content-type image/*. Aucune redirection suivie.
 * @param {string} avatarUrl
 * @returns {Promise<Buffer>}
 */
export async function fetchAvatarBuffer(avatarUrl) {
    const url = assertAllowedAvatarUrl(avatarUrl)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), AVATAR_FETCH_TIMEOUT_MS)
    try {
        const response = await fetch(url, { signal: controller.signal, redirect: 'error' })
        if (!response.ok) throw new Error(`Avatar fetch failed: HTTP ${response.status}`)

        const type = (response.headers.get('content-type') || '').toLowerCase()
        if (!type.startsWith('image/')) throw new Error('Avatar content-type not allowed')

        const declared = Number(response.headers.get('content-length'))
        if (declared > AVATAR_MAX_BYTES) throw new Error('Avatar too large')

        const chunks = []
        let total = 0
        if (response.body) {
            for await (const chunk of response.body) {
                total += chunk.length
                if (total > AVATAR_MAX_BYTES) {
                    controller.abort()
                    throw new Error('Avatar too large')
                }
                chunks.push(chunk)
            }
        }
        return Buffer.concat(chunks)
    } finally {
        clearTimeout(timer)
    }
}

/**
 * Downloads and stores an avatar in MongoDB GridFS.
 * Chemin de login Google : un refus du telechargement (hote, timeout, taille,
 * type, redirection, URL morte) ne doit JAMAIS bloquer la connexion. On garde
 * alors l'avatar deja stocke (cle renvoyee) ou null (repli /api/user/avatar).
 * @param {string} userId - The user's ID
 * @param {string} avatarUrl - The URL of the avatar to download
 * @returns {Promise<string|null>} The avatar file name, or null if none available
 */
export async function downloadAndStoreAvatar(userId, avatarUrl) {
    const avatarBucket = await getAvatarBucket()
    const avatarKey = `avatar-${userId}.jpg`
    let buffer
    try {
        buffer = await fetchAvatarBuffer(avatarUrl)
    } catch (error) {
        logger.warn('Avatar download failed at login', logRef(userId), error)
        const existing = await avatarBucket.find({ filename: avatarKey }).toArray()
        return existing.length ? avatarKey : null
    }

    // Delete old avatar if exists
    const oldAvatarFiles = await avatarBucket
        .find({ filename: avatarKey })
        .toArray()

    for (const oldAvatarFile of oldAvatarFiles) {
        await avatarBucket.delete(oldAvatarFile._id)
    }

    // Upload new avatar
    await new Promise((resolve, reject) => {
        const uploadStream = avatarBucket.openUploadStream(avatarKey)
        uploadStream.on('finish', resolve)
        uploadStream.on('error', reject)
        uploadStream.write(buffer)
        uploadStream.end()
    })
    return avatarKey
}
