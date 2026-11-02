<template>
    <DialogWrapper trackingTag="subscription">
        <div class="modal">
            <Subscription :context="context" />
        </div>
    </DialogWrapper>
</template>

<script setup>
// D13 : le contexte (pourquoi la fenêtre s'ouvre) est posé par l'ouvreur
// (useBuyCreditsOpener) et VIDÉ à la fermeture, pour qu'une ouverture
// ultérieure sans contexte (profil, bannière) ne montre jamais l'ancien.
// Ni defineProps ni defineEmits : le v-model:isModalOpen du layout doit
// continuer à tomber sur le DialogWrapper racine (attributs hérités).
const open = useBuyCreditsDialog()
const context = useBuyCreditsContext()
watch(open, (isOpen) => {
    if (!isOpen) context.value = null
})
</script>

<style lang="scss" scoped>
    .modal {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 12px;
    }
</style>
