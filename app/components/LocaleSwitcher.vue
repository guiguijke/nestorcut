<template>
    <!-- Lot L0 (plan des langues §2.1) : le commutateur EN|FR devient un
         MENU DE LANGUES — chaque langue y porte son NOM DANS SA LANGUE
         (c'est la seule chose qu'un visiteur non polyglotte y lit sûr).
         La liste vient du registre : une langue nouvelle y apparaît en
         ajoutant son dictionnaire — APRÈS que le verrou de parité est
         vert, sinon le lot ne passe pas. -->
    <div ref="rootEl" class="lang">
        <button
            type="button"
            class="lang__trigger"
            :aria-label="t('nav.language')"
            :aria-expanded="String(open)"
            aria-haspopup="listbox"
            data-testid="locale-menu-trigger"
            @click="open = !open"
        >
            <span class="lang__current" :lang="locale">{{ currentLabel }}</span>
            <span class="lang__caret" aria-hidden="true">▾</span>
        </button>
        <ul
            v-if="open"
            class="lang__menu"
            role="listbox"
            :aria-label="t('nav.language')"
            data-testid="locale-menu"
        >
            <li v-for="code in LOCALES" :key="code" role="option" :aria-selected="String(code === locale)">
                <button
                    type="button"
                    class="lang__opt"
                    :class="{ 'lang__opt--current': code === locale }"
                    :lang="code"
                    @click="choose(code)"
                >
                    {{ label(code) }}
                    <span v-if="code === locale" class="lang__check" aria-hidden="true">✓</span>
                </button>
            </li>
        </ul>
    </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { LOCALES, LANGUAGE_LABELS, translate } from '~/utils/i18n'

const { locale, setLocale } = useLocale()

const open = ref(false)
const rootEl = ref(null)

const t = (key) => translate(key, locale.value)
const label = (code) => LANGUAGE_LABELS[code] || code
const currentLabel = computed(() => label(locale.value))

function choose(code) {
    setLocale(code)
    open.value = false
}

function onDocClick(e) {
    if (rootEl.value && !rootEl.value.contains(e.target)) open.value = false
}
function onKey(e) {
    if (e.key === 'Escape') open.value = false
}
onMounted(() => {
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onKey)
})
onUnmounted(() => {
    document.removeEventListener('click', onDocClick)
    document.removeEventListener('keydown', onKey)
})
</script>

<style lang="scss" scoped>
.lang {
    position: relative;
    font-size: var(--fs-13, 13px);

    &__trigger {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 30px;
        padding: 0 var(--sp-3);
        border-radius: var(--radius, 8px);
        border: 1px solid var(--separator-secondary);
        background: var(--background-primary);
        color: var(--label-primary);
        cursor: pointer;
    }

    &__caret {
        font-size: 9px;
        opacity: 0.6;
    }

    &__menu {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        z-index: 60;
        min-width: 150px;
        margin: 0;
        padding: 4px;
        list-style: none;
        border-radius: var(--radius-l, 12px);
        border: 1px solid var(--separator-secondary);
        background: var(--background-primary);
        box-shadow: 0 8px 24px color-mix(in srgb, var(--label-primary) 12%, transparent);
    }

    &__opt {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        width: 100%;
        padding: 7px 10px;
        border: none;
        border-radius: var(--radius, 8px);
        background: none;
        color: var(--label-primary);
        font: inherit;
        cursor: pointer;

        &:hover {
            background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
        }

        &--current {
            color: var(--accent-primary);
            font-weight: 600;
        }
    }

    &__check {
        font-size: 11px;
    }
}
</style>
