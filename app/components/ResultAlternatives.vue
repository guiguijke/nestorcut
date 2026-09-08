<!--
    U3 passe 1 (PLAN-UI-PRO §U3) - EXTRACTION PURE de ResultModal.vue.
    Aucun changement de rendu : les blocs de template sont deplaces tels
    quels et les styles qui les visent suivent. Toute la logique reste dans
    l'orchestrateur (ResultModal.vue) : ce composant recoit un objet unique
    et le re-expose sous les memes noms, pour que le template n'ait pas eu
    a etre reecrit. La refonte deux volets est la passe 2.
-->
<template>
            <div
                v-if="alternatives.length > 1 && !isHaveError"
                class="modal__alts alts"
            >
                <button
                    v-for="alt in alternatives"
                    :key="alt.altId"
                    :class="{ 'alts__tab--active': alt.altId === activeAlt }"
                    class="alts__tab"
                    data-testid="alt-tab"
                    :data-active="alt.altId === activeAlt ? 'true' : 'false'"
                    :title="altTitle(alt)"
                    @click="selectAlt(alt.altId)"
                >
                    <span v-if="alt.strategy" class="alts__strategy">{{ strategyLabel(alt.strategy) }}</span>
                    {{ t('result.option', { n: alt.altId + 1 }) }} · {{ altQualityLine(alt) }}
                </button>
            </div>
            <!-- C02 (audit UX 2026-09-05) : pourquoi l'option 1 est
                 proposée en premier. AA1 (vérif L1) : la raison doit être
                 VRAIE — « plus grande chute propre » seulement si la chute
                 du rang 0 est bien maximale, sinon la régularité des
                 rangées. -->
            <p v-if="whyFirstLine" class="alts__why" data-testid="alts-why">
                {{ whyFirstLine }}
            </p>
</template>

<script setup>
const props = defineProps({ d: { type: Object, required: true } })
const emit = defineEmits(['select'])

const t = (...a) => props.d.t(...a)
const alternatives = computed(() => props.d.alternatives)
const isHaveError = computed(() => props.d.isHaveError)
const activeAlt = computed(() => props.d.activeAlt)
const whyFirstLine = computed(() => props.d.whyFirstLine)
const altTitle = (alt) => props.d.altTitle(alt)
const strategyLabel = (s) => props.d.strategyLabel(s)
const altQualityLine = (alt) => props.d.altQualityLine(alt)
const selectAlt = (altId) => emit('select', altId)
</script>

<style lang="scss" scoped>
.alts {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    margin: 0 auto 14px;

    &__strategy {
        padding: 2px 7px;
        border-radius: var(--radius-s);
        background-color: color-mix(in srgb, var(--accent-primary) 14%, transparent);
        color: var(--accent-primary);
        font-size: var(--fs-12);
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    &__tab {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border-radius: var(--radius);
        border: 1px solid var(--separator-secondary);
        background-color: var(--fill-tertiary);
        color: var(--label-secondary);
        font-size: var(--fs-13);
        font-weight: 600;
        cursor: pointer;
        transition: border-color 0.3s, background-color 0.3s;

        @media (hover:hover) {
            &:hover {
                border-color: var(--accent-primary);
            }
        }

        &--active {
            color: var(--background-primary);
            background-color: var(--accent-primary);
            border-color: var(--accent-primary);
        }
    }

    /* C02 (audit UX 2026-09-05) : pourquoi l'option 1 est proposée en
       premier — la Grille (chute propre) ne doit pas paraître « moins
       bonne » que la Compaction. */
    &__why {
        margin: -6px auto 12px;
        font-size: var(--fs-12);
        color: var(--label-tertiary);
        text-align: center;
    }
}
</style>
