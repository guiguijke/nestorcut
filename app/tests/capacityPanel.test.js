import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { addSheetsPlan, capacityPanelModel, declaredSheetCount, exceedsMaxSheets } from '../utils/capacityPanel'
import { MAX_SHEETS_PER_JOB } from '../../shared/constants/payment.constants'

// Les SFC (CapacityPanel.vue, [slug].vue) ne se montent pas sous vitest (pas de
// harnais navigateur dans ce dépôt) : le câblage du lot V1 se verrouille par
// lecture du texte, comme plansSheetRule.test.js.
const source = (rel) => fs.readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8')

// Z1 (vérif 2026-09-05) : le refus capacité doit AFFICHER les trois leviers
// chiffrés et les actions « Ajouter une tôle » / « Réduire l'espacement » —
// la capture ne montrait qu'une ligne générique.
describe('capacityPanelModel', () => {
    const unfit = {
        reason: 'capacity',
        ratio: 0.92,
        sheetsNeeded: 2,
        maxPartsAtSpacing: 924,
        maxSpacingForFitMm: 2.1,
    }

    it('expose les trois leviers du cas propriétaire', () => {
        const m = capacityPanelModel(unfit, { sheets: [], spaceMm: 4 })
        expect(m.levers.sheetsNeeded).toBe(2)
        expect(m.levers.maxParts).toBe(924)
        expect(m.levers.maxSpacingMm).toBe(2.1)
    })

    it('« Ajouter une tôle » incrémente le compte du premier format actif', () => {
        const sheets = [
            { width: '1000', height: '2000', count: '1' },
            { width: '1500', height: '3000', count: '0' },
        ]
        const m = capacityPanelModel(unfit, { sheets, spaceMm: 4 })
        expect(m.addSheets).toBe(1)
        expect(m.nextSheets[0].count).toBe('2')
        expect(m.nextSheets[1].count).toBe('0')
    })

    // d7 (02/11) : k = max(1, ceil(sheetsNeeded) − déclaré), en une fois.
    describe('« Ajouter environ k tôles » (d7)', () => {
        const one = (count) => [{ width: '1000', height: '2000', count }]

        it('cas mesuré en prod : 1 tôle déclarée, 5 nécessaires → k = 4, count 5', () => {
            const m = capacityPanelModel({ ...unfit, sheetsNeeded: 5 }, { sheets: one('1'), spaceMm: 4 })
            expect(m.addSheets).toBe(4)
            expect(m.nextSheets[0].count).toBe('5')
        })

        it('deux formats à 1, 3 nécessaires → k = 1 sur le premier format', () => {
            const sheets = [
                { width: '1000', height: '2000', count: '1' },
                { width: '1500', height: '3000', count: '1' },
            ]
            const m = capacityPanelModel({ ...unfit, sheetsNeeded: 3 }, { sheets, spaceMm: 4 })
            expect(m.addSheets).toBe(1)
            expect(m.nextSheets[0].count).toBe('2')
            expect(m.nextSheets[1].count).toBe('1')
        })

        it('besoin fractionnaire : ceil avant la soustraction (2,3 → 3, déclaré 1 → k = 2)', () => {
            const m = capacityPanelModel({ ...unfit, sheetsNeeded: 2.3 }, { sheets: one('1'), spaceMm: 4 })
            expect(m.addSheets).toBe(2)
            expect(m.nextSheets[0].count).toBe('3')
        })

        it('résultat partiel : besoin ≤ déclaré → au moins une tôle (max(1, …))', () => {
            const sheets = [
                { width: '1000', height: '2000', count: '1' },
                { width: '1500', height: '3000', count: '1' },
            ]
            const m = capacityPanelModel({ reason: 'partial', sheetsNeeded: 1, unplaced: 4 }, { sheets, spaceMm: 4 })
            expect(m.addSheets).toBe(1)
            expect(m.nextSheets[0].count).toBe('2')
        })

        it('strip : sans sheetsNeeded, k = 1', () => {
            const m = capacityPanelModel(
                { reason: 'strip', maxSpacingForFitMm: 1.2 },
                { sheets: one('3'), spaceMm: 4 },
            )
            expect(m.levers.sheetsNeeded).toBeNull()
            expect(m.addSheets).toBe(1)
            expect(m.nextSheets[0].count).toBe('4')
        })

        it("un format à count '0' n'est pas compté (déclaré 1, pas 2)", () => {
            const sheets = [
                { width: '1000', height: '2000', count: '0' },
                { width: '1500', height: '3000', count: '1' },
            ]
            // Besoin 3, déclaré 1 (le format à 0 ne compte pas) → k = 2, sur le premier format ACTIF.
            const m = capacityPanelModel({ ...unfit, sheetsNeeded: 3 }, { sheets, spaceMm: 4 })
            expect(m.addSheets).toBe(2)
            expect(m.nextSheets[0].count).toBe('0')
            expect(m.nextSheets[1].count).toBe('3')
        })

        it('borne technique : 999 déclarées, besoin 1005 → bouton masqué', () => {
            const m = capacityPanelModel({ ...unfit, sheetsNeeded: 1005 }, { sheets: one('999'), spaceMm: 4 })
            expect(m.nextSheets).toBeNull()
            expect(m.addSheets).toBeNull()
            // Les leviers chiffrés restent affichés.
            expect(m.levers.sheetsNeeded).toBe(1005)
        })

        it('borne technique : pile 1000 après ajout reste proposé', () => {
            const m = capacityPanelModel({ ...unfit, sheetsNeeded: 1000 }, { sheets: one('996'), spaceMm: 4 })
            expect(m.addSheets).toBe(4)
            expect(m.nextSheets[0].count).toBe('1000')
        })

        it('aucun format actif → pas de bouton', () => {
            const m = capacityPanelModel(unfit, { sheets: one('0'), spaceMm: 4 })
            expect(m.nextSheets).toBeNull()
            expect(m.addSheets).toBeNull()
            expect(capacityPanelModel(unfit, { sheets: [], spaceMm: 4 }).addSheets).toBeNull()
        })

        it("n'altère pas les réglages d'entrée", () => {
            const sheets = one('1')
            capacityPanelModel({ ...unfit, sheetsNeeded: 5 }, { sheets, spaceMm: 4 })
            expect(sheets[0].count).toBe('1')
        })
    })

    describe('declaredSheetCount / exceedsMaxSheets / addSheetsPlan', () => {
        it('declaredSheetCount : somme des count > 0, entiers tronqués', () => {
            expect(declaredSheetCount([{ count: '2' }, { count: 3 }, { count: '0' }])).toBe(5)
            expect(declaredSheetCount([{ count: '2.9' }, { count: 'abc' }, { count: '-4' }, {}])).toBe(2)
            expect(declaredSheetCount([])).toBe(0)
            expect(declaredSheetCount(null)).toBe(0)
        })

        it('exceedsMaxSheets : 1000 passe, 1001 dépasse (borne = MAX_SHEETS_PER_JOB)', () => {
            expect(MAX_SHEETS_PER_JOB).toBe(1000)
            expect(exceedsMaxSheets([{ count: '1000' }])).toBe(false)
            expect(exceedsMaxSheets([{ count: '1001' }])).toBe(true)
            // La somme porte sur tous les formats, pas sur chacun.
            expect(exceedsMaxSheets([{ count: '600' }, { count: '401' }])).toBe(true)
            expect(exceedsMaxSheets([{ count: '600' }, { count: '400' }])).toBe(false)
            expect(exceedsMaxSheets([{ count: '5' }], 4)).toBe(true)
        })

        it('addSheetsPlan : max explicite et entrées dégénérées', () => {
            expect(addSheetsPlan({ sheetsNeeded: 5 }, [{ count: '1' }], 4)).toBeNull()
            expect(addSheetsPlan({ sheetsNeeded: 5 }, [{ count: '1' }], 5).k).toBe(4)
            expect(addSheetsPlan(null, [{ count: '2' }]).k).toBe(1)
            expect(addSheetsPlan({ sheetsNeeded: 'x' }, [{ count: '2' }]).k).toBe(1)
            expect(addSheetsPlan({ sheetsNeeded: 5 }, undefined)).toBeNull()
        })
    })

    it("« Réduire l'espacement » ne s'affiche que si elle abaisse le réglage courant", () => {
        expect(capacityPanelModel(unfit, { sheets: [], spaceMm: 4 }).reduceSpacingToMm).toBe(2.1)
        expect(capacityPanelModel(unfit, { sheets: [], spaceMm: 2 }).reduceSpacingToMm).toBeNull()
        expect(capacityPanelModel(unfit, { sheets: [], spaceMm: null }).reduceSpacingToMm).toBeNull()
    })

    it('solution partielle : unplaced sans leviers reste affichable', () => {
        const m = capacityPanelModel({ reason: 'partial', unplaced: 18 }, { sheets: [], spaceMm: 4 })
        expect(m.unplaced).toBe(18)
        expect(m.levers.sheetsNeeded).toBeNull()
    })

    it('payload vide → pas de bandeau', () => {
        expect(capacityPanelModel(null, {})).toBeNull()
        expect(capacityPanelModel({}, {})).toBeNull()
        expect(capacityPanelModel({ reason: 'capacity' }, {})).toBeNull()
    })

    // C04 (lot 3) : levier « réduire l'espacement » MASQUÉ sous 0,5 mm —
    // plus de bouton illusoire, la phrase « même sans espacement » prend
    // le relais (noSpacingGain).
    it('masque le levier et pose noSpacingGain quand space ≤ 0,5 mm', () => {
        const m = capacityPanelModel(unfit, { sheets: [], spaceMm: 0.3 })
        expect(m.reduceSpacingToMm).toBeNull()
        expect(m.noSpacingGain).toBe(true)
        // Le levier chiffré reste affiché (information utile).
        expect(m.levers.maxSpacingMm).toBe(2.1)
    })

    it('kerf explicite : cible ≤ kerf → levier masqué (on ne coupe pas dans l’outil)', () => {
        const m = capacityPanelModel(unfit, { sheets: [], spaceMm: 4, kerfMm: 2.5 })
        expect(m.reduceSpacingToMm).toBeNull()
        expect(m.noSpacingGain).toBe(true)
        // Cible au-dessus du kerf → levier visible.
        const ok = capacityPanelModel(unfit, { sheets: [], spaceMm: 4, kerfMm: 1 })
        expect(ok.reduceSpacingToMm).toBe(2.1)
        expect(ok.noSpacingGain).toBeFalsy()
    })

    it('espacement confortable : pas de phrase plancher', () => {
        const m = capacityPanelModel(unfit, { sheets: [], spaceMm: 4 })
        expect(m.noSpacingGain).toBeFalsy()
    })
})

// Lot V1 (02/11) — câblage des trois fichiers de WP-PROJET, par lecture du texte.
describe('câblage statique du lot V1 (capacité, borne technique, information Free)', () => {
    const panelVue = source('app/components/CapacityPanel.vue')
    const slugVue = source('app/pages/project/[slug].vue')
    const filesJs = source('app/composables/files.js')

    it('plus aucun vestige du plafond Free de 2 tôles par job (O1)', () => {
        const dead = /sheetCapHint|sheet_cap_exceeded|sheetCapError|sheetCapExceeded|sheetCapServerError|nest\.error\.sheetCap/
        expect(panelVue).not.toMatch(dead)
        expect(slugVue).not.toMatch(dead)
        expect(filesJs).not.toMatch(dead)
        // L'ancienne clé singulier est remplacée par report.unfit.addSheets.one|other.
        expect(panelVue).not.toMatch(/report\.unfit\.addSheet['"]/)
    })

    it('CapacityPanel : testid existants conservés, bouton paramétré par k, mode « ouvrir le projet »', () => {
        for (const id of ['capacity-panel', 'capacity-add-sheet', 'capacity-reduce-spacing', 'capacity-retry']) {
            expect(panelVue).toContain(`data-testid="${id}"`)
        }
        expect(panelVue).toContain('capacity-panel__levers')
        // k lu par le harnais sur l'attribut ; libellé au pluriel selon k (D9).
        expect(panelVue).toContain(':data-add-sheets="panel.addSheets ?? 1"')
        expect(panelVue).toContain("tp('report.unfit.addSheets', panel.addSheets ?? 1)")
        // D12 : un seul bouton hors du projet du job ; D26 : note sans bouton.
        expect(panelVue).toContain('data-testid="capacity-open-project"')
        expect(panelVue).toContain('data-testid="capacity-free-note"')
        expect(panelVue).toMatch(/openProject:\s*\{\s*type:\s*Boolean,\s*default:\s*false/)
        expect(panelVue).toMatch(/freeNote:\s*\{\s*type:\s*String,\s*default:\s*''/)
        expect(panelVue).toContain("'open-project'")
        // Les boutons d'ajout et de réduction disparaissent quand openProject est vrai.
        expect(panelVue).toMatch(/v-if="!openProject && panel\.nextSheets"/)
        expect(panelVue).toMatch(/v-if="!openProject && panel\.reduceSpacingToMm != null"/)
    })

    it('files.js : 400 too_many_sheets, miroir de la borne, 402 string-safe avec contexte', () => {
        expect(filesJs).toMatch(/statusMessage === 'too_many_sheets'/)
        expect(filesJs).toContain("state.nestError = 'nest.error.maxSheets'")
        expect(filesJs).toContain('sheetCountTooHigh: computed(() => exceedsMaxSheets(normalizedSheets(state.params)))')
        // AGENTS #29 : jamais `=== true` sur le flag runtime (il arrive en chaîne).
        expect(filesJs).toContain('flagOn(useRuntimeConfig().public.paidPlansDisabled)')
        expect(filesJs).not.toMatch(/paidPlansDisabled\s*===\s*true/)
        expect(filesJs).toContain("useBuyCreditsContext().value = { source: 'quota' }")
    })

    it('[slug].vue : borne grise Nest, information D26, relance après ajout, demandes de la fenêtre', () => {
        expect(slugVue).toContain('data-testid="max-sheets-error"')
        expect(slugVue).toContain('unref(sheetCountTooHigh)')
        expect(slugVue).toContain('data-testid="free-download-note"')
        expect(slugVue).toContain(':free-note="capacityFreeNote"')
        // k du panneau, trace, puis relance après nextTick (D11).
        expect(slugVue).toMatch(/const onCapacityAddSheet = async \(\) =>/)
        expect(slugVue).toContain("trackEvent('capacity_add_sheets_click'")
        expect(slugVue).toMatch(/await nextTick\(\);\s*startsNest\(\);/)
        // La fenêtre de résultat n'écrit pas les réglages : la page applique ses demandes.
        expect(slugVue).toContain('useCapacityActionRequest()')
        expect(slugVue).toContain("req.action === 'add_sheets'")
        expect(slugVue).toContain("req.action === 'reduce_spacing'")
        expect(slugVue).toContain('applyReduceSpacing(')
        // La réduction passe par la sécurité (kerf intact), jamais par `space` brut.
        expect(slugVue).toContain('actions.updateKerfSafety(')
        expect(slugVue).not.toMatch(/updateParams\(\{\s*space/)
        // K et démo transmis explicitement au calcul de l'état (D3).
        expect(slugVue).toContain('paidPlansDisabled: config.public.paidPlansDisabled')
        expect(slugVue).toContain('projectSlug: unref(pageSlug)')
    })
})
