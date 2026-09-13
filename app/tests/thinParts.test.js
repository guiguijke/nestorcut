/**
 * Verrous du lot E2 — le constat « pièces plus fines que l'espacement ».
 *
 * La chaîne mesurée : ids rendus par le moteur (`thin_items`, lot E0) →
 * itemMap → `{slug, part}` → une ligne qui nomme trois pièces au plus puis
 * compte le reste, en FR et EN. Le moteur LIVRE ces jobs : c'est un constat,
 * jamais une erreur.
 */
import { describe, expect, it } from 'vitest'
import { thinPartsFromItems } from '../composables/localGeomError'
import { composeThinPartsLine } from '../composables/importFindings'
import { translate } from '../utils/i18n'

const ITEM_MAP = [
    { id: 0, slug: 'plaque', part: 0 },
    { id: 1, slug: 'ecrin', part: 0 },
    { id: 2, slug: 'ecrin', part: 1 },
    { id: 3, slug: 'ecrin', part: 2 },
    { id: 4, slug: 'ecrin', part: 3 },
]
const FILES = [
    { slug: 'plaque', name: 'plaque avant.dxf' },
    { slug: 'ecrin', name: 'ecrin.dxf' },
]
const t = (key, params) => translate(key, 'fr', params)

describe('E2 — items fins → fiches', () => {
    it('traduit les ids du moteur en fichier + rang', () => {
        expect(thinPartsFromItems([2, 1], ITEM_MAP)).toEqual([
            { item: 1, slug: 'ecrin', part: 0 },
            { item: 2, slug: 'ecrin', part: 1 },
        ])
    })

    it('rend une liste vide quand le moteur n’a rien signalé', () => {
        expect(thinPartsFromItems([], ITEM_MAP)).toEqual([])
        expect(thinPartsFromItems(null, ITEM_MAP)).toEqual([])
        expect(thinPartsFromItems(undefined, undefined)).toEqual([])
    })

    it('garde l’item même sans itemMap (slug inconnu, pas inventé)', () => {
        expect(thinPartsFromItems([7], [])).toEqual([{ item: 7, slug: null, part: 0 }])
    })

    it('borne la liste à 50 entrées', () => {
        const many = Array.from({ length: 120 }, (_, k) => k)
        expect(thinPartsFromItems(many, ITEM_MAP)).toHaveLength(50)
    })
})

describe('E2 — la ligne du rapport', () => {
    it('nomme trois pièces puis compte le reste', () => {
        const line = composeThinPartsLine(
            thinPartsFromItems([1, 2, 3, 4], ITEM_MAP), FILES, t,
        )
        expect(line).toContain('ecrin.dxf (pièce 1)')
        expect(line).toContain('ecrin.dxf (pièce 2)')
        expect(line).toContain('ecrin.dxf (pièce 3)')
        expect(line).not.toContain('pièce 4')
        expect(line).toContain('et 1 autres')
        // Le compte TOTAL reste exact, même si la liste est tronquée.
        expect(line).toMatch(/^4 pièce/)
    })

    it('rend null quand il n’y a rien à dire', () => {
        expect(composeThinPartsLine([], FILES, t)).toBeNull()
        expect(composeThinPartsLine(null, FILES, t)).toBeNull()
    })

    it('retombe sur le slug quand le nom du fichier est inconnu', () => {
        const line = composeThinPartsLine([{ slug: 'opaque-slug', part: 4 }], [], t)
        expect(line).toContain('opaque-slug (pièce 5)')
    })

    it('accepte le nom porté par le job (chemin serveur)', () => {
        const line = composeThinPartsLine([{ slug: 'x', part: 0, name: 'logo.dxf' }], [], t)
        expect(line).toContain('logo.dxf (pièce 1)')
    })

    it('existe en FR et EN, et ne parle jamais d’erreur', () => {
        for (const locale of ['fr', 'en']) {
            const tt = (k, p) => translate(k, locale, p)
            const line = composeThinPartsLine(
                thinPartsFromItems([1], ITEM_MAP), FILES, tt,
            )
            expect(line).not.toContain('nest.thinParts')
            expect(line).not.toContain('{n}')
            expect(line).not.toContain('{list}')
            expect(line.toLowerCase()).not.toMatch(/erreur|error|échec|failed/)
            expect(translate('import.partRank', locale, { n: 2 })).not.toBe('import.partRank')
        }
    })
})
