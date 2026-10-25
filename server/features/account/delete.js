import {
    connectDB,
    getAvatarBucket,
    getBucket,
} from '~~/server/db/mongo'
import { clearVaultSessions } from '~~/server/utils/vault'
import {
    cancelSubscriptionImmediately,
    deleteCustomer,
} from '~~/server/features/payment/stripe'
import { unsubscribeFromNewsletter } from '~~/server/features/listmonk/unsubscribe'
import { sendAccountDeletedEmail } from '~~/server/features/notification/sendEmail'
import logger from '~~/server/utils/logger'
import { logRef } from '~~/server/utils/logRef'

/**
 * Full account deletion (GDPR right to erasure), self-serve from the profile
 * page. Immediate and irreversible.
 *
 * Covers every trace of the user across the system:
 *  - Stripe: active/trialing subscription canceled IMMEDIATELY (the account
 *    disappears, so the usual cancel-at-period-end grace is meaningless),
 *    then the customer is deleted so late webhooks hit nothing.
 *  - listmonk: subscriber record removed whatever the opt-in (an opted-out
 *    user stays in listmonk as a blocklisted record with e-mail and name).
 *  - Running jobs: pending jobs are marked cancelled, processing jobs get
 *    cancelRequested (the bin-nesting worker polls it every ~2 s and stops
 *    cleanly; the strip worker ignores it — harmless). Compute-pool leases
 *    are keyed by job id and reaped automatically after 60 s without
 *    heartbeat, so there is nothing to release here.
 *  - GridFS: every file across the 7 content buckets (metadata.ownerId) plus
 *    the avatar (linked by filename, no ownerId metadata). Crypto-shredding
 *    works for vault-encrypted files — no DEK needed to delete ciphertext.
 *  - Mongo collections: owner-scoped (projects, files, jobs) and user-scoped
 *    (tokens with NO TTL index, vault sessions, checkouts, support messages,
 *    tracking). payment_failures are matched by userId, e-mail AND Stripe
 *    customer id (a failure recorded before the user was resolved carries
 *    userId null).
 *  - adminActions: anonymized (targetUserId nulled, summary and raw emptied)
 *    rather than deleted, so the audit trail keeps the action itself (who,
 *    what, when) without personal data.
 *  - accounting_entries: KEPT — legal bookkeeping (see step 5). Holds only
 *    the Stripe invoice id and amounts, no user reference.
 *  - users: the document itself, deleted LAST (every step above needs it).
 *
 * External calls (Stripe, listmonk, email) are best-effort: their failure
 * must never block the erasure. A tiny race remains with in-flight workers
 * (a job deleted mid-write can leave an ownerless GridFS file) — accepted
 * and bounded to a few seconds. Such an orphan file is NOT anonymous: its
 * metadata.ownerId is the user id, i.e. `local:<email>` for an e-mail account
 * (the worker treats a vanished job document as a cancellation to avoid it).
 *
 * @param {object} event H3 event (runtime config access for listmonk)
 * @param {object} user the full user document (must include id, email,
 *   provider, subscription, stripeCustomerId, newsletterOptIn)
 * @returns {Promise<object>} deletion summary (counts, for logs)
 */
export async function deleteUserAccount(event, user) {
    const userId = user.id
    const ref = logRef(userId)
    const db = await connectDB()
    const summary = { userId }

    // 1. Stripe — cancel the subscription right away, then drop the customer.
    if (user.subscription?.stripeSubscriptionId) {
        try {
            await cancelSubscriptionImmediately(user.subscription.stripeSubscriptionId)
            summary.stripeSubscriptionCanceled = true
        } catch (err) {
            logger.warn(`Account deletion: Stripe subscription cancel failed for ${ref}:`, err?.data || err?.message || err)
        }
    }
    if (user.stripeCustomerId) {
        try {
            await deleteCustomer(user.stripeCustomerId)
            summary.stripeCustomerDeleted = true
        } catch (err) {
            logger.warn(`Account deletion: Stripe customer delete failed for ${ref}:`, err?.data || err?.message || err)
        }
    }

    // 2. listmonk — remove the subscriber whatever the opt-in: an opted-out
    //    user is only blocklisted there, e-mail and name included.
    if (user.email) {
        summary.newsletterUnsubscribed = await unsubscribeFromNewsletter(event, { email: user.email })
    }

    // 3. Stop active jobs before wiping. pending → cancelled (never picked
    //    up), processing → cancelRequested (polled by the bin worker).
    const now = new Date()
    for (const name of ['nesting_jobs', 'strip_nesting_job_queue']) {
        const col = db.collection(name)
        await col.updateMany(
            { ownerId: userId, status: 'pending' },
            { $set: { status: 'cancelled', information: 'Account deleted.', update_ts: now } }
        )
        await col.updateMany(
            { ownerId: userId, status: 'processing' },
            { $set: { cancelRequested: true, update_ts: now } }
        )
    }

    // 4. GridFS — content buckets by owner metadata, avatar by filename.
    let gridFsDeleted = 0
    for (const bucketName of [
        'userDxf',
        'validDxf',
        'userDxfFilesSvg',
        'stripUserDxf',
        'nestDxf',
        'nestSvg',
        'stripNestDxf',
    ]) {
        const bucket = await getBucket(bucketName)
        const files = await bucket.find({ 'metadata.ownerId': userId }).toArray()
        await Promise.all(files.map((f) => bucket.delete(f._id)))
        gridFsDeleted += files.length
    }
    const avatarBucket = await getAvatarBucket()
    const avatars = await avatarBucket.find({ filename: `avatar-${userId}.jpg` }).toArray()
    await Promise.all(avatars.map((f) => avatarBucket.delete(f._id)))
    summary.gridFsFilesDeleted = gridFsDeleted + avatars.length

    // 5. Mongo collections — owner-scoped, then userId-scoped.
    for (const name of [
        'user_dxf_files',
        'strip_user_dxf_files',
        'projects',
        'strip_projects',
        'nesting_jobs',
        'strip_nesting_job_queue',
    ]) {
        await db.collection(name).deleteMany({ ownerId: userId })
    }
    for (const name of [
        'passwordResets',
        'emailVerifications',
        'subscription_checkouts',
        'supportMessages',
        'tracking',
    ]) {
        await db.collection(name).deleteMany({ userId })
    }
    // payment_failures : un échec reçu avant la résolution du compte porte
    // userId null mais l'e-mail (et le client Stripe) — on balaie les trois.
    await db.collection('payment_failures').deleteMany({
        $or: [
            { userId },
            ...(user.email ? [{ email: user.email }] : []),
            ...(user.stripeCustomerId ? [{ stripeCustomerId: user.stripeCustomerId }] : []),
        ],
    })
    // accounting_entries n'est PAS effacée : écritures comptables légales
    // (conservation 10 ans, Code de commerce L123-22). Elles ne portent que
    // l'id de facture Stripe et les montants, aucune référence à l'utilisateur.
    // `http` n'est plus balayé ici : depuis S-1 le journal HTTP ne porte plus
    // aucun identifiant (ni userId, ni URL) et s'efface seul à 14 jours.
    await clearVaultSessions(userId)

    // 6. Admin audit trail — keep the actions, drop the personal reference
    //    and the free-text fields (summary/raw can carry names, reasons).
    await db.collection('adminActions').updateMany(
        { targetUserId: userId },
        { $set: { targetUserId: null, targetUserDeleted: true, summary: null, raw: null } }
    )

    // 7. The user document itself, last.
    await db.collection('users').deleteOne({ id: userId })

    // 8. Confirmation email — best-effort, after everything (address already
    //    captured, so the deleted document is not needed).
    if (user.email) {
        try {
            await sendAccountDeletedEmail(user.email)
        } catch (err) {
            logger.warn(`Account deletion: confirmation email failed for ${ref}:`, err?.message || err)
        }
    }

    logger.info(`Account deleted: ${ref}`)
    return summary
}
