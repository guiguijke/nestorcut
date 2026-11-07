import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('noms des produits Stripe (script de création)', () => {
    it('le script porte les noms de prod, pas les anciens', () => {
        const script = read('../../scripts/create-live-products.mjs')
        expect(script).toContain("name: 'NestorCut Unlimited'")
        expect(script).toContain("name: 'NestorCut Pro'")
        expect(script).not.toContain("name: 'NestorCut Standard'")
        expect(script).not.toContain("name: 'NestorCut Confidentialité+'")
    })
})
