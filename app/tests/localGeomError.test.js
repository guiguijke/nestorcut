/**
 * Lot E0 : l'échec d'import moteur d'une pièce arrive-t-il jusqu'à un message
 * qui NOMME le fichier et la pièce ?
 *
 * Le verrou porte sur la chaîne complète : message moteur → id d'item →
 * itemMap → { fichier, rang } → phrase i18n FR et EN. C'est la chaîne qui
 * était rompue (l'utilisateur lisait « arrêté de façon inattendue »).
 */
import { describe, it, expect } from 'vitest'
import {
    parseItemGeometryError,
    itemGeometryTarget,
    itemGeometryParams,
} from '../composables/localGeomError'
import { translate } from '../utils/i18n'

// Message réellement rendu par le moteur (nest-engine/src/import_error.rs) :
// mesuré sur une instance à trois items dont le second est dégénéré.
const ENGINE_MSG =
    'item_geometry:7: Simple polygon contains intersecting edges 191 and 195: [Point(0.0, 0.0), Point(1.0, 0.0)]'

const ITEM_MAP = [
    { id: 0, slug: 'plaque-avant', part: 0 },
    { id: 7, slug: 'ecrin-volute', part: 11 },
    { id: 8, slug: 'ecrin-volute', part: 12 },
]

const FILES = [
    { slug: 'plaque-avant', name: 'plaque avant.dxf' },
    { slug: 'ecrin-volute', name: 'ecrin.dxf' },
]

describe('E0 — erreur de géométrie d’item', () => {
    it('lit l’id d’item dans le message moteur', () => {
        expect(parseItemGeometryError(ENGINE_MSG)).toBe(7)
        expect(parseItemGeometryError('item_geometry:0: whatever')).toBe(0)
    })

    it('ignore les autres échecs (ils gardent leur message)', () => {
        expect(parseItemGeometryError('memory_cap')).toBeNull()
        expect(parseItemGeometryError('pool_failed')).toBeNull()
        expect(parseItemGeometryError('')).toBeNull()
        expect(parseItemGeometryError(undefined)).toBeNull()
        // Un message qui PARLE de géométrie sans porter l'identifiant ne doit
        // pas devenir un faux « pièce 1 du premier fichier ».
        expect(
            parseItemGeometryError('importing SPP instance into jagua-rs: intersecting edges')
        ).toBeNull()
    })

    it('résout le fichier et la pièce par l’itemMap', () => {
        const target = itemGeometryTarget(ENGINE_MSG, ITEM_MAP)
        expect(target).toEqual({ slug: 'ecrin-volute', part: 11 })
        // Rang affiché 1-based : la pièce d'index 11 est la douzième.
        expect(itemGeometryParams(target, FILES)).toEqual({
            file: 'ecrin.dxf',
            part: 12,
        })
    })

    it('reste silencieux plutôt que d’inventer un numéro', () => {
        expect(itemGeometryTarget(ENGINE_MSG, null)).toBeNull()
        expect(itemGeometryTarget(ENGINE_MSG, [])).toBeNull()
        // id absent de l'itemMap (instance réduite, piège #3b)
        expect(itemGeometryTarget(ENGINE_MSG, [{ id: 3, slug: 'x', part: 0 }])).toBeNull()
        expect(itemGeometryParams(null, FILES)).toBeNull()
    })

    it('retombe sur le slug quand le nom du fichier n’est pas connu', () => {
        const target = itemGeometryTarget(ENGINE_MSG, ITEM_MAP)
        expect(itemGeometryParams(target, [])).toEqual({
            file: 'ecrin-volute',
            part: 12,
        })
    })

    it('produit une phrase qui nomme le fichier et la pièce, FR et EN', () => {
        const params = itemGeometryParams(itemGeometryTarget(ENGINE_MSG, ITEM_MAP), FILES)
        for (const locale of ['fr', 'en']) {
            const msg = translate('localMode.itemGeometry', locale, params)
            expect(msg).toContain('ecrin.dxf')
            expect(msg).toContain('12')
            // Aucun gabarit non substitué, et jamais le message générique.
            expect(msg).not.toContain('{file}')
            expect(msg).not.toContain('{part}')
            expect(msg).not.toBe(translate('localMode.crashLocal', locale))
        }
        // Le remboursement reste annoncé (la décision produit n'a pas changé).
        expect(translate('localMode.itemGeometry', 'fr', params)).toMatch(/rembours/i)
        expect(translate('localMode.itemGeometry', 'en', params)).toMatch(/refund/i)
    })

    it('a une variante sans identifiant, elle aussi traduite', () => {
        for (const locale of ['fr', 'en']) {
            const msg = translate('localMode.itemGeometryUnknown', locale)
            expect(msg).not.toBe('localMode.itemGeometryUnknown')
            expect(msg.length).toBeGreaterThan(30)
        }
    })
})
