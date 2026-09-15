<template>
    <!-- Lot J11-c (§3 point 10-11) : le petit « Nouveau » qui EXPIRE TOUT
         SEUL. Rend tant que aujourd'hui < livréLe + 7 jours, puis rien —
         aucun stockage, la date de livraison du registre décide. Le mot
         est TOUJOURS visible (piège #24 : jamais une pastille sans mot),
         le contraste tient sur les deux thèmes (piège #21). -->
    <span v-if="shown" class="new-badge" data-testid="new-badge">{{ t('common.new') }}</span>
</template>

<script setup>
import { isNewFeature } from '~/utils/whatsNew'

const props = defineProps({
    feature: { type: String, required: true },
    // Injection de « aujourd'hui » pour les VERROUS (J+6 rend, J+8 ne rend
    // plus) — la production laisse le défaut (la vraie date).
    today: { type: [Date, String], default: null },
})

const { t } = useLocale()

const shown = computed(() =>
    isNewFeature(props.feature, props.today ? new Date(props.today) : new Date()))
</script>

<style lang="scss" scoped>
// Couleurs EXPLICITES (piège #21) : lisible sur clair comme sur sombre.
.new-badge {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: var(--fs-12, 12px);
    font-weight: 600;
    color: #0b1220;
    background: #6ea8ff;
    vertical-align: middle;
    line-height: 1.4;
}
</style>
