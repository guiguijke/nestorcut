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

        <div v-if="isActive && data?.isPrivacyTier" class="subscription__card">
            <div class="subscription__status">
                <UiBadge tone="ok" dot>{{ t('sub.proPrivacy') }}</UiBadge>
            </div>
            <p class="subscription__desc">{{ t('sub.proActiveDesc') }}</p>
        </div>

        <div v-else-if="isActive && data?.privacyPlan" class="subscription__card">
            <div class="subscription__plan-title">{{ data.privacyPlan.title || t('sub.proPrivacy') }}</div>
            <div class="subscription__price">
                {{ formatPrice(data.privacyPlan.amount, data.privacyPlan.currency) }}
                <span class="subscription__interval">/ {{ data.privacyPlan.interval }}</span>
            </div>
            <p class="subscription__desc">{{ t('sub.proDesc') }}</p>
            <MainButton
                v-if="!paidDisabled"
                :label="t('sub.upgradePro')"
                :theme="themeType.primary"
                :size="sizeType.m"
                :isDisable="isLoading"
                trackingTag="subscription_upgrade_pro"
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

        <div v-else-if="!isGranted && !isPastDue" class="subscription__card">
            <div v-if="data?.plan" class="subscription__plan">
                <div class="subscription__plan-title">{{ data.plan.title || t('sub.monthlyPlan') }}</div>
                <div class="subscription__price">
                    {{ formatPrice(data.plan.amount, data.plan.currency) }}
                    <span class="subscription__interval">/ {{ data.plan.interval }}</span>
                </div>
                <div class="subscription__free">
                    {{ t('sub.freeLeft', { n: data.freeRemaining }) }}
                </div>
                <div class="subscription__reset">
                    {{ t('sub.resetsAt', { date: quotaResetLabel }) }}
                </div>
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
            <div v-else class="subscription__desc">
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

const { t, locale } = useLocale()
// Relecture L4 : la date suit la langue de l'app, pas celle du navigateur.
import { intlTag } from '~/utils/i18n'

// Date+heure localisées du reset du quota gratuit (1er du mois suivant,
// 00:00 UTC) — affichées près du compteur de nestings restants.
const quotaResetLabel = computed(() => formatQuotaReset(new Date(), locale.value))

// Temporarily disable paid-plan CTAs (Unlimited trial + Pro upgrade) until
// Toggle via NUXT_PUBLIC_PAID_PLANS_DISABLED.
const paidDisabled = computed(() => useRuntimeConfig().public.paidPlansDisabled === true)

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
// past_due / unpaid : le paiement a échoué, l'accès est coupé tant que la
// carte n'est pas mise à jour (via le portail Stripe). `unpaid` = relances
// épuisées mais l'abonnement existe encore : jamais la carte « s'abonner ».
const isPastDue = computed(() => {
    const status = unref(data)?.subscriptionStatus
    return status === 'past_due' || status === 'unpaid'
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

const formatPrice = (amount, currency) => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }).format(amount)
}

// Les statusMessage serveur sont des codes stables : traduits ici, repli
// générique sinon.
const SERVER_ERROR_CODES = ['subscription_exists', 'portal_unavailable']
const errorMessage = (err, fallbackKey) => {
    const code = err?.data?.statusMessage
    return SERVER_ERROR_CODES.includes(code) ? t(`sub.error.${code}`) : t(fallbackKey)
}

const subscribe = async () => {
    if (isLoading.value) return
    error.value = ''
    isLoading.value = true
    try {
        const response = await $fetch('/api/payment/subscribe')
        navigateTo(response.url, { external: true })
    } catch (err) {
        error.value = errorMessage(err, 'sub.error.start')
        isLoading.value = false
        // Abonnement déjà vivant (autre onglet / webhook en retard) : on
        // recharge la carte plutôt que de laisser un CTA d'achat périmé.
        if (err?.data?.statusMessage === 'subscription_exists') await refresh()
    }
}

// Abonné Stripe vivant : la montée en Pro modifie l'abonnement EN PLACE
// (proratisé) — jamais un nouveau Checkout, qui doublerait la facturation.
// Sans abonnement Stripe (accès offert par l'admin), le Checkout reste la voie.
const subscribePro = async () => {
    if (isLoading.value) return
    error.value = ''
    isLoading.value = true
    try {
        if (isStripeActive.value) {
            await $fetch('/api/payment/subscription/change', {
                method: 'POST',
                body: { targetTier: 'privacy' },
            })
            await refresh()
            await refreshNuxtData('user')
            isLoading.value = false
            return
        }
        const response = await $fetch('/api/payment/subscribe?tier=privacy')
        navigateTo(response.url, { external: true })
    } catch (err) {
        error.value = errorMessage(err, 'sub.error.startPro')
        isLoading.value = false
        if (err?.data?.statusMessage === 'subscription_exists') await refresh()
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
