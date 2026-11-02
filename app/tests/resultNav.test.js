import { describe, expect, it } from 'vitest'
import { findReopenItem, isOnJobProject } from '../utils/resultNav'

// D12 (02/11) : « sur le projet du job » = route ET store (qui porte le
// CHEMIN d'API `/api/project/<slug>`, files.js:358, jamais le slug nu).
describe('isOnJobProject', () => {
    it('route et chemin d’API du store sur le projet du job → true', () => {
        expect(isOnJobProject('p1', '/api/project/p1', 'p1')).toBe(true)
    })

    it('slug nu dans le store (forme fautive du constat bloquant) → false', () => {
        expect(isOnJobProject('p1', 'p1', 'p1')).toBe(false)
    })

    it('page /home (pas de slug de route) → false', () => {
        expect(isOnJobProject(undefined, '/api/project/p1', 'p1')).toBe(false)
    })

    it('autre projet, ou store pas encore rechargé → false', () => {
        expect(isOnJobProject('p2', '/api/project/p2', 'p1')).toBe(false)
        expect(isOnJobProject('p1', '/api/project/p2', 'p1')).toBe(false)
    })

    it('projectSlug vide ou null → false', () => {
        expect(isOnJobProject('', '/api/project', '')).toBe(false)
        expect(isOnJobProject(null, '/api/project', null)).toBe(false)
        expect(isOnJobProject(undefined, null, undefined)).toBe(false)
    })
})

describe('findReopenItem', () => {
    const list = [{ slug: 'a' }, { slug: 'b' }]

    it('rend l’item de la liste dont le slug est la cible', () => {
        expect(findReopenItem(list, { resultSlug: 'b' })).toBe(list[1])
    })

    it('cible absente, liste vide, null → null', () => {
        expect(findReopenItem(list, { resultSlug: 'zz' })).toBeNull()
        expect(findReopenItem([], { resultSlug: 'a' })).toBeNull()
        expect(findReopenItem(list, null)).toBeNull()
        expect(findReopenItem(null, { resultSlug: 'a' })).toBeNull()
        expect(findReopenItem(list, {})).toBeNull()
    })
})
