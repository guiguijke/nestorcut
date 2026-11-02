import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// O2 / D18 (02/11) : la page /plans énonce la règle de téléchargement Free
// (« les {n} premières tôles ») à partir de la constante partagée, et chaque
// clic de carte n'est compté qu'une fois. Pas de montage Vue ici : lecture
// texte du fichier, comme les autres verrous de gabarit.

const plans = readFileSync(fileURLToPath(new URL('../pages/plans.vue', import.meta.url)), 'utf8')

describe('app/pages/plans.vue — règle des tôles téléchargeables', () => {
    it('lit la constante partagée, jamais un nombre en dur (AGENTS #34)', () => {
        expect(plans).toContain('FREE_DOWNLOAD_SHEET_CAP')
        expect(plans).toMatch(/FREE_DOWNLOAD_SHEET_CAP,[\s\S]*from '~~\/shared\/constants\/payment\.constants'/)
        expect(plans).not.toMatch(/\{\s*n:\s*2\s*\}/)
    })

    it('carte Free : « autant de tôles que nécessaire » en 3e puce, puis f3 avec {n}', () => {
        expect(plans).toContain('plans.free.allSheets')
        const order = ['plans.free.f1', 'plans.free.f2', 'plans.free.allSheets', 'plans.free.f3', 'plans.free.f4']
        const positions = order.map((key) => plans.indexOf(`'${key}'`))
        for (const position of positions) expect(position).toBeGreaterThan(-1)
        expect([...positions].sort((a, b) => a - b)).toEqual(positions)
        expect(plans).toMatch(/t\('plans\.free\.f3',\s*\{\s*n:\s*FREE_DOWNLOAD_SHEET_CAP\s*\}\)/)
    })

    it('comparatif : ligne « tôles téléchargeables par tâche », après le multi-tôles', () => {
        expect(plans).toContain('plans.compare.sheetDownloads')
        expect(plans.indexOf('plans.compare.sheetDownloads')).toBeGreaterThan(plans.indexOf('plans.compare.multiSheet'))
        expect(plans.indexOf('plans.compare.sheetDownloads')).toBeLessThan(plans.indexOf('plans.compare.heterogeneous'))
        expect(plans).toMatch(/t\('plans\.value\.firstSheets',\s*\{\s*n:\s*FREE_DOWNLOAD_SHEET_CAP\s*\}\)/)
        expect(plans).toContain("t('plans.value.allSheets')")
        // Le calcul multi-tôles reste ouvert aux trois offres.
        expect(plans).toMatch(/plans\.compare\.multiSheet'\),\s*values:\s*\[true, true, true\]/)
    })

    it('le drapeau des offres payantes est lu en chaîne comme en booléen (AGENTS #29)', () => {
        expect(plans).toMatch(/flagOn\(useRuntimeConfig\(\)\.public\.paidPlansDisabled\)/)
        expect(plans).not.toMatch(/paidPlansDisabled\s*===\s*true/)
    })
})

describe('app/pages/plans.vue — un seul émetteur par clic (D18)', () => {
    it('aucun trackingTag sur le MainButton des cartes', () => {
        expect(plans).not.toMatch(/:tracking-?tag/i)
        expect(plans).not.toMatch(/\btracking-?tag=/i)
    })

    it('trackEvent(click_plans_*) reste l’unique émetteur du clic de carte', () => {
        expect(plans).toMatch(/trackEvent\(`click_\$\{tier\.trackingTag\}`,\s*\{\s*page:\s*'plans'\s*\}\)/)
        for (const tag of ['plans_free', 'plans_unlimited', 'plans_pro']) {
            expect(plans).toContain(`trackingTag: '${tag}'`)
        }
    })
})
