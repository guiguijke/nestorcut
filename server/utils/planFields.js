import { getComputeProfile, getDemoEntitlement, getEntitlement } from '~~/server/utils/entitlement'
import { isPromoActive } from '~~/server/utils/promo'
import { isTrialEligible } from '~~/server/features/payment/eligibility'

// Champs de PALIER de /api/user, et rien d'autre. Partagé avec /api/user/plan :
// ce module ne doit JAMAIS importer server/utils/vault (relire le palier ne
// doit pas prolonger la session du coffre).
export async function buildPlanFields(userId, user, localComputeEnabled) {
    const entitlement = await getEntitlement(userId)
    const demo = await getDemoEntitlement(userId, localComputeEnabled)
    const compute = await getComputeProfile(userId, null)
    return {
        // Partner promo code redeemed on this account (raised free quota).
        promo: user.promo
            ? {
                  code: user.promo.code,
                  freeNestingLimit: user.promo.freeNestingLimit,
                  expiresAt: user.promo.expiresAt ?? null,
                  active: isPromoActive(user.promo),
              }
            : null,
        freeRemaining: entitlement.freeRemaining,
        demoRemaining: demo.demoRemaining,
        demoUnlimited: Boolean(demo.demoUnlimited),
        subscriptionStatus: entitlement.subscriptionStatus,
        trialEligible: isTrialEligible(user),
        granted: Boolean(entitlement.granted),
        requiresPaywall: entitlement.requiresPaywall,
        compute: {
            level: compute.level,
            vcores: compute.vcores,
            maxDirections: compute.maxDirections,
        },
    }
}
