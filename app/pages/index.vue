<template>
    <div class="welcome">
        <!-- A8/3.1.6 : échec de connexion Google remonté par le callback
             (?auth_error=…) — un message explicite, pas un retour muet. -->
        <div v-if="googleError" class="welcome__auth-error" role="alert">
            {{ googleError }}
            <NuxtLink
                v-if="authErrorCode === 'email_taken_local'"
                to="/auth/forgot-password"
                class="welcome__auth-error-link"
                data-testid="google-error-forgot"
            >
                {{ t('auth.forgotPassword') }}
            </NuxtLink>
        </div>
        <div class="welcome__card card">
            <img src="/brand/n-mark.png" alt="NestorCut" class="card__logo" />
            <MainTitle :label="t('auth.loginAccount')" class="card__title" />
            <p class="card__tagline">{{ t('auth.tagline') }}</p>
            <p class="card__hint">{{ t('auth.demoHint') }}</p>
            <div v-if="googleEnabled" class="card__item">
                <MainButton
                    :theme="themeType.secondary"
                    trackingTag="login_google"
                    @click="doAuth('google')"
                    :label="t('auth.loginGoogle')"
                />
            </div>
            <template v-if="localAuthEnabled">
                <div v-if="googleEnabled" class="card__divider">
                    <span>{{ t('auth.or') }}</span>
                </div>
                <MainButton
                    :theme="themeType.primary"
                    trackingTag="login_email"
                    tag="a"
                    href="/auth/local?mode=login"
                    :label="t('auth.loginEmail')"
                />
            </template>
        </div>
    </div>
</template>

<script setup>
import { themeType } from '~~/constants/theme.constants'

// The marketing site lives at nestorcut.com — the app root is only an entry
// point: signed-in users go straight to their workspace, everyone else gets
// the sign-in screen.
definePageMeta({
    middleware: 'auth'
})

const { getters } = authStore
const { userIsSet } = toRefs(getters)

if (unref(userIsSet)) {
    await navigateTo('/home')
}

const { t } = useLocale()

// A8 : codes renvoyés par /auth/google/callback vers /?auth_error=…
const GOOGLE_ERROR_KEYS = {
    exchange_failed: 'auth.googleError.exchange_failed',
    access_denied: 'auth.googleError.access_denied',
    no_email: 'auth.googleError.no_email',
    email_taken_local: 'auth.googleError.email_taken_local',
}
const config = useRuntimeConfig()
const localAuthEnabled = computed(() => config.public.localAuthEnabled !== false && config.public.localAuthEnabled !== 'false')

const route = useRoute()
// Sans connexion par e-mail, « connectez-vous avec votre mot de passe »
// serait une impasse : message générique, pas de lien.
const authErrorCode = computed(() => {
    const code = String(route.query.auth_error || '')
    return code === 'email_taken_local' && !localAuthEnabled.value ? 'generic' : code
})
const googleError = computed(() => {
    const code = authErrorCode.value
    if (!code) return ''
    const key = GOOGLE_ERROR_KEYS[code]
    return key ? t(key) : t('auth.googleError.generic')
})
const googleEnabled = computed(() => Boolean(config.public.googleClientId))

const doAuth = async (provider) => {
    const response = await $fetch(API_ROUTES.AUTH(provider), {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
    })
    navigateTo(response.url, { external: true })
}

onMounted(() => {
    trackEvent('page_view', { page: 'signin' })
})
</script>

<style lang="scss" scoped>
.welcome {
    &__auth-error {
        width: 100%;
        max-width: 380px;
        margin: 0 auto 12px;
        padding: 10px 14px;
        border: 1px solid var(--error-border);
        border-radius: var(--radius-l);
        background-color: var(--error-background);
        color: var(--error-text, var(--danger));
        font-size: var(--fs-13);
        line-height: 1.45;
    }
    &__auth-error-link {
        display: block;
        margin-top: 6px;
        color: inherit;
        text-decoration: underline;
    }

    // En colonne : l'erreur Google au-dessus de la carte, pas à côté.
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 60vh;
    padding: 24px;

    &__card {
        width: 100%;
        max-width: 380px;
    }
}

.card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 40px 32px;
    background: var(--surface);
    border: 1px solid var(--separator-secondary);
    border-radius: var(--radius-l);

    &__logo {
        width: 56px;
        height: 56px;
        border-radius: var(--radius);
        margin-bottom: 4px;
    }

    &__title {
        text-align: center;
        margin-bottom: 4px;
    }

    &__tagline {
        text-align: center;
        color: var(--text-2);
        font-size: var(--fs-14);
        line-height: 1.45;
        margin: 0;
        max-width: 28rem;
    }

    &__hint {
        text-align: center;
        color: var(--text-3);
        font-size: var(--fs-13);
        line-height: 1.45;
        margin: 0 0 8px;
        max-width: 28rem;
    }

    &__item {
        width: 100%;
        display: flex;
        justify-content: center;
    }

    &__divider {
        color: var(--label-secondary);
        font-size: var(--fs-13);
    }
}
</style>
