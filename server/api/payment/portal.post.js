import { connectDB } from '~~/server/db/mongo'
import logger from '~~/server/utils/logger'
import { logRef } from '~~/server/utils/logRef'
import { createBillingPortalSession } from '~~/server/features/payment/stripe'

/**
 * Ouvre le portail de facturation Stripe (changer de carte, factures,
 * résiliation) pour l'utilisateur connecté et renvoie l'URL de la session.
 *
 * Le portail doit avoir été configuré ET enregistré dans le dashboard Stripe
 * (Paramètres › Facturation › Portail client), en mode test ET live : sinon
 * Stripe répond 400. On le journalise côté serveur et on renvoie un code
 * stable `portal_unavailable` (502) que le client traduit.
 */
export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    const db = await connectDB()
    const user = await db.collection('users').findOne(
        { id: userId },
        { projection: { stripeCustomerId: 1 } }
    )
    if (!user?.stripeCustomerId) {
        throw createError({ statusCode: 400, statusMessage: 'no_billing_customer' })
    }

    // Avec l'event : au top level / sans event, baseUrl vaut undefined.
    const baseUrl = useRuntimeConfig(event).public.baseUrl

    try {
        const { url } = await createBillingPortalSession({
            customerId: user.stripeCustomerId,
            returnUrl: `${baseUrl}/profile`,
        })
        return { url }
    } catch (err) {
        logger.warn('Stripe billing portal session failed', {
            userRef: logRef(userId),
            customerId: user.stripeCustomerId,
            err: err?.data?.error?.message || err?.message || err,
        })
        throw createError({ statusCode: 502, statusMessage: 'portal_unavailable' })
    }
})
