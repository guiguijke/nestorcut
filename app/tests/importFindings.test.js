import { describe, expect, it } from 'vitest'

// Lot 2c — les règles de composition des constats d'import (§4 de
// `docs/qa/import-2026-09-09/rapport-reparation.md`) : gravité d'abord,
// trois fragments au plus sur la carte, « et N autres » au-delà, et RIEN
// quand il n'y a rien à dire. Les textes eux-mêmes sont verrouillés par
// leur rendu FR/EN à la fin du fichier.

import {
    composeCardLine,
    composeFindingList,
    findingParams,
    refusalMessage,
    sortFindings,
    worstLevel,
} from '../composables/importFindings'
import { translate } from '../utils/i18n'

const fr = (key, params) => translate(key, 'fr', params)
const en = (key, params) => translate(key, 'en', params)

const f = (code, level, count, extra = {}) => ({ code, level, count, ...extra })

describe('constats d\'import — composition (lot 2c)', () => {
    it('ne dit rien quand il n\'y a rien à dire', () => {
        expect(composeCardLine([], fr)).toBeNull()
        expect(composeCardLine(null, fr)).toBeNull()
        expect(composeFindingList([], fr)).toEqual([])
        // Un fichier avec des constats de FICHE seulement n'allume pas la carte.
        expect(composeCardLine([f('import.unitAssumed', 'info', 1)], fr)).toBeNull()
        expect(composeCardLine([f('import.splinesSampled', 'info', 12)], fr)).toBeNull()
    })

    it('classe par gravité puis par compte décroissant', () => {
        const sorted = sortFindings([
            f('import.splinesSampled', 'info', 99),
            f('import.contoursDropped', 'attention', 3),
            f('import.entitiesSkipped', 'attention', 12),
            f('import.blocksFlattened', 'info', 100),
        ])
        expect(sorted.map((x) => x.code)).toEqual([
            'import.entitiesSkipped',
            'import.contoursDropped',
            'import.blocksFlattened',
            'import.splinesSampled',
        ])
        expect(worstLevel(sorted)).toBe('attention')
        expect(worstLevel([f('import.unitAssumed', 'info', 1)])).toBe('info')
        expect(worstLevel([])).toBeNull()
    })

    it('tient trois fragments sur la carte, puis annonce le reste', () => {
        const findings = [
            f('import.entitiesSkipped', 'attention', 12, { types: ['HATCH', 'SOLID'] }),
            f('import.contoursDropped', 'attention', 1337),
            f('import.partsDropped', 'attention', 2),
            f('import.unitUnknown', 'attention', 1, { value: '7' }),
            f('import.unitConverted', 'info', 1, { value: 'inch' }),
        ]
        const card = composeCardLine(findings, fr)
        expect(card.level).toBe('attention')
        expect(card.hidden).toBe(2)
        // Les trois premiers constats sont là, les deux derniers non (le
        // découpage par « , » ne compte pas : le texte des types en contient).
        expect(card.line).toContain('12 entités non prises en charge')
        expect(card.line).toContain('1337 tracés ouverts')
        expect(card.line).toContain('2 pièces trop petites')
        expect(card.line).not.toContain('$INSUNITS')
        expect(card.line).not.toContain('Unités inch')
        expect(card.line).toContain('et 2 autres')
        // La fiche, elle, montre TOUT — jamais un résumé.
        const list = composeFindingList(findings, fr)
        expect(list).toHaveLength(5)
        expect(list.map((x) => x.level)).toEqual([
            'attention', 'attention', 'attention', 'attention', 'info',
        ])
    })

    it('formate les nombres dans la locale (piège #24)', () => {
        const card = composeCardLine(
            [f('import.contoursDropped', 'attention', 1337)],
            fr,
            (v) => new Intl.NumberFormat('fr-FR').format(v),
        )
        // Le séparateur de milliers FR d'Intl est une espace insécable
        // ÉTROITE (U+202F) : on compare à ce que le formateur rend, pas à
        // une espace ordinaire.
        const grouped = new Intl.NumberFormat('fr-FR').format(1337)
        expect(card.line).toContain(`${grouped} tracés ouverts`)
        expect(card.line).not.toContain('1337')
    })

    it('limite les types à trois sur la carte, tous dans la fiche', () => {
        const finding = f('import.entitiesSkipped', 'attention', 40, {
            types: ['HATCH', 'SOLID', 'REGION', '3DSOLID', 'MLINE'],
        })
        expect(findingParams(finding).types).toBe('HATCH, SOLID, REGION…')
        expect(findingParams(finding, { maxTypes: 0 }).types).toBe(
            'HATCH, SOLID, REGION, 3DSOLID, MLINE',
        )
    })
})

describe('textes des constats (FR et EN)', () => {
    it('dit la perte de matière avec son compte et ses types', () => {
        const finding = f('import.entitiesSkipped', 'attention', 5, { types: ['HATCH', 'REGION'] })
        const p = findingParams(finding)
        expect(fr(finding.code, p)).toBe(
            '5 entités non prises en charge ignorées (HATCH, REGION) — la matière '
            + "qu'elles décrivaient ne sera pas découpée.",
        )
        expect(en(finding.code, p)).toContain('5 unsupported entities skipped (HATCH, REGION)')
    })

    it('dit les tracés ouverts et ce que l\'utilisateur doit en faire', () => {
        const p = findingParams(f('import.contoursDropped', 'attention', 9))
        expect(fr('import.contoursDropped', p)).toBe(
            '9 tracés ouverts ne seront pas découpés — refermez-les dans votre CAO.',
        )
    })

    it('distingue l\'unité inconnue de l\'unité invraisemblable', () => {
        expect(fr('import.unitUnknown', { value: '42' })).toContain('code $INSUNITS 42')
        expect(fr('import.unitUnknown', { value: '42' })).toContain('Vérifiez les dimensions')
        expect(fr('import.unitImplausible', { value: 'km' })).toContain('déclare des km')
        expect(fr('import.unitConverted', { value: 'inch' })).toContain('Unités inch détectées')
    })

    it('aucune clé de constat ne manque dans les deux langues', () => {
        const codes = [
            'import.entitiesSkipped', 'import.annotationsSkipped', 'import.contoursDropped',
            'import.partsDropped', 'import.paperSpaceSkipped', 'import.unitConverted', 'import.unitAssumed',
            'import.unitUnknown', 'import.unitImplausible', 'import.splinesSampled',
            'import.blocksFlattened', 'import.andMore', 'import.findingsTitle',
            'import.serverTooSlow',
        ]
        for (const code of codes) {
            expect(fr(code, {}), `FR manquant : ${code}`).not.toBe(code)
            expect(en(code, {}), `EN manquant : ${code}`).not.toBe(code)
            // Aucun placeholder non remplacé quand les paramètres sont fournis.
            expect(fr(code, { n: 1, types: 'X', value: 'Y', seconds: 20, max: 2 }))
                .not.toMatch(/\{[a-z]+\}/)
        }
    })
})

describe('espace papier écarté', () => {
    it('le constat monte sur la carte, avec son compte', () => {
        const line = composeCardLine([f('import.paperSpaceSkipped', 'attention', 9)], fr)
        expect(line.level).toBe('attention')
        expect(line.line).toContain('9 entités')
        expect(line.line).toContain('espace papier')
    })
})

describe('refus serveur porté jusqu\'à la fiche (constat du vérificateur)', () => {
    it('nomme la cause et ses nombres', () => {
        expect(refusalMessage({ reason: 'entities', entityCount: 12345, maxEntities: 10000 }, fr))
            .toContain('12345 entités')
        const slow = refusalMessage(
            { reason: 'time', entityCount: 787, timeBudgetMs: 60000 }, fr,
        )
        expect(slow).toContain('787 entités')
        expect(slow).toContain('plus de 60 s')
        // Le message du refus de TEMPS côté serveur ne renvoie pas vers le
        // serveur (on y est déjà) : il propose l'appareil.
        expect(slow).toContain('cet appareil')
    })

    it('ne dit rien sans refus', () => {
        expect(refusalMessage(null, fr)).toBeNull()
        expect(refusalMessage({}, fr)).toBeNull()
        expect(refusalMessage({ reason: 'blockDepth' }, fr)).toBeNull()
    })
})

describe('entités non découpées et arcs imbriqués en cordes', () => {
    const uncut = f('import.entitiesUncut', 'attention', 506, { types: ['SPLINE', 'LWPOLYLINE'] })
    const bulges = f('import.bulgesChorded', 'attention', 180, { value: '0.59' })

    it('les entités hors de toute pièce montent sur la carte, avec leur compte et leurs types', () => {
        const card = composeCardLine([uncut], fr)
        expect(card.level).toBe('attention')
        expect(card.line).toContain('506 entité(s)')
        expect(card.line).toContain('SPLINE, LWPOLYLINE')
        expect(card.line).toContain('ne seront pas découpées')
    })

    it('la flèche des arcs imbriqués en cordes reste sur la fiche et se lit dans la locale', () => {
        expect(composeCardLine([bulges], fr)).toBeNull()
        const fmtDecimal = (v) => String(v).replace('.', ',')
        const [item] = composeFindingList([bulges], fr, (v) => String(v), fmtDecimal)
        expect(item.level).toBe('attention')
        expect(item.text).toContain('180 arc(s)')
        expect(item.text).toContain('0,59 mm')
        expect(item.text).toContain('laissez au moins cet espacement')
        expect(composeFindingList([bulges], en)[0].text).toContain('up to 0.59 mm off')
    })

    it('les textes et cotes ignorés disent leurs types sur la fiche, sans passer par la carte', () => {
        const ann = f('import.annotationsSkipped', 'info', 6, { types: ['DIMENSION', 'TEXT'] })
        expect(composeCardLine([ann], fr)).toBeNull()
        expect(composeFindingList([ann], fr)[0].text).toBe(
            'Textes et cotes ignorés (6 entités : DIMENSION, TEXT) — seuls les contours sont découpés.',
        )
    })

    it('les nouvelles clés existent dans les six langues, sans placeholder oublié', () => {
        for (const lg of ['fr', 'en', 'de', 'es', 'it', 'pt']) {
            for (const code of ['import.entitiesUncut', 'import.bulgesChorded', 'import.annotationsSkipped']) {
                const text = translate(code, lg, { n: 1, types: 'X', value: '0,5' })
                expect(text, `${lg} ${code}`).not.toBe(code)
                expect(text).not.toMatch(/\{[a-z]+\}/)
            }
        }
    })
})
