import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { reactive, ref } from 'vue'
import { translate } from '../utils/i18n'
import { mountSfc, passthrough } from './helpers/mountSfc'

// La vue en direct MONTÉE, pour un calcul sur l'appareil dont toutes les pièces ne
// tiennent pas : rien de dessiné avant PARTIAL_DELAY_SEC, puis la meilleure
// disposition partielle avec « n sur m pièces posées » et le badge « Recherche… »,
// sans densité ni nombre de tôles ; dès qu'une disposition tient, la vue d'avant.

const file = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const SQUARE = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
const PARTS = Array.from({ length: 7 }, () => ({ coordinates: SQUARE }))
const itemMap = PARTS.map((_, id) => ({ id, slug: 'f', part: id }))
const wait = (ms) => new Promise((done) => setTimeout(done, ms))
const SETTLE_MS = 400 // le champion se pose après 150 ms

// Frame BPP du moteur : `ids` = pièces posées, `unplaced` = pièces restantes.
const frame = (ids, over = {}) => ({
    worker: 0, stage: 'bpp-search', feasible: false, isSpp: false, bins: 1, unplaced: 7 - ids.length,
    remnant: 0.3, density: 0.31, sheets: [[1000, 1000]], bias: 'left',
    items: ids.map((id) => [id, 0, 0, id * 20, 5]), ...over,
})

async function mount({ liveLayout, elapsed = 12, localCompute = true, partialTotal = 7, locale = 'en' }) {
    const props = reactive({
        result: { slug: 'job-1', itemMap, liveLayout, progress: { elapsed_sec: elapsed }, compute: { vcores: 4 } },
        localCompute,
        partialTotal,
    })
    const view = await mountSfc(file('../components/LiveNestingView.vue'), {
        props,
        modules: { '~/composables/localFilesStore': { getLocalFile: async () => ({ parts: PARTS }) } },
        components: { UiStat: file('../components/ui/UiStat.vue'), CoresSpinner: passthrough, SheetAxes: passthrough },
        globals: {
            useLocale: () => ({
                locale: ref(locale),
                t: (key, params) => translate(key, locale, params),
                fmtPercent: (v) => `${Number(v).toFixed(1)} %`,
            }),
            useUnit: () => ({ fmtLength: (mm) => `${mm} mm` }),
            $fetch: async () => ({ parts: PARTS }),
        },
    })
    const set = async (liveLayout, elapsed = props.result.progress.elapsed_sec) => {
        props.result = { ...props.result, liveLayout, progress: { elapsed_sec: elapsed } }
        await wait(SETTLE_MS)
    }
    await wait(SETTLE_MS)
    return { view, props, set, drawn: () => view.byClass('live__part').length }
}

const badge = (view) => view.byClass('live__badge')[0]
const partialLine = (view) => view.byTestId('live-partial')

describe('vue en direct : disposition partielle (calcul sur l’appareil)', () => {
    it('avant le délai : le message d’attente comme avant, rien d’autre', async () => {
        const { view, drawn } = await mount({ liveLayout: frame([0, 1, 2]), elapsed: 5 })
        expect(view.text()).toContain(translate('live.waiting', 'en'))
        expect(drawn()).toBe(0)
        expect(partialLine(view)).toBeNull()
        expect(badge(view)).toBeUndefined()
        expect(view.byTestId('live-stat-density')).toBeNull()
        expect(view.byTestId('live-stat-sheets')).toBeNull()
    })

    it('après le délai : la meilleure disposition, « 3 sur 7 », badge Recherche, ni densité ni tôles', async () => {
        const { view, drawn } = await mount({ liveLayout: frame([0, 1, 2]) })
        expect(drawn()).toBe(3)
        expect(view.text()).not.toContain(translate('live.waiting', 'en'))
        expect(view.textOf(partialLine(view))).toBe('Best so far: 3 of 7 parts placed')
        expect(view.textOf(badge(view))).toBe(translate('live.searching', 'en'))
        expect(badge(view).props.class).not.toContain('live__badge--ok')
        expect(view.byTestId('live-stat-density')).toBeNull()
        expect(view.byTestId('live-stat-sheets')).toBeNull()
        expect(view.byTestId('live-stat-length')).toBeNull()
    })

    it('le texte avance avec la frame : moins de pièces non posées gagne, une pire ne le défait pas', async () => {
        const { view, set, drawn } = await mount({ liveLayout: frame([0, 1, 2]) })
        await set(frame([0, 1, 2, 3, 4]))
        expect(view.textOf(partialLine(view))).toBe('Best so far: 5 of 7 parts placed')
        expect(drawn()).toBe(5)
        await set(frame([0, 1], { bins: 1, remnant: 0.9 }))
        expect(view.textOf(partialLine(view))).toBe('Best so far: 5 of 7 parts placed')
    })

    it('total inconnu : la disposition est dessinée, aucune ligne', async () => {
        const { view, drawn } = await mount({ liveLayout: frame([0, 1, 2]), partialTotal: null })
        expect(drawn()).toBe(3)
        expect(partialLine(view)).toBeNull()
    })

    it('la ligne suit la langue de la page', async () => {
        const { view } = await mount({ liveLayout: frame([0, 1, 2]), locale: 'fr' })
        // textOf ramène les espaces insécables du français à des espaces simples
        expect(view.textOf(partialLine(view))).toBe(translate('live.partial', 'fr', { placed: 3, total: 7 }).replaceAll(' ', ' '))
    })

    it('résultat d’un job serveur (pas un calcul sur l’appareil) : le message d’attente, jamais la partielle', async () => {
        const { view, drawn } = await mount({ liveLayout: frame([0, 1, 2]), localCompute: false })
        expect(drawn()).toBe(0)
        expect(partialLine(view)).toBeNull()
        expect(view.text()).toContain(translate('live.waiting', 'en'))
    })

    it('une frame SPP qui ne tient pas n’est jamais dessinée (collisions possibles)', async () => {
        const sppFrame = {
            worker: 0, stage: 'sep', feasible: false, isSpp: true, strip_width: 900, density: 0.4, sheets: [[1000, 1000]],
            items: [[0, 0, 5, 5], [1, 0, 30, 5]], unplaced: 3,
        }
        const { view, drawn } = await mount({ liveLayout: sppFrame })
        expect(drawn()).toBe(0)
        expect(view.text()).toContain(translate('live.waiting', 'en'))
        expect(partialLine(view)).toBeNull()
        expect(badge(view)).toBeUndefined()
    })

    it('rien de dessiné : l’en-tête ne reprend ni densité ni tôles de la frame non dessinée', async () => {
        const { view } = await mount({ liveLayout: frame([0, 1, 2]), elapsed: 3 })
        expect(view.byTestId('live-stat-density')).toBeNull()
        expect(view.byTestId('live-stat-sheets')).toBeNull()
    })

    it('dès qu’une disposition tient : la vue d’avant, et elle le reste', async () => {
        const { view, set, drawn } = await mount({ liveLayout: frame([0, 1, 2]) })
        expect(partialLine(view)).not.toBeNull()
        await set(frame([0, 1, 2, 3, 4, 5, 6], { feasible: true, unplaced: 0, bins: 2, density: 0.58 }))
        expect(partialLine(view)).toBeNull()
        expect(drawn()).toBe(7)
        expect(view.textOf(badge(view))).toBe(translate('live.fitsSheet', 'en'))
        expect(view.textOf(view.byTestId('live-stat-density'))).toContain('58.0 %')
        expect(view.textOf(view.byTestId('live-stat-sheets'))).toContain('2')
        // une frame partielle plus tardive (autre walk) ne ramène pas la partielle
        await set(frame([0, 1], { worker: 1 }))
        expect(partialLine(view)).toBeNull()
        expect(drawn()).toBe(7)
        expect(view.textOf(view.byTestId('live-stat-density'))).toContain('58.0 %')
    })

    it('une frame qui tient avant le délai : la partielle n’apparaît jamais', async () => {
        const { view, set } = await mount({ liveLayout: frame([0, 1, 2]), elapsed: 3 })
        await set(frame([0, 1, 2, 3, 4, 5, 6], { feasible: true, unplaced: 0 }), 4)
        await set(frame([0, 1]), 20)
        expect(partialLine(view)).toBeNull()
        expect(view.textOf(badge(view))).toBe(translate('live.fitsSheet', 'en'))
    })
})
