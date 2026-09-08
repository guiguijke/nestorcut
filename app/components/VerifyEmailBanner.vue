<template>
    <!-- 3.1.5 (lot 3, A6/A7) : bannière persistante « e-mail non vérifié » —
         les comptes locaux doivent cliquer le lien avant de nester. -->
    <div v-if="visible" class="verify-banner" role="status" data-testid="verify-banner">
        <p class="verify-banner__text">
            {{ t('verify.banner', { email: user.email || '' }) }}
        </p>
        <UiButton
            class="verify-banner__resend"
            variant="secondary"
            size="s"
            :disabled="resent || sending"
            data-testid="verify-banner-resend"
            @click="resend"
        >
            {{ resent ? t('verify.bannerResent') : t('verify.bannerResend') }}
        </UiButton>
    </div>
</template>

<script setup>
const { t } = useLocale()
const { getters } = authStore

const user = computed(() => unref(getters.user) || {})
const visible = computed(() =>
    user.value.provider === 'local' && user.value.emailVerified === false)

const resent = ref(false)
const sending = ref(false)
const resend = async () => {
    if (sending.value || resent.value) return
    sending.value = true
    try {
        await $fetch('/api/auth/local/resend-verification', { method: 'POST' })
        resent.value = true
    } catch {
        // Best-effort : rate-limit 10/h — le lien check-email reste l'autre
        // voie (aucune erreur crue affichée dans la bannière).
    } finally {
        sending.value = false
    }
}
</script>

<style lang="scss" scoped>
.verify-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    padding: 10px 14px;
    margin-bottom: 14px;
    border: 1px solid var(--warn);
    border-radius: var(--radius-l);
    background-color: color-mix(in srgb, var(--warn) 8%, transparent);

    &__text {
        margin: 0;
        font-size: var(--fs-13);
        line-height: 1.45;
        color: var(--label-primary);
        flex: 1 1 320px;
    }

    /* U1 passe 2 : renvoi migré sur UiButton secondary s — la bannière
       porte déjà le ton d'avertissement, le bouton reste neutre. */
    &__resend {
        flex-shrink: 0;
    }
}
</style>
