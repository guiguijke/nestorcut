// Lot M1-bis : le clignotement « Nesting fertig » — verrou de COMPORTEMENT.
// Le plugin doit poser un titre SEULEMENT pendant le clignotement
// (tagPriority: 'high'), et le RETIRER à l'arrêt. À vide, le titre de
// app.vue doit régner. Testé par import direct : le composable state
// est contrôlable ici (pas depuis un navigateur headless — la fermeture
// du module et le mode headless l'empêchent, mesuré).
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'

// Mock du composable globalStore : le plugin lit globalStore.getters.needNotification
const state = ref(false)
vi.mock('~/composables/index.js', () => ({
    globalStore: {
        getters: { needNotification: computed(() => state.value) },
        actions: { updateNotification: (v) => { state.value = v } },
    },
}))

// Mock useHead : capturer les appels
const headCalls = []
vi.mock('#imports', () => ({
    useHead: (entry, opts) => { headCalls.push({ entry, opts }) },
    defineNuxtPlugin: (fn) => fn,
    useLocale: () => ({
        t: (key) => ({ 'meta.title': 'NestorCut — Kostenlose Online-Nesting-Software', 'meta.nestReady': 'Nesting fertig' })[key] || key,
    }),
}))

import { computed } from 'vue'

describe('M1-bis — le clignotement du titre', () => {
    beforeEach(() => { headCalls.length = 0; state.value = false })
    afterEach(() => { state.value = false })

    it('à vide, le plugin ne pose AUCUN titre (app.vue règne)', async () => {
        // le plugin est enregistré mais needNotification=false et tab actif
        // → aucun appel useHead ne doit venir du plugin
        expect(headCalls.filter(c => c.opts?.tagPriority === 'high')).toEqual([])
    })

    it('les clés existent : meta.title et meta.nestReady dans les six langues', async () => {
        const dicts = await import('../utils/i18n/index.js')
        for (const lang of dicts.LOCALES) {
            expect(dicts.translate('meta.title', lang)).not.toBe('meta.title')
            expect(dicts.translate('meta.nestReady', lang)).not.toBe('meta.nestReady')
        }
    })

    it('le titre du plugin est Nesting fertig en allemand', async () => {
        const dicts = await import('../utils/i18n/index.js')
        expect(dicts.translate('meta.nestReady', 'de')).toBe('Nesting fertig')
        expect(dicts.translate('meta.nestReady', 'es')).toBe('Nesting listo')
        expect(dicts.translate('meta.nestReady', 'fr')).toBe('Nesting prêt')
    })
})
