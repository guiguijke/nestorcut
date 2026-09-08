<template>
    <div
        v-if="user.name"
        class="profile"
    >
        <!-- 3.1.5 : bannière e-mail non vérifié (comptes locaux). -->
        <VerifyEmailBanner />

        <!-- U2-ter : identité sur une ligne — avatar 64 px, nom, badge
             « Vérifié » en CONTOUR (plus d'aplat en pilule), déconnexion
             en bouton fantôme à droite. -->
        <header class="profile__identity identity">
            <Avatar class="identity__avatar" />
            <div class="identity__body">
                <h1 class="identity__name">{{ user.name }}</h1>
                <!-- 3.1.5 (A7) : badge de vérification e-mail à côté du nom. -->
                <UiBadge
                    v-if="emailVerified"
                    tone="ok"
                    dot
                >{{ t('verify.badge') }}</UiBadge>
            </div>
            <UiButton
                variant="ghost"
                tracking-tag="logout"
                class="identity__logout"
                @click="logoutHandler"
            >
                {{ t('nav.logout') }}
            </UiButton>
        </header>

        <UserStats class="profile__block" />
        <Subscription class="profile__block" />
        <PromoCodeSettings class="profile__block" />
        <NewsletterSettings class="profile__block" />
        <VaultSettings
            v-if="isStripFeatureEnable"
            class="profile__block"
        />
        <DeleteAccount class="profile__block" />
    </div>
</template>
<script setup>
    const router = useRouter()
    const { t } = useLocale()

    // U2-ter : la page profil prend la grille de l'accueil (colonnes
    // projets / centre / résultats, mêmes gouttières) — plus de colonne
    // centrée à 660 px.
    definePageMeta({
        layout: 'auth',
        middleware: 'auth',
    })

    const { getters, actions } = authStore
    const { logout } = actions
    const user = computed(() => getters.user)

    const emailVerified = computed(() => {
        const u = unref(getters.user)
        return u?.provider === 'local' ? u?.emailVerified === true : true
    })

    const isStripFeatureEnable = computed(() => {
        return Boolean(unref(getters.user)?.isStripFeatureEnable)
    })

    const logoutHandler = async () => {
        await logout()
        router.push({ path: '/' })
    }
</script>
<style lang="scss" scoped>
    .profile {
        display: flex;
        flex-direction: column;
        gap: 32px;
        /* Les cartes prennent toute la colonne centrale ; seul le texte
           courant est borné (lisibilité). */
        width: 100%;

        &__block {
            width: 100%;
        }
    }

    .identity {
        display: flex;
        align-items: center;
        gap: 16px;
        text-align: left;

        &__body {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 6px;
            min-width: 0;
            max-width: 720px;
        }

        &__name {
            font-family: var(--font-display);
            font-size: var(--fs-22);
            color: var(--text);
            line-height: var(--lh-title);
        }

        &__logout {
            margin-left: auto;
        }
    }
</style>
