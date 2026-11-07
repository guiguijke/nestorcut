<template>
    <div class="subscription">
        <MainTitle :label="t('profile.subscription')" class="subscription__title" />

        <div v-if="isStripeActive" class="subscription__card">
            <div class="subscription__status">
                <UiBadge tone="ok" dot>{{ statusLabel }}</UiBadge>
            </div>
            <p v-if="data?.cancelAtPeriodEnd" class="subscription__cancel-notice">
                {{ t('sub.cancelNotice', { date: formatDate(data?.currentPeriodEnd) }) }}
            </p>
            <p v-else class="subscription__desc">
                {{ t('sub.activeDesc') }}
            </p>
            <p v-if="showProAfterEnd" class="subscription__desc" data-testid="subscription-pro-after-end">
                {{ t('sub.proAfterEnd') }}
            </p>
            <MainButton
                v-if="!data?.cancelAtPeriodEnd"
                :label="t('sub.cancelBtn')"
                :theme="themeType.secondary"
                :size="sizeType.m"
                :isDisable="isLoading"
                trackingTag="subscription_cancel"
                class="subscription__btn subscription__btn--cancel"
                @click="cancelSubscription"
            />
            <MainButton
                v-if="canManageBilling"
                :label="t('sub.manageBilling')"
                :theme="themeType.secondary"
                :size="sizeType.m"
                :isDisable="isLoading"
                trackingTag="subscription_manage_billing"
                class="subscription__btn subscription__btn--cancel"
                @click="openPortal"
            />
        </div>

        <div v-else-if="isPastDue" class="subscription__card">
            <div class="subscription__status">
                <UiBadge tone="warn" dot>{{ t('sub.pastDue') }}</UiBadge>
            </div>
            <p class="subscription__cancel-notice">{{ t('sub.pastDueDesc') }}</p>
            <p v-if="ctxMessage" class="subscription__context" data-testid="subscription-context">
                {{ t(ctxMessage.key, ctxMessage.params) }}
            </p>
            <MainButton
                v-if="canManageBilling"
                :label="t('sub.updateCard')"
                :theme="themeType.primary"
                :size="sizeType.m"
                :isDisable="isLoading"
                trackingTag="subscription_update_card"
                class="subscription__btn subscription__btn--cancel"
                @click="openPortal"
            />
        </div>

        <div v-else-if="isGranted" class="subscription__card">
            <div class="subscription__status">
                <UiBadge tone="ok" dot>{{ t('sub.grantActive') }}</UiBadge>
            </div>
            <p class="subscription__desc">{{ t('sub.grantDesc') }}</p>
        </div>

        <div v-if="isActive && alreadyPro" class="subscription__card">
            <div class="subscription__status">
                <UiBadge tone="ok" dot>{{ t('sub.proPrivacy') }}</UiBadge>
            </div>
            <p class="subscription__desc">{{ t('sub.proActiveDesc') }}</p>
        </div>

        <div v-else-if="isActive && !isPastDue && !subscriptionEnding && data?.privacyPlan" class="subscription__card">
            <div class="subscription__plan-title">{{ data.privacyPlan.title || t('sub.proPrivacy') }}</div>
            <div class="subscription__price">
                {{ formatPrice(data.privacyPlan.amount, data.privacyPlan.currency) }}
                <span class="subscription__interval">/ {{ intervalLabel(data.privacyPlan.interval) }}</span>
            </div>
            <p class="subscription__desc">{{ t('sub.proDesc') }}</p>
            <p v-if="!isStripeActive && !paidDisabled" class="subscription__terms" data-testid="subscription-terms-pro">
                {{ t(proTerms.key, proTerms.params) }}
            </p>
            <!-- Abonné Stripe : modification en place, sans page Stripe
                 récapitulative — la phrase dit ce que le changement fait. -->
            <p v-else-if="isStripeActive && !paidDisabled" class="subscription__terms" data-testid="subscription-terms-upgrade">
                {{ t(upgradeTermsText.key, upgradeTermsText.params) }}
            </p>
            <MainButton
                v-if="!paidDisabled"
                :label="t('sub.upgradePro')"
                :theme="themeType.primary"
                :size="sizeType.m"
                :isDisable="isLoading"
                class="subscription__btn"
                @click="subscribePro"
            />
            <MainButton
                v-else
                :label="t('sub.comingSoon')"
                :theme="themeType.secondary"
                :size="sizeType.m"
                :isDisable="true"
                class="subscription__btn"
            />
        </div>

        <div v-else-if="!isActive && !isPastDue" class="subscription__card">
            <p v-if="ctxMessage" class="subscription__context" data-testid="subscription-context">
                {{ t(ctxMessage.key, ctxMessage.params) }}
            </p>
            <div v-if="data?.plan" class="subscription__plan">
                <div class="subscription__plan-title">{{ data.plan.title || t('sub.monthlyPlan') }}</div>
                <div class="subscription__price">
                    {{ formatPrice(data.plan.amount, data.plan.currency) }}
                    <span class="subscription__interval">/ {{ intervalLabel(data.plan.interval) }}</span>
                </div>
                <div v-if="!ctxMessage" class="subscription__free">
                    {{ t('sub.freeLeft', { n: data.freeRemaining }) }}
                </div>
                <div v-if="!ctxMessage" class="subscription__reset">
                    {{ t('sub.resetsAt', { date: quotaResetLabel }) }}
                </div>
                <ul class="subscription__features" data-testid="subscription-features">
                    <li v-for="key in UNLIMITED_DIALOG_FEATURE_KEYS" :key="key">{{ t(key) }}</li>
                </ul>
                <p v-if="!paidDisabled" class="subscription__terms" data-testid="subscription-terms">
                    {{ t(unlimitedTerms.key, unlimitedTerms.params) }}
                </p>
                <MainButton
                    v-if="!paidDisabled"
                    :label="trialEligible ? t('sub.startTrial', { days: data.plan.trialDays }) : t('sub.subscribe')"
                    :theme="themeType.primary"
                    :size="sizeType.m"
                    :isDisable="isLoading"
                    trackingTag="subscription_start_trial"
                    class="subscription__btn"
                    @click="subscribe"
                />
                <MainButton
                    v-else
                    :label="t('sub.comingSoon')"
                    :theme="themeType.secondary"
                    :size="sizeType.m"
                    :isDisable="true"
                    class="subscription__btn"
                />
                <p v-if="trialEligible" class="subscription__note">
                    {{ t('sub.cancelTrialNote') }}
                </p>
            </div>
            <div v-if="data?.plan && data?.privacyPlan" class="subscription__plan subscription__plan--pro" data-testid="subscription-pro-offer">
                <div class="subscription__plan-title">{{ data.privacyPlan.title || t('sub.proPrivacy') }}</div>
                <div class="subscription__price">
                    {{ formatPrice(data.privacyPlan.amount, data.privacyPlan.currency) }}
                    <span class="subscription__interval">/ {{ intervalLabel(data.privacyPlan.interval) }}</span>
                </div>
                <ul class="subscription__features">
                    <li v-for="key in PRO_FEATURE_KEYS" :key="key">{{ t(key) }}</li>
                </ul>
                <p v-if="!paidDisabled" class="subscription__terms" data-testid="subscription-terms-pro">
                    {{ t(proTerms.key, proTerms.params) }}
                </p>
                <MainButton
                    v-if="!paidDisabled"
                    :label="trialEligible ? t('sub.startTrial', { days: data.privacyPlan.trialDays }) : t('sub.subscribe')"
                    :theme="themeType.secondary"
                    :size="sizeType.m"
                    :isDisable="isLoading"
                    trackingTag="subscription_start_trial_pro"
                    class="subscription__btn"
                    @click="subscribePro"
                />
                <MainButton
                    v-else
                    :label="t('sub.comingSoon')"
                    :theme="themeType.secondary"
                    :size="sizeType.m"
                    :isDisable="true"
                    class="subscription__btn"
                />
            </div>
            <div v-if="!data?.plan" class="subscription__desc">
                {{ t('sub.unavailable') }}
            </div>
        </div>

        <div v-if="error" class="subscription__error">{{ error }}</div>
    </div>
</template>

<script setup>
import MainButton from './MainButton.vue'
import MainTitle from './MainTitle.vue'
import { themeType } from '~~/constants/theme.constants'
import { sizeType } from '~~/constants/size.constants'
import { formatQuotaReset } from '~/utils/quotaReset'
import { hasPaidAccess } from '~/utils/entitlementUi'
import { flagOn } from '~/utils/runtimeFlag'
import { trackEvent } from '~/utils/track'
import { UNLIMITED_DIALOG_FEATURE_KEYS, PRO_FEATURE_KEYS, checkoutTerms, upgradeTerms, formatPlanMoney, isEndingSubscription } from '~/utils/planBenefits'
import { writeCheckoutIntent } from '~/utils/checkoutReturn'
import { contextMessage, checkoutSourceOf, checkoutReturnPath, checkoutErrorCode } from '~/utils/buyCreditsContext'

// D13 : pourquoi la fenêtre s'ouvre (useBuyCreditsContext, posé par
// BuyCreditsDialog) — null sur la carte du profil et pour les ouvreurs sans
// contexte : pas de phrase de contexte.
const props = defineProps({
    context: { type: Object, default: null },
})

const { t, locale } = useLocale()
const config = useRuntimeConfig()
const route = useRoute()
// Relecture L4 : la date suit la langue de l'app, pas celle du navigateur.
import { intlTag } from '~/utils/i18n'

// Date+heure localisées du reset du quota gratuit (1er du mois suivant,
// 00:00 UTC) — affichées près du compteur de nestings restants.
const quotaResetLabel = computed(() => formatQuotaReset(new Date(), locale.value))

// Temporarily disable paid-plan CTAs (Unlimited trial + Pro upgrade) until
// Toggle via NUXT_PUBLIC_PAID_PLANS_DISABLED. D19 : lecture string-safe
// (AGENTS #29 — l'override runtime arrive en chaîne).
const paidDisabled = computed(() => flagOn(config.public.paidPlansDisabled))

// O3 : phrase « ce résultat compte N tôles… » (cartes Free et past_due).
const ctxMessage = computed(() => contextMessage(props.context))

const { data, refresh } = await useFetch('/api/payment/subscription')

const isLoading = ref(false)
const error = ref('')

const formatDate = (iso) => {
    if (!iso) return ''
    return new Date(iso).toLocaleDateString(intlTag(locale.value), {
        year: 'numeric', month: 'long', day: 'numeric',
    })
}

const { data: userMe } = useNuxtData('user')
const isStripeActive = computed(() => {
    const status = unref(data)?.subscriptionStatus
    return status === 'active' || status === 'trialing'
})
const isGranted = computed(() => {
    if (isStripeActive.value) return false
    if (unref(data)?.granted) return true
    const level = unref(userMe)?.compute?.level
    return level === 'standard' || level === 'privacy'
})
const isActive = computed(() => isStripeActive.value || isGranted.value)
// Pro déjà acquis : prix Pro côté Stripe, ou accès Pro offert par l'admin
// (sans prix Stripe) — jamais une offre de « passer à Pro » à 0 € puis 39 €.
const alreadyPro = computed(
    () => Boolean(unref(data)?.isPrivacyTier) || (isGranted.value && unref(userMe)?.compute?.level === 'privacy'),
)
// Résilié en fin de période : l'abonnement s'arrête à la date annoncée, aucune
// montée n'est offerte. Pro reste possible APRÈS cette date, par un nouveau
// Checkout (le serveur le refuse tant que l'abonnement vit), sans essai.
const subscriptionEnding = computed(() => isEndingSubscription(unref(data)))
const showProAfterEnd = computed(
    () => subscriptionEnding.value && !alreadyPro.value && Boolean(unref(data)?.privacyPlan) && !paidDisabled.value,
)
// past_due / unpaid / incomplete : le paiement a échoué, l'accès est coupé tant
// que la carte n'est pas mise à jour (via le portail Stripe). `unpaid` =
// relances épuisées mais l'abonnement existe encore : jamais la carte
// « s'abonner ». D16 : `incomplete` (premier paiement inabouti) se lit comme
// `past_due` — le serveur refuse déjà un second Checkout (409).
const isPastDue = computed(() => {
    const status = unref(data)?.subscriptionStatus
    return status === 'past_due' || status === 'unpaid' || status === 'incomplete'
})
// L'essai n'est offert qu'une fois (serveur : trialEligible) — sinon le CTA ne
// doit pas promettre d'essai gratuit.
const trialEligible = computed(() => unref(data)?.trialEligible !== false)
const canManageBilling = computed(() => Boolean(unref(data)?.canManageBilling))

const statusLabel = computed(() => {
    const status = unref(data)?.subscriptionStatus
    if (status === 'trialing') return t('sub.trialActive')
    if (status === 'active') return t('sub.active')
    return status || ''
})

const formatPrice = (amount, currency) => formatPlanMoney(amount, currency, locale.value)
// Le serveur rend l'intervalle brut (« month ») : traduit comme sur /plans.
const intervalLabel = (interval) => (interval === 'month' ? t('plans.interval.month') : interval)

// Ce que fait le Checkout, dit AVANT le clic. Prix et devise viennent
// du plan lu côté serveur ; la date = aujourd'hui + durée d'essai connue.
const termsFor = (plan) =>
    checkoutTerms({
        trialEligible: trialEligible.value,
        trialDays: plan?.trialDays,
        amount: plan?.amount,
        currency: plan?.currency,
        now: new Date(),
        locale: locale.value,
    })
const unlimitedTerms = computed(() => termsFor(unref(data)?.plan))
const proTerms = computed(() => termsFor(unref(data)?.privacyPlan))
// Montée en Pro d'un abonné Stripe (en place, sans Checkout).
const upgradeTermsText = computed(() =>
    upgradeTerms({
        status: unref(data)?.subscriptionStatus,
        amount: unref(data)?.privacyPlan?.amount,
        currency: unref(data)?.privacyPlan?.currency,
        locale: locale.value,
    }),
)

// O3 « sans recharger » : le palier de l'interface (useNuxtData('user')) se
// rafraîchit dès que l'abonnement est actif côté Stripe alors que l'interface
// croit encore à un compte Free (paiement fait dans un autre onglet, webhook
// en retard) — une fois par passage à vrai. Côté client seulement.
// Deux sources du palier côté client, à rafraîchir ensemble (comme
// useCheckoutReturn) : le cache `user` (cadenas) ET le store d'authentification
// (bannière Free, bouton Turbo), un instantané que seul setUser() remet à jour.
const refreshUser = async () => {
    try {
        await refreshNuxtData('user')
    } catch {
        // Le palier se mettra à jour au prochain chargement.
    }
    try {
        await authStore.actions.setUser()
    } catch {
        // Bannière : se mettra à jour au prochain setUser().
    }
}
if (import.meta.client) {
    watch(
        isStripeActive,
        (active) => {
            if (active && !hasPaidAccess(unref(userMe))) refreshUser()
        },
        { immediate: true },
    )
}

// Les statusMessage serveur sont des codes stables : traduits ici, repli
// générique sinon.
const SERVER_ERROR_CODES = ['subscription_exists', 'portal_unavailable', 'email_not_verified']
const errorMessage = (err, fallbackKey) => {
    const code = err?.data?.statusMessage
    return SERVER_ERROR_CODES.includes(code) ? t(`sub.error.${code}`) : t(fallbackKey)
}

// Abonnement déjà vivant (autre onglet / webhook en retard) : on recharge la
// carte ET le palier de l'interface plutôt que de laisser un CTA d'achat et
// des cadenas périmés.
const syncAfterExistingSubscription = async () => {
    await refresh()
    await refreshUser()
}

// Chemin Checkout commun à l'essai Unlimited et à Pro sans abonnement Stripe.
// D14/D15 : le retour se fait sur le PROJET du résultat quand le contexte le
// porte ; l'intention (source + slugs) reste dans le navigateur, jamais dans
// l'URL Stripe.
const startCheckout = async (tier, fallbackKey) => {
    const source = checkoutSourceOf(props.context)
    trackEvent('checkout_start', { source, tier, trial: String(trialEligible.value) })
    const returnTo = checkoutReturnPath(props.context, route.path)
    try {
        const query = tier === 'privacy' ? { tier, returnTo } : { returnTo }
        const response = await $fetch('/api/payment/subscribe', { query })
        try {
            writeCheckoutIntent(window.sessionStorage, {
                source,
                resultSlug: props.context?.lockedSheets?.resultSlug ?? null,
                projectSlug: props.context?.lockedSheets?.projectSlug ?? null,
            })
        } catch {
            // Stockage indisponible : le retour fonctionne, sans réouverture.
        }
        navigateTo(response.url, { external: true })
    } catch (err) {
        trackEvent('checkout_start_error', { source, tier, code: checkoutErrorCode(err, SERVER_ERROR_CODES) })
        error.value = errorMessage(err, fallbackKey)
        isLoading.value = false
        if (err?.data?.statusMessage === 'subscription_exists') await syncAfterExistingSubscription()
    }
}

const subscribe = async () => {
    if (isLoading.value) return
    error.value = ''
    isLoading.value = true
    await startCheckout('standard', 'sub.error.start')
}

// Abonné Stripe vivant : la montée en Pro modifie l'abonnement EN PLACE
// (proratisé) — jamais un nouveau Checkout, qui doublerait la facturation.
// Sans abonnement Stripe (accès offert par l'admin), le Checkout reste la voie.
const subscribePro = async () => {
    if (isLoading.value) return
    // Aucune page Stripe ne récapitule ce changement : on le confirme ici.
    if (isStripeActive.value) {
        const terms = upgradeTermsText.value
        if (!window.confirm(`${t('sub.upgradePro')}\n\n${t(terms.key, terms.params)}`)) return
    }
    // Compté ici et pas sur le bouton : une confirmation refusée n'est pas une
    // montée. La carte d'achat a son propre compteur, porté par son bouton.
    if (isActive.value) trackEvent('click_subscription_upgrade_pro')
    error.value = ''
    isLoading.value = true
    if (!isStripeActive.value) {
        await startCheckout('privacy', 'sub.error.startPro')
        return
    }
    try {
        await $fetch('/api/payment/subscription/change', {
            method: 'POST',
            body: { targetTier: 'privacy' },
        })
        await refresh()
        // Montée en Pro en place : le palier change (3 nestings parallèles,
        // Turbo) — cache `user` ET store d'authentification, comme ailleurs.
        await refreshUser()
        isLoading.value = false
    } catch (err) {
        error.value = errorMessage(err, 'sub.error.startPro')
        isLoading.value = false
        if (err?.data?.statusMessage === 'subscription_exists') await syncAfterExistingSubscription()
    }
}

const openPortal = async () => {
    if (isLoading.value) return
    error.value = ''
    isLoading.value = true
    try {
        const response = await $fetch('/api/payment/portal', { method: 'POST' })
        navigateTo(response.url, { external: true })
    } catch (err) {
        error.value = errorMessage(err, 'sub.error.portal')
        isLoading.value = false
    }
}

const cancelSubscription = async () => {
    if (isLoading.value) return
    const confirmed = window.confirm(t('sub.cancelConfirm'))
    if (!confirmed) return
    error.value = ''
    isLoading.value = true
    try {
        await $fetch('/api/payment/subscription/cancel', { method: 'POST' })
        await refresh()
    } catch (err) {
        error.value = err?.data?.statusMessage || t('sub.error.cancel')
    } finally {
        isLoading.value = false
    }
}
</script>

<style lang="scss" scoped>
.subscription {
    /* U2-ter : les cartes s'empilent avec un vrai écart (elles se
       touchaient — « chevauchement » constaté sur un compte granté qui
       affiche la carte d'état ET la carte Pro) et suivent la largeur de
       la colonne, plus de bloc centré à 420 px. */
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 16px;
    width: 100%;

    &__title {
        margin-bottom: 2px;
    }

    &__card {
        min-width: 0;
        padding: 24px 20px;
        border: 1px solid var(--separator-secondary);
        border-radius: var(--radius-l);
        background: var(--fill-tertiary);
        text-align: left;
    }

    &__desc {
        margin-top: 12px;
        font-size: var(--fs-14);
        color: var(--label-secondary);
    }

    &__plan-title {
        font-size: var(--fs-16);
        font-weight: 600;
        color: var(--label-primary);
        margin-bottom: 6px;
    }

    &__price {
        font-size: var(--fs-32);
        font-weight: 800;
        color: var(--label-primary);
    }

    &__interval {
        font-size: var(--fs-14);
        font-weight: 500;
        color: var(--label-secondary);
    }

    &__free {
        margin: 12px 0 4px;
        font-size: var(--fs-13);
        color: var(--accent-primary);
    }

    // Date de reset du quota gratuit : discrète, sous le compteur.
    &__reset {
        margin: 0 0 18px;
        font-size: var(--fs-12);
        color: var(--label-tertiary);
    }

    // Override MainButton's default `width: max-content` so the trial button
    // stretches to the full width of the card. The descendant selector raises
    // specificity enough to win against the child component's own scoped rule.
    &__card &__btn {
        width: 100%;
        max-width: 280px;
    }

    &__btn--cancel {
        margin-top: 16px;
    }

    &__cancel-notice {
        margin-top: 12px;
        font-size: var(--fs-14);
        color: var(--label-secondary);
    }

    // O3 : phrase de contexte (« ce résultat compte N tôles… »).
    &__context {
        margin: 0 0 14px;
        font-size: var(--fs-14);
        line-height: 1.45;
        color: var(--label-primary);
    }

    &__features {
        margin: 14px 0 0;
        padding-left: 18px;
        font-size: var(--fs-13);
        color: var(--label-secondary);
        line-height: 1.5;
    }

    &__terms {
        margin-top: 12px;
        font-size: var(--fs-13);
        color: var(--label-primary);
        line-height: 1.4;
    }

    &__plan--pro {
        margin-top: 24px;
        padding-top: 20px;
        border-top: 1px solid var(--separator-secondary);
    }

    &__note {
        margin-top: 14px;
        font-size: var(--fs-13);
        color: var(--label-secondary);
    }

    &__error {
        margin-top: 16px;
        padding: 12px;
        border-radius: var(--radius-l);
        color: rgb(222, 0, 54);
    }
}
</style>
