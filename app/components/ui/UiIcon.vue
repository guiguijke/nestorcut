<template>
    <!-- U0 : sprite inline — 24 icônes, zéro dépendance,currentColor. -->
    <svg
        :width="size"
        :height="size"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        class="ui-icon"
    >
        <path v-for="(d, i) in paths" :key="i" :d="d" />
    </svg>
</template>

<script setup>
// Chemins Lucide (ISC) redessinés inline — aucune dépendance npm.
const ICONS = {
    close: ['M18 6 6 18', 'M6 6l12 12'],
    check: ['M20 6 9 17l-5-5'],
    copy: ['M9 9h10v12H9z', 'M5 15H3V3h12v2'],
    download: ['M12 3v12', 'M7 10l5 5 5-5', 'M4 21h16'],
    upload: ['M12 21V9', 'M7 14l5-5 5 5', 'M4 3h16'],
    sheet: ['M3 3h18v18H3z', 'M3 9h18', 'M9 3v18'],
    layers: ['M12 2 2 7l10 5 10-5z', 'M2 17l10 5 10-5', 'M2 12l10 5 10-5'],
    arrowLeft: ['M19 12H5', 'M12 19l-7-7 7-7'],
    arrowRight: ['M5 12h14', 'M12 5l7 7-7 7'],
    arrowUp: ['M12 19V5', 'M5 12l7-7 7 7'],
    arrowDown: ['M12 5v14', 'M19 12l-7 7-7-7'],
    plus: ['M12 5v14', 'M5 12h14'],
    minus: ['M5 12h14'],
    search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M21 21l-4.3-4.3'],
    settings: ['M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5A7 7 0 0 0 19 12z'],
    user: ['M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M4 21a8 8 0 0 1 16 0'],
    logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
    info: ['M12 8h.01', 'M12 12v4', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z'],
    alert: ['M12 9v4', 'M12 17h.01', 'M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'],
    shield: ['M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6z'],
    scissors: ['M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M20 4 8.1 15.9', 'M14.5 14.5 20 20', 'M8.1 8.1 12 12'],
    file: ['M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z', 'M14 3v6h6'],
    clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7v5l3 3'],
    sun: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M12 2v2', 'M12 20v2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M2 12h2', 'M20 12h2', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4'],
    moon: ['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'],
    cpu: ['M6 6h12v12H6z', 'M9 2v2', 'M15 2v2', 'M9 18v2', 'M15 18v2', 'M2 9h2', 'M2 15h2', 'M20 9h2', 'M20 15h2'],
}
const props = defineProps({
    name: { type: String, required: true },
    size: { type: [Number, String], default: 16 },
})
const paths = computed(() => ICONS[props.name] || ICONS.info)
</script>

<style scoped>
.ui-icon { flex-shrink: 0; display: inline-block; }
</style>
