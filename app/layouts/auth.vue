<template>
    <div class="main">
        <MainHeader
            :theme="themeType.primary"
            class="main__header"
        />
        <main class="main__content content">
            <div class="content__controls controls">
                <div :class="{'controls__bg--open': projectsIsOpen || resultsIsOpen}" @click="close" class="controls__bg"></div>
                <MainButton
                    ref="projectsBtn"
                    @click="openProjects"
                    trackingTag="open_projects"
                    class="controls__btn controls__btn--projects"
                    :theme="themeType.secondary"
                    :label="t('common.openProjects')"
                />
                <MainButton
                    ref="resultsBtn"
                    @click="openResults"
                    trackingTag="open_results"
                    class="controls__btn controls__btn--results"
                    :theme="themeType.secondary"
                    :label="isHomePage ? t('common.openAllResults') : t('common.openResults')"
                />
            </div>
            <UserProjects ref="projectsPane" :inert="paneInert(projectsIsOpen)" @closeAside="close" :class="{'content__projects--open': projectsIsOpen}" class="content__projects"/>
            <slot />
            <UserResults ref="resultsPane" :inert="paneInert(resultsIsOpen)" @closeAside="close" :class="{'content__results--open': resultsIsOpen}" class="content__results" />
        </main>
        <ChatSupport v-if="supportDialog" />
        <!-- U1 passe 2 : pilule flottante migrée sur UiButton secondary —
            une action secondaire, pas un aplat bleu. -->
        <UiButton
            v-if="!supportDialog"
            variant="secondary"
            size="s"
            class="main__btn"
            tracking-tag="support_open"
            @click="supportDialog = true"
        >
            {{ t('common.support') }}
        </UiButton>
        <Footer compact />
        <BuyCreditsDialog v-model:isModalOpen="buyCreditsDialog" />
        <VaultUnlock v-if="vaultLocked" />
    </div>
</template>
<script setup>
import { themeType } from '~~/constants/theme.constants';
const route = useRoute()
const { t } = useLocale()
const supportDialog = useSupportDialog();
const buyCreditsDialog = useBuyCreditsDialog();
const vaultUnlockDialog = useVaultUnlockDialog();

// O3 : retour de Stripe Checkout sur n'importe quelle page de ce layout
// (/home ne le traite plus) — palier rafraîchi sans recharger, fenêtre du
// résultat rouverte.
useCheckoutReturn();

// Auto-open the unlock modal whenever the vault is enabled but locked
// (e.g. after the 2h session TTL expired or on a fresh browser).
const { getters: authGetters } = authStore;
const vaultLocked = computed(() => {
    const encryption = unref(authGetters.user)?.encryption;
    return Boolean(encryption?.enabled && encryption?.locked);
});
watch(vaultLocked, (locked) => {
    if (locked) vaultUnlockDialog.value = true;
}, { immediate: true });

// Orange "secure environment" border around the whole screen while the user
// is actively working inside an unlocked vault. Toggled via a reactive
// htmlAttrs so it is SSR-friendly and auto-syncs when the lock state changes.
const vaultActive = computed(() => {
    const encryption = unref(authGetters.user)?.encryption;
    return Boolean(encryption?.enabled && !encryption?.locked);
});
// On the server the head is resolved AFTER render (renderSSRHead), outside
// any Nuxt context: authStore would read no request's state there, or
// another one's. Freeze the value now, during this request's setup.
const vaultActiveAttr = computed(() => (vaultActive.value ? 'true' : null));
useHead({
    htmlAttrs: {
        'data-vault-active': import.meta.server ? vaultActiveAttr.value : vaultActiveAttr,
    },
});
const projectsIsOpen = ref(false);
const resultsIsOpen = ref(false);
const projectsBtn = ref(null);
const resultsBtn = ref(null);
const projectsPane = ref(null);
const resultsPane = ref(null);

// A11y : sous 1319 px les colonnes sont des volets. Fermé, un volet est
// `inert` (hors tabulation et hors lecteur d'écran) ; en grand écran
// (colonnes toujours visibles) rien n'est inerte. `narrow` reste faux
// côté serveur et avant montage : le rendu initial ne change pas.
const narrow = ref(false);
let narrowQuery = null;
const syncNarrow = () => { narrow.value = Boolean(narrowQuery?.matches); };
const paneInert = (isOpen) => (narrow.value && !isOpen ? '' : undefined);

const focusInto = async (paneRef) => {
    await nextTick();
    const root = paneRef.value?.$el;
    const target = root?.querySelector?.(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    target?.focus?.();
};
const openProjects = () => {
    projectsIsOpen.value = true;
    focusInto(projectsPane);
}
const openResults = () => {
    resultsIsOpen.value = true;
    focusInto(resultsPane);
}
const close = () => {
    const back = projectsIsOpen.value ? projectsBtn : resultsIsOpen.value ? resultsBtn : null;
    projectsIsOpen.value = false;
    resultsIsOpen.value = false;
    // Le focus revient au bouton qui a ouvert le volet.
    back?.value?.$el?.focus?.();
}
const onKeydown = (event) => {
    if (event.key === 'Escape' && (projectsIsOpen.value || resultsIsOpen.value) && narrow.value) {
        close();
    }
};
onMounted(() => {
    narrowQuery = window.matchMedia('(max-width: 1318.98px)');
    syncNarrow();
    narrowQuery.addEventListener('change', syncNarrow);
    window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
    narrowQuery?.removeEventListener('change', syncNarrow);
    window.removeEventListener('keydown', onKeydown);
});
const isHomePage = computed(() => {
    return route.path === '/home'
})
</script>
<style lang="scss" scoped>
.main {
    // `clip` rogne comme `hidden` (panneaux hors champ) sans créer de zone de
    // défilement : un bloc `position: sticky` à l'intérieur colle à l'écran.
    overflow: clip;
    background-color: var(--background-primary);
    flex-direction: column;
    display: flex;
    min-height: 100vh;

    /* M3-ter : en-tête pleine largeur, aligne sur l en-tête déconnecté
       (les deux logos à 16 px du bord) ; le contenu garde sa largeur. */
    &__content {
        flex-grow: 1;
        margin: 24px auto;
        max-width: 1760px;
        width: 100%;
        // Place réservée au bouton « Support » flottant (petit, 32 px) :
        // le bas de la dernière colonne reste dégagé en fin de page.
        padding-bottom: 64px;

        @media (min-width: 480px) {
            padding-bottom: 72px;
        }
    }
    &__line {
        position: relative;
        z-index: 2;
    }
    &__btn {
        // Lot J11-bis (R7) : sous 480 px le bouton devient STATIQUE —
        // flottant il recouvrait les presets de tôle et tout contrôle
        // en bas de page. Il rejoint le flux, en fin de contenu.
        position: static;
        margin: 16px auto 0;
        display: block;
        width: fit-content;

        @media (min-width: 480px) {
            position: fixed;
            bottom: 16px;
            right: 16px;
            margin: 0;
            z-index: 3;
        }

        // Écarté du coin seulement quand la page projet a sa colonne de droite
        // (grille dès 1319 px) : en dessous, la zone du bouton Nest garde 104 px
        // à droite pour lui (`[slug].vue`, `&__cta`). Le seuil était 1199 px :
        // entre 1199 et 1318 px le bouton recouvrait le message sous Nest
        // (essai navigateur de la V0.9.21, 1280 × 800).
        @media (min-width: 1319px) {
            bottom: 24px;
            right: 24px;
        }
    }
}
.content {
    padding-left: 10px;
    padding-right: 10px;
    position: relative;
    
    @media (min-width: 1319px) {
        display: grid;
        grid-template-columns: 240px minmax(0, 1fr) 260px;
        gap: 28px;
        align-items: start;
    }

    &__controls {
        margin-bottom: 16px;
    }
    &__projects {
        z-index: 4;
        position: absolute;
        left: 0;
        top: 0;
        width: 280px;
        transform: translateX(-200%);
        transition: transform 0.3s ease;

        @media (min-width: 1319px) {
            position: initial;
            left: initial;
            top: initial;
            width: initial;
            transform: initial;
        }

        &--open {
            transform: translateX(10px);

            @media (min-width: 1319px) {
                transform: initial;
            }
        }

        &::after {
            z-index: -1;
            content: '';
            position: absolute;
            top: -10px;
            left: -10px;
            right: -10px;
            bottom: -10px;
            border-radius: 0 var(--radius-l) var(--radius-l) 0;
            background-color: var(--background-primary);

            @media (min-width: 1319px) {
                display: none;
            }
        }
    }
    &__results {
        z-index: 4;
        top: 0;
        right: 0;
        position: absolute;
        width: 280px;
        transform: translateX(200%);
        transition: transform 0.3s ease;

        @media (min-width: 1319px) {
            position: initial;
            right: initial;
            top: initial;
            width: initial;
            transform: initial;
        }

        &--open {
            transform: translateX(-10px);

            @media (min-width: 1319px) {
                transform: initial;
            }
        }

        &::after {
            z-index: -1;
            content: '';
            position: absolute;
            top: -10px;
            left: -10px;
            right: -10px;
            bottom: -10px;
            border-radius: var(--radius-l) 0 0 var(--radius-l);
            background-color: var(--background-primary);

            @media (min-width: 1319px) {
                display: none;
            }
        }
    }
}
.controls {
    display: flex;
    justify-content: space-between;

    @media (min-width: 1319px) {
        display: none;
    }

    &__bg {
        z-index: 4;    
        position: fixed;
        top: 0;
        height: 100vh;
        left: 0;
        width: 100vw;
        background-color: var(--label-tertiary);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s ease;

        &--open {
            opacity: 1;
            pointer-events: all;
        }
    }
}
</style>