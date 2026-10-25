import { connectDB } from "../db/mongo";
import {
    getCheckoutSession,
    getSubscription,
    mapSubscription,
} from "../features/payment/stripe";
import logger from "../utils/logger";
import { logRef } from "../utils/logRef";

const tag = "subscriptionsync";

// How often the loop wakes up when there is nothing immediate to do.
const IDLE_DELAY_MS = 30 * 1000;
// How stale a stored subscription may get before we refresh it from Stripe.
const REFRESH_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Resolves a freshly created checkout into a stored subscription. Mirrors the
 * post-redirect /subscription/check endpoint for users who close the tab before
 * being redirected back.
 */
async function resolvePendingCheckouts(db) {
    const checkout = await db.collection("subscription_checkouts").findOneAndUpdate(
        {
            status: "created",
            createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) },
            attempt: { $lt: 5 },
        },
        { $set: { status: "processing", updatedAt: new Date() }, $inc: { attempt: 1 } },
        { returnDocument: "after" }
    );

    if (!checkout) {
        return false;
    }

    try {
        const session = await getCheckoutSession(checkout.checkoutId);
        const subscription = session?.subscription;

        if (subscription && typeof subscription === "object") {
            const mapped = mapSubscription(subscription);
            await db
                .collection("users")
                .updateOne({ id: checkout.userId }, { $set: { subscription: mapped } });
            await db
                .collection("subscription_checkouts")
                .updateOne(
                    { _id: checkout._id },
                    { $set: { status: "completed", updatedAt: new Date() } }
                );
            logger.info(`[${tag}] Resolved checkout`, {
                userRef: logRef(checkout.userId),
                status: mapped.status,
            });
        } else if (session?.status === "expired") {
            // Stripe gave up on this session (24h abandoned checkout) —
            // record it so the admin funnel separates it from pending ones.
            await db
                .collection("subscription_checkouts")
                .updateOne(
                    { _id: checkout._id },
                    { $set: { status: "expired", updatedAt: new Date() } }
                );
        } else {
            // Not paid/created yet — return to the queue for another attempt.
            await db
                .collection("subscription_checkouts")
                .updateOne(
                    { _id: checkout._id },
                    { $set: { status: "created", updatedAt: new Date() } }
                );
        }
    } catch (err) {
        logger.warn(`[${tag}] Failed to resolve checkout`, {
            checkoutId: checkout.checkoutId,
            err,
        });
        await db
            .collection("subscription_checkouts")
            .updateOne(
                { _id: checkout._id },
                { $set: { status: "created", updatedAt: new Date() } }
            );
    }

    return true;
}

/**
 * Refreshes the stalest stored subscription from Stripe so renewals,
 * cancellations and failed payments are reflected without webhooks.
 */
async function refreshStaleSubscription(db) {
    const user = await db.collection("users").findOne(
        {
            "subscription.stripeSubscriptionId": { $exists: true },
            "subscription.updatedAt": { $lt: new Date(Date.now() - REFRESH_AFTER_MS) },
        },
        { projection: { id: 1, subscription: 1 }, sort: { "subscription.updatedAt": 1 } }
    );

    if (!user) {
        return false;
    }

    try {
        const stripeSub = await getSubscription(user.subscription.stripeSubscriptionId);
        const mapped = mapSubscription(stripeSub);
        await db
            .collection("users")
            .updateOne({ id: user.id }, { $set: { subscription: mapped } });
        logger.info(`[${tag}] Refreshed subscription`, {
            userRef: logRef(user.id),
            status: mapped.status,
        });
    } catch (err) {
        logger.warn(`[${tag}] Failed to refresh subscription`, {
            userRef: logRef(user.id),
            err,
        });
        // Bump updatedAt so a permanently failing id doesn't spin the loop.
        await db
            .collection("users")
            .updateOne(
                { id: user.id },
                { $set: { "subscription.updatedAt": new Date() } }
            );
    }

    return true;
}

// Un checkout 'processing' depuis plus longtemps que ça est orphelin (le
// updateOne du catch a échoué, ou le process a été interrompu en cours de vie) :
// on le remet dans la file.
const PROCESSING_STALE_MS = 5 * 60 * 1000;

/**
 * Une itération de la boucle : jamais de rejet (une erreur Mongo/Stripe tuait
 * silencieusement la boucle jusqu'au redémarrage). Retourne true si du travail
 * a été fait (on enchaîne sans attendre), false sinon (attente IDLE_DELAY_MS —
 * y compris après une erreur, pour ne pas tourner en boucle serrée).
 */
export async function runSyncIteration(db) {
    try {
        await db
            .collection("subscription_checkouts")
            .updateMany(
                {
                    status: "processing",
                    updatedAt: { $lt: new Date(Date.now() - PROCESSING_STALE_MS) },
                },
                { $set: { status: "created", updatedAt: new Date() } }
            );
        const didCheckout = await resolvePendingCheckouts(db);
        const didRefresh = await refreshStaleSubscription(db);
        return didCheckout || didRefresh;
    } catch (err) {
        logger.error(`[${tag}] Sync iteration failed`, { err });
        return false;
    }
}

export default defineNitroPlugin(async () => {
    logger.info(`[${tag}] Subscription sync plugin start`);
    const db = await connectDB();

    // Clear any checkouts left mid-flight by a previous process.
    await db
        .collection("subscription_checkouts")
        .updateMany({ status: "processing" }, { $set: { status: "created" } });

    while (true) {
        const didWork = await runSyncIteration(db);

        if (!didWork) {
            await new Promise((resolve) => setTimeout(resolve, IDLE_DELAY_MS));
        }
    }
});
