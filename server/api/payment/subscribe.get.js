import { connectDB } from '~~/server/db/mongo'
import { generateRandomString } from '~~/server/utils/strings'
import { getCurrencyByCountry } from '~~/server/utils/currency'
import { createCustomer, createSubscriptionCheckout, listCustomerSubscriptions } from '~~/server/features/payment/stripe'
import logger from '~~/server/utils/logger'
import { TRIAL_DAYS } from '~~/server/features/payment/const'
import { LIVE_SUBSCRIPTION_STATUSES, hasLiveSubscription, isTrialEligible } from '~~/server/features/payment/eligibility'

export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    // useRuntimeConfig must be called with the event inside the handler —
    // at module top level there is no Nuxt context and baseUrl resolves to
    // undefined, which broke checkout with a malformed success_url.
    const baseUrl = useRuntimeConfig(event).public.baseUrl

    const db = await connectDB()

    const user = await db.collection('users').findOne({ id: userId })
    if (!user) {
        throw createError({ statusCode: 401, statusMessage: 'User not found' })
    }

    // Un abonné vivant (trialing/active/past_due/incomplete/unpaid) ne passe JAMAIS par
    // un nouveau Checkout : ça empilerait un second abonnement (double
    // facturation). Mise à niveau = subscription/change.post.js, moyen de
    // paiement = portail. Code stable, traduit côté client.
    if (hasLiveSubscription(user)) {
        throw createError({ statusCode: 409, statusMessage: 'subscription_exists' })
    }

    // Fenêtre résiduelle : juste après un paiement dans un autre onglet, le
    // webhook n'a pas encore posé stripeSubscriptionId en base. On interroge
    // donc Stripe (source de vérité) quand un customer existe. Échec Stripe =
    // FAIL OPEN avec log : pas de précédent fail-closed dans le module, et un
    // incident Stripe ne doit pas bloquer tout achat — Checkout dépend de
    // Stripe de toute façon, le risque résiduel est le seul double clic
    // inter-onglets pendant l'incident.
    if (user.stripeCustomerId) {
        try {
            const subs = await listCustomerSubscriptions(user.stripeCustomerId)
            if (subs.some((sub) => LIVE_SUBSCRIPTION_STATUSES.includes(sub?.status))) {
                throw createError({ statusCode: 409, statusMessage: 'subscription_exists' })
            }
        } catch (err) {
            if (err?.statusCode === 409) throw err
            logger.warn('Stripe subscription lookup failed, continuing to Checkout', {
                userId,
                customerId: user.stripeCustomerId,
                err: err?.data?.error?.message || err?.message || err,
            })
        }
    }

    // ?tier=privacy subscribes to the "Confidentialité+" plan (zero-knowledge
    // vault); anything else falls back to the standard unlimited plan.
    const tier = getQuery(event)?.tier === 'privacy' ? 'privacy' : 'standard'
    const planDocId = tier === 'privacy' ? 'subscription:privacy' : 'subscription'
    const plan = await db.collection('subscription_plan').findOne({ id: planDocId })
    if (!plan?.priceId) {
        throw createError({ statusCode: 503, statusMessage: 'Subscription plan not available' })
    }

    // Ensure a Stripe customer exists so the subscription is attached to it.
    let customerId = user.stripeCustomerId
    if (!customerId) {
        customerId = await createCustomer({ email: user.email, userId: user.id })
        await db
            .collection('users')
            .updateOne({ id: user.id }, { $set: { stripeCustomerId: customerId } })
    }

    const country = getHeader(event, 'cf-ipcountry')
    const detected = getCurrencyByCountry(country)
    // Only pin a currency when the plan's price actually offers it. Passing a
    // currency the price doesn't support makes Stripe reject the checkout
    // ("The price specified only supports eur..."). When null, no currency is
    // sent and Stripe uses the price's own currency.
    const currency = plan.prices?.[detected] != null ? detected : null

    const internalId = generateRandomString(24)
    const redirectUrl = `${baseUrl}/home`

    const { id: sessionId, url } = await createSubscriptionCheckout({
        customerId,
        priceId: plan.priceId,
        currency,
        // Essai une seule fois par utilisateur (jamais d'abonnement antérieur).
        trialDays: isTrialEligible(user) ? TRIAL_DAYS : 0,
        userId: user.id,
        internalId,
        successUrl: `${redirectUrl}?subscriptionInternalId=${internalId}`,
        cancelUrl: redirectUrl,
    })

    await db.collection('subscription_checkouts').insertOne({
        internalId,
        userId: user.id,
        checkoutId: sessionId,
        status: 'created',
        attempt: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
    })

    return { url }
})
