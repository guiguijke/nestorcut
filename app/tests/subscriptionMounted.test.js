import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { LOCALES, translate } from '../utils/i18n'
import { hasLiveSubscription, isTrialEligible } from '../../server/features/payment/eligibility'
import { mountSfc, passthrough } from './helpers/mountSfc'

// La fenêtre d'abonnement et la carte du profil MONTÉES : ce qu'un compte lit
// et ce que ses clics déclenchent, état par état.

const file = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const PLAN = { title: 'NestorCut Unlimited', amount: 19, currency: 'eur', interval: 'month', trialDays: 7, priceId: 'p_u' }
const PRO = { title: 'NestorCut Pro', amount: 39, currency: 'eur', interval: 'month', trialDays: 7, priceId: 'p_p' }
const END = '2026-11-12T12:00:00.000Z'

const serverInfo = (over = {}) => ({
    plan: PLAN,
    privacyPlan: PRO,
    isPrivacyTier: false,
    trialEligible: false,
    canManageBilling: true,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: END,
    freeRemaining: 10,
    subscriptionStatus: 'active',
    granted: false,
    requiresPaywall: false,
    ...over,
})

async function mountCard(info, { locale = 'fr', context = null, paidDisabled = false, level = 'standard', confirm = true } = {}) {
    const trackEvent = vi.fn()
    const $fetch = vi.fn(async () => ({ url: 'https://stripe.test/session' }))
    const windowStub = { confirm: vi.fn(() => confirm), sessionStorage: { setItem() {}, getItem() { return null }, removeItem() {} } }
    const localeRef = ref(locale)
    const view = await mountSfc(file('../components/Subscription.vue'), {
        props: { context },
        modules: { '~/utils/track': { trackEvent } },
        components: { UiBadge: passthrough },
        globals: {
            useLocale: () => ({ locale: localeRef, t: (key, params) => translate(key, locale, params) }),
            useRuntimeConfig: () => ({ public: { paidPlansDisabled: paidDisabled } }),
            useRoute: () => ({ path: '/profile' }),
            useFetch: async () => ({ data: ref(info), refresh: vi.fn(async () => {}) }),
            useNuxtData: () => ({ data: ref({ compute: { level } }) }),
            refreshNuxtData: vi.fn(async () => {}),
            authStore: { actions: { setUser: vi.fn(async () => {}) } },
            navigateTo: vi.fn(),
            $fetch,
            window: windowStub,
        },
    })
    return { view, trackEvent, $fetch, confirm: windowStub.confirm }
}

const dict = (key, locale, params) => translate(key, locale, params)
/** Partie fixe d'une phrase à paramètres : présente quel que soit le montant. */
const fixedPart = (text) => text.split(/\{[a-z]+\}/).map((part) => part.trim()).sort((a, b) => b.length - a.length)[0]

describe('abonnement résilié en fin de période : pas de montée, une phrase vraie', () => {
    for (const status of ['trialing', 'active']) {
        for (const locale of LOCALES) {
            it(`${status}, ${locale} : la fin est annoncée, la suite est dite, rien ne promet Pro`, async () => {
                const { view, confirm } = await mountCard(serverInfo({ subscriptionStatus: status, cancelAtPeriodEnd: true }), { locale })
                const text = view.text()
                expect(text).toContain(fixedPart(dict('sub.cancelNotice', locale)))
                expect(view.byTestId('subscription-pro-after-end')).not.toBeNull()
                expect(text).toContain(dict('sub.proAfterEnd', locale))
                expect(text).not.toContain(dict('sub.upgradePro', locale))
                expect(view.buttonNamed(dict('sub.upgradePro', locale))).toBeNull()
                expect(text).not.toContain(fixedPart(dict('sub.terms.upgradeTrial', locale)))
                expect(text).not.toContain(fixedPart(dict('sub.terms.upgradeActive', locale)))
                expect(view.byTestId('subscription-terms-upgrade')).toBeNull()
                expect(confirm).not.toHaveBeenCalled()
            })
        }
    }

    it("la phrase ne promet pas d'essai, dans aucune langue", () => {
        const trialWords = { en: /trial/i, fr: /essai/i, de: /test/i, es: /prueba/i, it: /prova/i, pt: /avalia/i }
        for (const locale of LOCALES) expect(dict('sub.proAfterEnd', locale), locale).not.toMatch(trialWords[locale])
    })

    it('un compte déjà Pro qui résilie ne lit pas « pour passer à Pro »', async () => {
        const { view } = await mountCard(serverInfo({ cancelAtPeriodEnd: true, isPrivacyTier: true }), { level: 'privacy' })
        expect(view.byTestId('subscription-pro-after-end')).toBeNull()
        expect(view.text()).toContain(fixedPart(dict('sub.cancelNotice', 'fr')))
    })

    it('sans offre Pro à vendre (plan absent, offres fermées), la phrase ne promet rien', async () => {
        const noPlan = await mountCard(serverInfo({ cancelAtPeriodEnd: true, privacyPlan: null }))
        expect(noPlan.view.byTestId('subscription-pro-after-end')).toBeNull()
        const closed = await mountCard(serverInfo({ cancelAtPeriodEnd: true }), { paidDisabled: true })
        expect(closed.view.byTestId('subscription-pro-after-end')).toBeNull()
    })

    it('sans résiliation, la montée reste offerte avec sa phrase', async () => {
        const { view } = await mountCard(serverInfo())
        expect(view.buttonNamed(dict('sub.upgradePro', 'fr'))).not.toBeNull()
        expect(view.byTestId('subscription-terms-upgrade')).not.toBeNull()
        expect(view.byTestId('subscription-pro-after-end')).toBeNull()
    })

    it("après l'échéance (statut canceled, indicateur resté vrai), la phrase est vraie : Pro s'achète sans essai", async () => {
        const stored = { stripeSubscriptionId: 'sub_1', status: 'canceled', cancelAtPeriodEnd: true }
        expect(hasLiveSubscription({ subscription: stored })).toBe(false)
        expect(isTrialEligible({ subscription: stored })).toBe(false)

        const { view, $fetch, confirm } = await mountCard(
            serverInfo({ subscriptionStatus: 'canceled', cancelAtPeriodEnd: true, trialEligible: false, canManageBilling: true }),
            { level: 'free' },
        )
        expect(view.byTestId('subscription-pro-after-end')).toBeNull()
        const pro = view.byTestId('subscription-pro-offer')
        expect(view.textOf(pro)).toContain(fixedPart(dict('sub.terms.noTrial', 'fr')))
        expect(view.textOf(pro)).not.toContain(dict('sub.startTrial', 'fr', { days: 7 }))
        const subscribe = view.byClass('subscription__btn').find((node) => node.props['aria-label']?.includes(PRO.title))
            ?? view.byClass('subscription__btn').at(-1)
        await view.click(subscribe)
        expect(confirm).not.toHaveBeenCalled()
        expect($fetch).toHaveBeenCalledWith('/api/payment/subscribe', { query: { tier: 'privacy', returnTo: '/profile' } })
    })
})

async function mountPlans({ info, level = 'free', locale = 'fr', catalog = { standard: { available: true, ...PLAN }, privacy: { available: true, ...PRO } } }) {
    const openBuyCredits = vi.fn()
    const navigateTo = vi.fn()
    const trackEvent = vi.fn()
    const view = await mountSfc(file('../pages/plans.vue'), {
        modules: { '~/utils/track': { trackEvent } },
        components: { MainButton: file('../components/MainButton.vue'), LoginView: passthrough },
        globals: {
            definePageMeta: () => {},
            useLoginDialog: () => ref(false),
            useBuyCreditsOpener: () => openBuyCredits,
            authStore: { getters: { userIsSet: ref(true), user: ref({ compute: { level } }) } },
            useLocale: () => ({ locale: ref(locale), t: (key, params) => translate(key, locale, params) }),
            useRuntimeConfig: () => ({ public: { paidPlansDisabled: false } }),
            usePlans: () => ({ data: ref(catalog) }),
            useFetch: (url) => (url === '/api/payment/subscription'
                ? { data: ref(info), execute: vi.fn() }
                : { data: ref(null), status: ref('idle') }),
            trackEvent,
            navigateTo,
        },
    })
    const cards = view.byClass('cards__cta')
    return { view, cards: { free: cards[0], standard: cards[1], pro: cards[2] }, openBuyCredits, navigateTo }
}

describe('/plans, abonné Unlimited : le bouton Pro ne promet la montée que si elle est vraie', () => {
    const getPro = dict('plans.cta.getPro', 'fr')
    const manage = dict('plans.cta.manageInProfile', 'fr')

    for (const status of ['trialing', 'active']) {
        it(`${status} résilié : « Gérer dans le profil », et le clic va au profil`, async () => {
            const { view, cards, navigateTo, openBuyCredits } = await mountPlans({
                level: 'standard',
                info: serverInfo({ subscriptionStatus: status, cancelAtPeriodEnd: true }),
            })
            expect(view.textOf(cards.pro)).toBe(manage)
            await view.click(cards.pro)
            expect(navigateTo).toHaveBeenCalledWith('/profile')
            expect(openBuyCredits).not.toHaveBeenCalled()
        })
    }

    it('non résilié : « Passer à Pro », vers le profil', async () => {
        const { view, cards } = await mountPlans({ level: 'standard', info: serverInfo() })
        expect(view.textOf(cards.pro)).toBe(getPro)
    })

    it('réponse pas encore lue : rien de promis', async () => {
        const { view, cards } = await mountPlans({ level: 'standard', info: null })
        expect(view.textOf(cards.pro)).toBe(manage)
    })
})

describe('suppression du compte : même règle pour une alternative « Passer à Pro »', () => {
    async function mountDelete(info) {
        const { getters, actions } = {
            getters: { user: ref({ email: 'a@b.c', provider: 'google' }) },
            actions: { setUser: vi.fn(async () => {}) },
        }
        return mountSfc(file('../components/DeleteAccount.vue'), {
            modules: { '~/utils/track': { trackEvent: vi.fn() } },
            globals: {
                useLocale: () => ({ locale: ref('fr'), t: (key, params) => translate(key, 'fr', params) }),
                useRouter: () => ({ push: vi.fn() }),
                useRuntimeConfig: () => ({ public: { paidPlansDisabled: false } }),
                useFetch: async () => ({ data: ref(info), refresh: vi.fn(async () => {}) }),
                API_ROUTES: { SUBSCRIPTION: '/api/payment/subscription', SUBSCRIPTION_CHANGE: '/x', SUBSCRIBE: '/y' },
                authStore: { getters, actions },
                navigateTo: vi.fn(),
                $fetch: vi.fn(),
                window: {},
            },
        })
    }

    it('résilié : le bouton n’est pas offert ; non résilié : il reste', async () => {
        const label = dict('account.toPrivacy', 'fr', { plan: PRO.title })
        expect((await mountDelete(serverInfo({ cancelAtPeriodEnd: true }))).buttonNamed(label)).toBeNull()
        expect((await mountDelete(serverInfo())).buttonNamed(label)).not.toBeNull()
    })
})

describe('suivi de la montée en Pro : compté après acceptation, jamais avant', () => {
    const upgrades = (trackEvent) => trackEvent.mock.calls.filter(([name]) => name === 'click_subscription_upgrade_pro')

    it('confirmation refusée : aucun compteur de montée, aucun appel', async () => {
        const { view, trackEvent, $fetch, confirm } = await mountCard(serverInfo(), { confirm: false })
        await view.click(view.buttonNamed(dict('sub.upgradePro', 'fr')))
        expect(confirm).toHaveBeenCalledTimes(1)
        expect(upgrades(trackEvent)).toHaveLength(0)
        expect($fetch).not.toHaveBeenCalled()
    })

    it('confirmation acceptée : compté une fois, puis la montée part', async () => {
        const { view, trackEvent, $fetch } = await mountCard(serverInfo(), { confirm: true })
        await view.click(view.buttonNamed(dict('sub.upgradePro', 'fr')))
        expect(upgrades(trackEvent)).toHaveLength(1)
        expect($fetch).toHaveBeenCalledWith('/api/payment/subscription/change', { method: 'POST', body: { targetTier: 'privacy' } })
    })

    it('accès offert, sans confirmation (Checkout) : compté une fois', async () => {
        const info = serverInfo({ subscriptionStatus: null, granted: true, canManageBilling: false, currentPeriodEnd: null })
        const { view, trackEvent, confirm } = await mountCard(info)
        await view.click(view.buttonNamed(dict('sub.upgradePro', 'fr')))
        expect(confirm).not.toHaveBeenCalled()
        expect(upgrades(trackEvent)).toHaveLength(1)
    })

    it('le bouton Pro de la carte d’achat garde son propre compteur', async () => {
        const info = serverInfo({ subscriptionStatus: null, trialEligible: true, canManageBilling: false, currentPeriodEnd: null })
        const { view, trackEvent } = await mountCard(info, { level: 'free' })
        await view.click(view.byClass('subscription__btn').at(-1))
        expect(upgrades(trackEvent)).toHaveLength(0)
        expect(trackEvent.mock.calls.filter(([name]) => name === 'click_subscription_start_trial_pro')).toHaveLength(1)
    })
})
