<template>
    <teleport to="body">
        <div v-if="isModalOpen" class="modal">
            <div :class="['modal__background', { 'modal__background--dim': backdrop === 'dim' }]" @click="closeModal"></div>
            <!-- 3.1.4 (lot 3, M1) : dialogue accessible — role/aria-modal,
                 focus initial dans la boîte, piège de focus Tab/Shift+Tab,
                 restitution au déclencheur à la fermeture. -->
            <div
                ref="bodyEl"
                :class="['modal__body', 'modal-body', { 'modal__body--full': fullscreen }]"
                role="dialog"
                aria-modal="true"
                :aria-label="t('common.dialog')"
                @keydown.tab="trapTab"
            >
                <MainButton :label="t('common.close')" :isLabelShow=false :size="sizeType.s" :icon="iconType.close" trackingTag="modal_close" @click="closeModal" class="modal-body__close" />
                <slot />
            </div>
        </div>
    </teleport>
</template>

<script>
// Verrou de défilement de la page, partagé par toutes les instances : avec
// deux fenêtres ouvertes, la page ne se libère qu'à la fermeture de la
// dernière, et retrouve l'overflow qu'elle avait avant la première.
// Pile des fenêtres ouvertes (la dernière ouverte est celle du dessus) : Échap ne
// ferme que celle du dessus, jamais la fenêtre de résultat posée dessous.
const openStack = []
let nextDialogId = 0
let scrollLocks = 0
let savedOverflow = ''
let savedPaddingRight = ''
function acquireScrollLock() {
    if (typeof document === 'undefined') return
    if (scrollLocks === 0) {
        const body = document.body
        savedOverflow = body.style.overflow
        savedPaddingRight = body.style.paddingRight
        // La barre de défilement disparaît : on garde sa largeur pour que la page ne saute pas.
        const bar = window.innerWidth - document.documentElement.clientWidth
        if (bar > 0) body.style.paddingRight = `${bar}px`
        body.style.overflow = 'hidden'
    }
    scrollLocks++
}
function releaseScrollLock() {
    if (typeof document === 'undefined' || scrollLocks === 0) return
    scrollLocks--
    if (scrollLocks === 0) {
        document.body.style.overflow = savedOverflow
        document.body.style.paddingRight = savedPaddingRight
    }
}
</script>

<script setup>
import { iconType } from '~~/constants/icon.constants';
import { sizeType } from '~~/constants/size.constants';
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { trackEvent } from '~/utils/track';

const { t } = useLocale();

const { isModalOpen, trackingTag, fullscreen, backdrop, lockScroll } = defineProps({
    isModalOpen: {
        type: Boolean,
        default: false,
    },
    trackingTag: {
        type: String,
        default: '',
    },
    // U3 passe 2 : dialogue plein ecran a 24 px de marge (espace de
    // resultat). Les autres dialogues gardent la boite centree.
    fullscreen: {
        type: Boolean,
        default: false,
    },
    // Opt-in : 'dim' = voile sombre translucide (la page reste visible
    // derrière) ; 'default' = le fond d'origine.
    backdrop: {
        type: String,
        default: 'default',
    },
    // Opt-in : fige le défilement de la page tant que la fenêtre est ouverte.
    lockScroll: {
        type: Boolean,
        default: false,
    },
})

const emit = defineEmits(["update:isModalOpen"]);

const bodyEl = ref(null)
// 3.1.4 : élément qui avait le focus quand le dialogue s'est ouvert — il
// y est RESTITUÉ à la fermeture (clavier et lecteurs d'écran).
let previouslyFocused = null

const dialogId = nextDialogId++
const closeModal = () => {
    emit("update:isModalOpen", false);
}

// 3.1.4 : piège de focus — Tab/Shift+Tab restent dans le dialogue.
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const trapTab = (event) => {
    const root = bodyEl.value
    if (!root) return
    const nodes = [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null)
    if (!nodes.length) return
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault()
        last.focus()
    } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
    }
}

// Verrou de défilement : pris à l'ouverture, rendu à la fermeture, quand
// l'option disparaît et au démontage (une seule fois par instance).
let holdsLock = false
watch([() => isModalOpen, () => lockScroll], ([isOpen, lock]) => {
    const want = Boolean(isOpen && lock)
    if (want && !holdsLock) {
        acquireScrollLock()
        holdsLock = true
    } else if (!want && holdsLock) {
        releaseScrollLock()
        holdsLock = false
    }
}, { immediate: true })

const leaveStack = () => {
    const i = openStack.indexOf(dialogId)
    if (i >= 0) openStack.splice(i, 1)
}
watch(() => isModalOpen, (isOpen) => {
    leaveStack()
    if (isOpen && import.meta.client) openStack.push(dialogId)
}, { immediate: true })

watch(() => isModalOpen, async (isOpen) => {
    if (isOpen) {
        if (Boolean(trackingTag)) {
            trackEvent(`dialog_view_${trackingTag}`);
        }
        previouslyFocused = document.activeElement
        // Focus initial : premier focusable du dialogue (le bouton fermer
        // en pratique) — annoncé comme dialogue par aria-modal.
        await nextTick()
        const root = bodyEl.value
        const first = root?.querySelector(FOCUSABLE)
        ;(first || root)?.focus?.()
    } else if (previouslyFocused?.focus) {
        previouslyFocused.focus()
        previouslyFocused = null
    }
});

const handleKeydown = (event) => {
    if (event.key === 'Escape' && isModalOpen && openStack[openStack.length - 1] === dialogId) {
        event.preventDefault()
        closeModal();
    }
}

onMounted(() => {
    document.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
    leaveStack()
    document.removeEventListener('keydown', handleKeydown);
    if (holdsLock) {
        releaseScrollLock()
        holdsLock = false
    }
});
</script>

<style lang="scss" scoped>
.modal {
    // 3.1.4 : la police mono héritée produisait des dialogues « code » —
    // la typo vient désormais du contenu (résultat, auth…).
    font-size: var(--fs-14);
    line-height: 1.4;
    display: flex;
    align-items: center;
    justify-content: center;
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 5;

    &__background {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        left: 0;
        background-color: var(--label-tertiary);

        // Opt-in (backdrop="dim") : la page reste lisible derrière un voile
        // sombre translucide, avec un léger flou là où le navigateur le sait.
        &--dim {
            background-color: rgba(15, 23, 42, 0.55);

            @supports (backdrop-filter: blur(1px)) {
                backdrop-filter: blur(3px);
            }
        }
    }

    &__body {
        position: relative;
        z-index: 1;
        background-color: var(--background-primary);
        border-radius: var(--radius-l);
        max-height: 94vh;
        max-width: 94vw;

        /* U3 passe 2 : plein ecran a 24 px. */
        &--full {
            max-height: none;
            max-width: none;
            width: calc(100vw - 48px);
            height: calc(100vh - 48px);
            display: flex;
            flex-direction: column;
        }
    }
}

.modal-body {
    overflow: auto;

    // Croix collante : la boîte défile (overflow: auto), une croix en
    // position absolue partait avec le contenu et sortait de l'écran dès
    // que la fenêtre s'ouvrait défilée (téléphone, offre Pro). Collée en
    // haut de la zone visible, à droite, sans prendre de place dans le flux
    // (marge basse négative = 8,5 px de haut + 30 px du bouton), elle reste
    // exactement où l'ancienne croix se trouvait en haut de boîte.
    &__close {
        position: sticky;
        top: 8.5px;
        z-index: 2;
        flex-shrink: 0;
        margin: 8.5px 8.5px -38.5px auto;
    }
}
</style>
