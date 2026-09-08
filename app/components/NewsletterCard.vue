<template>
    <!-- C1-c (D5) : re-demande newsletter DISCRÈTE, jamais modale, tous les
         90 jours aux comptes qui n'ont pas opté in. La première demande
         reste la modale existante (NewsletterPrompt) ; quand la carte
         s'affiche, la modale se tait (une seule sollicitation à l'écran). -->
    <div
        v-if="visible"
        class="nlcard"
        data-testid="newsletter-card"
    >
        <div class="nlcard__body">
            <p class="nlcard__title">{{ t('newsletter.cardTitle') }}</p>
            <p class="nlcard__text">{{ t('newsletter.cardText') }}</p>
        </div>
        <div class="nlcard__actions">
            <MainButton
                :theme="themeType.primary"
                :label="t('newsletter.yes')"
                trackingTag="newsletter_prompt_yes"
                @click="answer(true)"
            />
            <MainButton
                :theme="themeType.secondary"
                :label="t('newsletter.later')"
                trackingTag="newsletter_prompt_no"
                @click="answer(false)"
            />
        </div>
        <UiButton
            variant="ghost"
            size="s"
            icon="close"
            :aria-label="t('newsletter.later')"
            :title="t('newsletter.later')"
            class="nlcard__close"
            @click="answer(false)"
        />
    </div>
</template>

<script setup>
import { themeType } from '~~/constants/theme.constants'
import { shouldAskNewsletter } from '~~/shared/newsletterAsk'

const { t } = useLocale()
const { getters } = authStore

const visible = computed(() =>
    unref(getters.userIsSet) && shouldAskNewsletter(unref(getters.user) || {}, Date.now()))

// Tracking : mêmes événements que la modale (liste blanche inchangée) —
// `shown` une seule fois par affichage réel, `dismiss` couvre « Pas
// maintenant » et la croix.
const shownTracked = ref(false)
watch(visible, (open) => {
    if (open && !unref(shownTracked)) {
        shownTracked.value = true
        trackEvent('newsletter_prompt_shown')
    }
}, { immediate: true })

const answered = ref(false)
const answer = async (value) => {
    if (unref(answered)) return
    answered.value = true
    trackEvent(value ? 'newsletter_prompt_accept' : 'newsletter_prompt_dismiss')
    try {
        // « Oui » répond la question ; « Pas maintenant » et la croix ne
        // posent que l'horloge (newsletterAsked) — optIn reste tel quel.
        await $fetch('/api/user/preferences', {
            method: 'PATCH',
            credentials: 'include',
            body: value ? { newsletterOptIn: true } : { newsletterAsked: true },
        })
        // Même séquence que la modale : rafraîchir le cache AVANT setUser,
        // sinon la carte voit l'ancien état et reste affichée.
        await refreshNuxtData('user')
    } catch {
        // Même en échec : pas de re-sollicitation cette session.
    } finally {
        await authStore.actions.setUser()
    }
}
</script>

<style lang="scss" scoped>
.nlcard {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
    padding: 14px 44px 14px 16px;
    border: 1px solid var(--separator-secondary);
    border-radius: var(--radius-l);
    background-color: var(--fill-tertiary);
    text-align: left;

    &__body {
        flex: 1 1 320px;
    }

    &__title {
        font-size: var(--fs-14);
        font-weight: 700;
        color: var(--label-primary);
    }

    &__text {
        margin-top: 2px;
        font-size: var(--fs-13);
        color: var(--label-secondary);
        line-height: 1.5;
    }

    &__actions {
        display: flex;
        gap: 8px;
    }

    &__close {
        position: absolute;
        top: 8px;
        right: 8px;
    }
}
</style>
