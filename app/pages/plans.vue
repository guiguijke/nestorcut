<template>
    <div class="plans">
        <section class="plans__hero">
            <h1 class="plans__title title title--large">{{ t('plans.title') }}</h1>
            <p class="plans__subtitle">
                {{ t('plans.subtitle') }}
            </p>
        </section>

        <section class="plans__cards cards">
            <div
                v-for="tier in tiers"
                :key="tier.name"
                :class="{ 'cards__card--highlighted': tier.highlighted }"
                class="cards__card"
            >
                <span class="cards__badge" :class="`cards__badge--${tier.badgeKind}`">
                    {{ tier.badge }}
                </span>
                <h2 class="cards__name">{{ tier.name }}</h2>
                <div class="cards__price">
                    {{ tier.price }}
                    <span class="cards__interval">/ {{ tier.intervalLabel }}</span>
                </div>
                <p class="cards__description">{{ tier.description }}</p>
                <ul class="cards__features">
                    <li v-for="feature in tier.features" :key="feature" class="cards__feature">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="cards__check"><path d="M20 6 9 17l-5-5"/></svg>
                        {{ feature }}
                    </li>
                </ul>
                <div v-if="queueTimesReady" class="cards__measured">
                    <template v-if="measuredByTier[tier.tierKey]">
                        <p class="cards__measured-line">{{ measuredByTier[tier.tierKey].wait }}</p>
                        <p class="cards__measured-line">{{ measuredByTier[tier.tierKey].wall }}</p>
                    </template>
                    <p v-else class="cards__measured-line cards__measured-line--collecting">
                        {{ t('plans.measured.collecting') }}
                    </p>
                </div>
                <MainButton
                    :theme="tier.highlighted ? themeType.primary : themeType.secondary"
                    :label="ctaFor(tier).label"
                    :aria-label="offerButtonName(ctaFor(tier).label, tier.name)"
                    :isDisable="ctaFor(tier).disabled"
                    @click="onTierClick(tier)"
                    class="cards__cta"
                />
            </div>
        </section>

        <section class="plans__compare compare">
            <h2 class="compare__title title title--medium">{{ t('plans.compare') }}</h2>
            <div class="compare__table-wrapper">
                <table class="compare__table">
                    <thead>
                        <tr>
                            <th></th>
                            <th>{{ t('plans.tier.free') }}</th>
                            <th class="compare__th--highlighted">{{ t('plans.tier.unlimited') }}</th>
                            <th>{{ t('plans.tier.pro') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in comparisonRows" :key="row.label">
                            <td class="compare__label">{{ row.label }}</td>
                            <td v-for="(value, i) in row.values" :key="i"
                                :class="{ 'compare__td--highlighted': i === 1 }"
                                class="compare__value">
                                <svg v-if="value === true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="compare__icon compare__icon--yes"><path d="M20 6 9 17l-5-5"/></svg>
                                <span v-else-if="value === false" class="compare__icon compare__icon--no">—</span>
                                <template v-else>{{ value }}</template>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <LoginView />
    </div>
</template>

<script setup>

// 3.1.6 (P3) : page publique qui reconnaît la session — un connecté voit son
// offre, l'essai (fenêtre d'abonnement) ou le profil, un anonyme « Commencer ».
definePageMeta({
    middleware: 'auth-optional',
})
import { themeType } from '~~/constants/theme.constants'
import {
    FREE_NESTING_LIMIT,
    FREE_DOWNLOAD_SHEET_CAP,
    TRIAL_DAYS,
    SUBSCRIPTION_PRICE_LABEL,
    PRO_PRICE_LABEL,
} from '~~/shared/constants/payment.constants'
import { flagOn } from '~/utils/runtimeFlag'
import { UNLIMITED_FEATURE_KEYS, PRO_FEATURE_KEYS, signedInPlanCta, offerButtonName, formatPlanMoney } from '~/utils/planBenefits'

onMounted(() => {
    trackEvent('page_view', { page: 'plans' })
})

const loginDialog = useLoginDialog()
// Fenêtre d'abonnement (avantages + conditions) : montée par la mise en page,
// ouverte ici avec sa source de suivi.
const openBuyCredits = useBuyCreditsOpener()
const { getters: authGetters } = authStore
const { t, locale } = useLocale()
const userIsSet = computed(() => Boolean(unref(authGetters.userIsSet)))

// Temporarily disable paid-plan CTAs (Unlimited trial + Pro upgrade) until
// Toggle via NUXT_PUBLIC_PAID_PLANS_DISABLED. D19 : lecture string-safe
// (AGENTS #29 — l'override runtime arrive en chaîne).
const paidDisabled = computed(() => flagOn(useRuntimeConfig().public.paidPlansDisabled))

// Shared with the landing via the 'payment-plans' cache key (deduplicated +
// cached for a few minutes). See composables/usePlans.js.
const { data: plans } = usePlans()

// Measured queue/compute stats per tier (public endpoint, 60 s server-side
// cache). Client-only: SSR would render the "collecting" fallback anyway.
const { data: queueTimes, status: queueTimesStatus } = useFetch('/api/metrics/queue-times', {
    server: false,
})
// Ready = a response arrived. `!== 'pending'` was true on the server
// ('idle', server: false) but false at hydration (the client fetch is
// already pending): hydration mismatch on the measured block.
const queueTimesReady = computed(() => ['success', 'error'].includes(unref(queueTimesStatus)))

// Below this sample size a percentile is noise — show the honest fallback.
const MIN_MEASURED_JOBS = 5

// Compact duration: < 90 s → "12 s", < 90 min → "3 min", else "1 h 05 min".
function formatQueueDuration(seconds) {
    const totalSec = Math.round(seconds)
    if (totalSec < 90) return `${totalSec} s`
    const totalMin = Math.round(totalSec / 60)
    if (totalMin < 90) return `${totalMin} min`
    const hours = Math.floor(totalMin / 60)
    const mins = totalMin % 60
    return mins ? `${hours} h ${String(mins).padStart(2, '0')} min` : `${hours} h`
}

// Card key → compute tier key (marketing names differ from code tiers).
const measuredByTier = computed(() => {
    const tiersData = unref(queueTimes)?.tiers
    const out = {}
    for (const key of ['free', 'standard', 'privacy']) {
        const stats = tiersData?.[key]
        out[key] =
            stats && stats.jobs >= MIN_MEASURED_JOBS
                ? {
                      wait: t('plans.measured.wait', {
                          p50: formatQueueDuration(stats.waitP50Sec),
                          p95: formatQueueDuration(stats.waitP95Sec),
                      }),
                      wall: t('plans.measured.wall', {
                          p50: formatQueueDuration(stats.wallP50Sec),
                          p95: formatQueueDuration(stats.wallP95Sec),
                          n: stats.jobs,
                      }),
                  }
                : null
    }
    return out
})

// Connecté : l'essai n'est offert qu'une fois (serveur : trialEligible). Lu
// côté client seulement ; tant qu'on ne le sait pas, aucune carte ne promet
// d'essai (signedInPlanCta).
const { data: subscriptionInfo, execute: loadSubscriptionInfo } = useFetch('/api/payment/subscription', {
    key: 'plans-subscription-info',
    server: false,
    immediate: false,
})
// Le rendu serveur ne connaît pas l'éligibilité à l'essai : le premier rendu
// client doit être identique (sinon erreur d'hydratation), les libellés qui
// en dépendent ne se mettent à jour qu'après le montage.
const mountedOnClient = ref(false)
onMounted(() => {
    mountedOnClient.value = true
    if (userIsSet.value) loadSubscriptionInfo()
})
watch(userIsSet, (isSet) => {
    if (isSet && import.meta.client) loadSubscriptionInfo()
})

// Durée d'essai annoncée par le serveur pour l'offre de la carte (repli : la
// constante partagée tant que le catalogue n'est pas lu).
function trialDaysOf(tierKey) {
    const days = Number(unref(plans)?.[tierKey]?.trialDays)
    return Number.isFinite(days) && days > 0 ? days : TRIAL_DAYS
}

// Libellé et état du bouton d'une carte : anonyme = libellé de la carte ;
// connecté = « Votre offre » / essai / profil selon le palier (signedInPlanCta).
function ctaFor(tier) {
    if (!userIsSet.value) {
        return { label: tier.cta, disabled: Boolean(tier.comingSoon) }
    }
    const info = unref(mountedOnClient) ? unref(subscriptionInfo) : undefined
    const cta = signedInPlanCta({
        tierKey: tier.tierKey,
        level: unref(authGetters.user)?.compute?.level,
        trialEligible: typeof info?.trialEligible === 'boolean' ? info.trialEligible : undefined,
        comingSoon: tier.comingSoon,
        subscriptionStatus: info?.subscriptionStatus,
        cancelAtPeriodEnd: info?.cancelAtPeriodEnd,
    })
    return { label: t(cta.labelKey, { days: trialDaysOf(tier.tierKey) }), disabled: cta.disabled, action: cta.action }
}

// Même écriture que la fenêtre d'abonnement : langue de l'app, devise du plan.
const formatPlanPrice = (plan) => {
    if (!plan?.available) return null
    return formatPlanMoney(plan.amount, plan.currency || 'eur', locale.value)
}
// Plan illisible : le libellé de repli, en euros, au même format.
const fallbackPrice = (label) => formatPlanMoney(Number(label.replace(/\D/g, '')), 'eur', locale.value)

const tiers = computed(() => {
    const stdPlan = unref(plans)?.standard
    const stdAvailable = Boolean(stdPlan?.available)
    const proPlan = unref(plans)?.privacy
    const proAvailable = Boolean(proPlan?.available)
    return [
        {
            name: t('plans.tier.free'),
            tierKey: 'free',
            price: formatPlanMoney(0, stdPlan?.currency || 'eur', locale.value),
            intervalLabel: t('plans.interval.forever'),
            badge: t('plans.badge.discovery'),
            badgeKind: 'neutral',
            description: t('plans.free.desc'),
            features: [
                t('plans.free.f1', { n: FREE_NESTING_LIMIT }),
                t('plans.free.f2'),
                // O1/O2 : calcul sans plafond, téléchargement des 2 premières tôles.
                t('plans.free.allSheets'),
                t('plans.free.f3', { n: FREE_DOWNLOAD_SHEET_CAP }),
                t('plans.free.f4'),
            ],
            cta: t('plans.cta.startFree'),
            trackingTag: 'plans_free',
        },
        {
            name: t('plans.tier.unlimited'),
            tierKey: 'standard',
            // Live Stripe price when the sync worked, static label as fallback.
            price: stdAvailable ? formatPlanPrice(stdPlan) : fallbackPrice(SUBSCRIPTION_PRICE_LABEL),
            intervalLabel: t('plans.interval.month'),
            badge: t('plans.badge.popular'),
            badgeKind: 'accent',
            highlighted: true,
            description: t('plans.unlimited.desc'),
            features: [
                ...UNLIMITED_FEATURE_KEYS.map((key) => t(key)),
            ],
            // When paid plans are disabled, the card stays visible (price +
            // features) but the CTA shows "Coming soon" and does nothing.
            // Same when the Stripe sync failed (plan unavailable) — never
            // offer a checkout that can only 503.
            cta: stdAvailable && !paidDisabled.value ? t('plans.cta.startTrial', { days: trialDaysOf('standard') }) : t('plans.cta.comingSoon'),
            comingSoon: !stdAvailable || paidDisabled.value,
            trackingTag: 'plans_unlimited',
        },
        {
            name: t('plans.tier.pro'),
            tierKey: 'privacy',
            price: proAvailable ? formatPlanPrice(proPlan) : fallbackPrice(PRO_PRICE_LABEL),
            intervalLabel: t('plans.interval.month'),
            badge: t('plans.badge.compute'),
            badgeKind: 'pro',
            description: t('plans.pro.desc'),
            features: [
                ...PRO_FEATURE_KEYS.map((key) => t(key)),
            ],
            cta: proAvailable && !paidDisabled.value ? t('plans.cta.getPro') : t('plans.cta.comingSoon'),
            comingSoon: !proAvailable || paidDisabled.value,
            trackingTag: 'plans_pro',
        },
    ]
})

const comparisonRows = computed(() => [
    { label: t('plans.compare.nestingsIncluded'), values: [t('plans.value.perMonth', { n: FREE_NESTING_LIMIT }), t('plans.value.unlimited'), t('plans.value.unlimited')] },
    { label: t('plans.compare.altLayouts'), values: ['1', '3', '3'] },
    { label: t('plans.compare.vcores'), values: ['1', '4', '8'] },
    { label: t('plans.compare.priority'), values: [false, t('plans.value.standard'), t('plans.value.priority')] },
    { label: t('plans.compare.multiSheet'), values: [true, true, true] },
    // O2 : le calcul multi-tôles est ouvert à tous ; c'est le téléchargement
    // qui distingue les offres.
    {
        label: t('plans.compare.sheetDownloads'),
        values: [
            t('plans.value.firstSheets', { n: FREE_DOWNLOAD_SHEET_CAP }),
            t('plans.value.allSheets'),
            t('plans.value.allSheets'),
        ],
    },
    { label: t('plans.compare.heterogeneous'), values: [true, true, true] },
    { label: t('plans.compare.export'), values: [true, true, true] },
    // Email de fin de nesting : chaîne inatteignable (AGENTS #38) — pas de claim.
    { label: t('plans.compare.zeroKnowledge'), values: [true, true, true] },
    { label: t('plans.compare.trial'), values: [false, true, true] },
])

function onTierClick(tier) {
    if (tier.comingSoon && !userIsSet.value) return
    trackEvent(`click_${tier.trackingTag}`, { page: 'plans' })
    if (userIsSet.value) {
        const cta = ctaFor(tier)
        if (cta.disabled) return
        if (cta.action === 'dialog') openBuyCredits({ source: 'plans', offer: tier.tierKey })
        else navigateTo('/profile')
        return
    }
    loginDialog.value = true
}
</script>

<style lang="scss" scoped>
.plans {
    line-height: 1.4;
    color: var(--label-secondary);

    &__hero {
        text-align: center;
        padding: 24px 16px 8px;
    }
    &__title {
        color: var(--accent-primary);
    }
    &__subtitle {
        margin-top: 12px;
    }
}

.title {
    color: var(--accent-primary);
    font-weight: 700;

    &--large {
        font-size: var(--fs-32);

        @media (min-width: 567px) {
            font-size: var(--fs-32);
        }
    }
    &--medium {
        font-size: var(--fs-22);

        @media (min-width: 567px) {
            font-size: var(--fs-32);
        }
    }
}

// ---------- Cards ----------
.cards {
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(1, 1fr);
    padding: 32px 8px;
    max-width: 1100px;
    margin: 0 auto;

    @media (min-width: 1199px) {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 32px;
        padding: 48px 16px;
    }

    &__card {
        position: relative;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--separator-secondary);
        padding: 32px 24px;
        border-radius: var(--radius-l);
        background-color: var(--background-primary);

        &--highlighted {
            border-color: var(--accent-primary);
            background-color: var(--fill-tertiary);
        }
    }

    &__badge {
        position: absolute;
        top: -12px;
        left: 50%;
        transform: translateX(-50%);
        padding: 4px 14px;
        border-radius: var(--radius-s);
        font-size: var(--fs-12);
        font-weight: 700;
        white-space: nowrap;
        letter-spacing: 0.03em;

        &--neutral {
            background-color: var(--fill-secondary);
            color: var(--label-secondary);
            border: 1px solid var(--separator-primary);
        }
        &--accent {
            background-color: var(--accent-primary);
            color: var(--background-primary);
        }
        &--pro {
            background-color: var(--background-secondary);
            color: var(--background-primary);
            border: 1px solid var(--accent-primary);
        }
    }

    &__name {
        color: var(--accent-primary);
        font-weight: 700;
        font-size: var(--fs-18);
        text-align: center;
    }

    &__price {
        margin-top: 12px;
        color: var(--accent-primary);
        font-weight: 900;
        font-size: var(--fs-32);
        text-align: center;
    }

    &__interval {
        font-size: var(--fs-14);
        font-weight: 400;
        color: var(--label-tertiary);
    }

    &__description {
        margin-top: 8px;
        font-size: var(--fs-14);
        text-align: center;
    }

    &__features {
        margin-top: 24px;
        margin-bottom: 32px;
        flex-grow: 1;
    }

    // Measured queue/compute stats (public /api/metrics/queue-times) — kept
    // discreet: description-like styling, one size down.
    &__measured {
        margin-top: -16px;
        margin-bottom: 24px;
        font-size: var(--fs-12);
        text-align: center;
        color: var(--label-tertiary);
    }

    &__measured-line {
        padding: 1px 0;

        &--collecting {
            font-style: italic;
        }
    }

    &__feature {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        font-size: var(--fs-14);
        padding: 6px 0;
    }

    &__check {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
        margin-top: 2px;
        color: var(--accent-primary);
    }

    &__cta {
        width: 100%;
    }
}

// ---------- Comparison table ----------
.compare {
    padding: 32px 8px 64px;
    max-width: 900px;
    margin: 0 auto;

    &__title {
        text-align: center;
        margin-bottom: 32px;
    }

    &__table-wrapper {
        overflow-x: auto;
        border: 1px solid var(--separator-secondary);
        border-radius: var(--radius-l);
    }

    &__table {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--fs-14);
        min-width: 560px;

        th, td {
            padding: 14px 18px;
            text-align: center;
        }

        thead th {
            color: var(--accent-primary);
            font-weight: 700;
            font-size: var(--fs-14);
            border-bottom: 1px solid var(--separator-primary);
        }

        tbody tr:not(:last-child) td {
            border-bottom: 1px solid var(--separator-secondary);
        }

        // Téléphone : les trois offres tiennent dans le cadre, sans défilement
        // caché. Libellés et valeurs passent à la ligne, colonnes resserrées.
        @media (max-width: 640px) {
            min-width: 0;
            font-size: var(--fs-13);

            th, td {
                padding: 10px 6px;
            }
        }
    }

    &__label {
        text-align: left !important;
        color: var(--label-primary);
        font-weight: 600;

        // Téléphone : un long mot (allemand) se coupe plutôt que d'élargir la table.
        @media (max-width: 640px) {
            hyphens: auto;
            overflow-wrap: anywhere;
        }
    }

    &__value {
        color: var(--label-secondary);
    }

    &__th--highlighted,
    &__td--highlighted {
        background-color: var(--fill-tertiary);
    }

    &__icon {
        display: inline-block;
        width: 18px;
        height: 18px;

        &--yes {
            color: var(--accent-primary);
        }
        &--no {
            color: var(--label-tertiary);
        }
    }
}
</style>
