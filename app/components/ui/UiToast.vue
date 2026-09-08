<template>
    <!-- U0 : toast unique, aria-live polite, 4 s, usage parcimonieux
         (copie, téléchargement lancé, préférence enregistrée). -->
    <Teleport to="body">
        <div
            v-if="toast.text"
            class="ui-toast"
            role="status"
            aria-live="polite"
        >
            <UiIcon :name="toast.icon || 'check'" :size="16" />
            <span>{{ toast.text }}</span>
        </div>
    </Teleport>
</template>

<script setup>
// État partagé module : useToast() depuis n'importe où.
const toast = useState('ui-toast', () => ({ text: '', icon: '' }))
let timer = null
onUnmounted(() => clearTimeout(timer))
watch(() => toast.value.text, (t) => {
    clearTimeout(timer)
    if (t) {
        timer = setTimeout(() => { toast.value = { text: '', icon: '' } }, 4000)
    }
})
</script>

<style lang="scss" scoped>
.ui-toast {
    position: fixed;
    bottom: var(--sp-5);
    left: 50%;
    transform: translateX(-50%);
    z-index: var(--z-toast);
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-4);
    background: var(--text);
    color: var(--bg);
    border-radius: var(--radius);
    box-shadow: var(--shadow-l);
    font-size: var(--fs-13);
    font-weight: 600;
    animation: ui-toast-in 0.2s ease-out;
}
@keyframes ui-toast-in {
    from { opacity: 0; transform: translate(-50%, var(--sp-2)); }
    to { opacity: 1; transform: translate(-50%, 0); }
}
</style>
