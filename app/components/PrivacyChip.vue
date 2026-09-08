<template>
    <!-- U1 passe 2 (retouche 1) : chip de mode privé = UiBadge discret —
         rayon 2 px, casse normale, contour --border-strong + point coloré :
         gris neutre pour « Cet appareil » / cloud / coffre, info pour
         « Démo ». Les couleurs d'état restent réservées aux résultats.
         Les classes chip/chip--{mode} restent (sélecteurs QA
         privacy-ui-check). -->
    <UiBadge :tone="chipTone" dot :class="`chip chip--${mode}`">{{ label }}</UiBadge>
</template>

<script setup>
import { PRIVACY_CHIP_KEY } from '~/utils/privacyMode'

const props = defineProps({
    mode: {
        type: String,
        required: true,
        validator: (v) => ['demo', 'device', 'cloud', 'vault'].includes(v),
    },
})

const { t } = useLocale()
const label = computed(() => t(PRIVACY_CHIP_KEY[props.mode]))
const chipTone = computed(() => (props.mode === 'demo' ? 'info' : 'neutral'))
</script>
