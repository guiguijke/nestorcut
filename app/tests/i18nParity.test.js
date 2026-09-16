// Lot L0 (docs/PLAN-LANGUES-2026-09-16.md §2.2) — le VERROU DE PARITÉ.
//
// L'anglais est la référence : chaque clé de l'anglais existe dans chaque
// langue livrée (et réciproquement — une clé orpheline d'une langue est
// une clé morte), aucune valeur vide, aucune valeur strictement égale à
// l'anglais HORS liste blanche (noms propres et sigles qui ne se
// traduisent pas). Une langue déclarée incomplète ne doit pas apparaître
// dans le menu : ce test la fait tomber AVANT.
import { describe, expect, it } from 'vitest'
import { DICTS, LOCALES, DEFAULT_LOCALE, formatNumber, formatPercent, translate } from '../utils/i18n'

/** Valeurs autorisées à être identiques à l'anglais : sigles, noms
 *  propres, et les MOTS QUI SONT LES MÊMES en français (empruns :
 *  Support, Rotations, Total…) ; les noms de TIERS sont des marques
 *  produit (Free/Unlimited/Pro/Standard, docs/STRATEGY.md) — ils ne se
 *  traduisent pas. Préfixes acceptés aussi (ex. « DXF — »). */
const IDENTICAL_OK = [
    'DXF', 'SVG', 'DWG', 'CSV', 'NestorCut', 'SheetCam', 'Stripe', 'GitHub',
    'Discord', 'mm', 'in', 'V', 'PDF', 'JSON', 'IndexedDB', 'WireGuard',
    'Nouveautés', 'What\'s new',
    // empruns communs et marques de tiers :
    'Support', 'Newsletter', 'Rotations', 'Options', 'Turbo', 'Compact',
    'Total', 'Version', 'Option {n}', 'Free', 'Unlimited', 'Pro',
    'Standard', 'Cloud · 24 h', 'Export — Unlimited', '{area} m²',
]
const identicalAllowed = (v) => {
    const s = String(v).trim()
    if (!/[a-zà-ÿ]/.test(s)) return true // que des majuscules/chiffres/signes
    return IDENTICAL_OK.some((w) => s === w || s.startsWith(w + ' ') || s.startsWith(w + ' —') || s.startsWith(w + ' :'))
}

describe('L0 — parité des clés de langue', () => {
    it('chaque clé de la référence existe dans chaque langue livrée', () => {
        const ref = Object.keys(DICTS[DEFAULT_LOCALE])
        expect(ref.length).toBeGreaterThan(500)
        for (const lang of LOCALES) {
            if (lang === DEFAULT_LOCALE) continue
            const keys = new Set(Object.keys(DICTS[lang]))
            const missing = ref.filter((k) => !keys.has(k))
            expect(missing, `[${lang}] clés absentes de la référence`).toEqual([])
        }
    })

    it('aucune clé orpheline (présente ailleurs, absente de la référence)', () => {
        const ref = new Set(Object.keys(DICTS[DEFAULT_LOCALE]))
        for (const lang of LOCALES) {
            if (lang === DEFAULT_LOCALE) continue
            const orphans = Object.keys(DICTS[lang]).filter((k) => !ref.has(k))
            expect(orphans, `[${lang}] clés orphelines`).toEqual([])
        }
    })

    it('aucune valeur vide ni copie de l\'anglais hors liste blanche', () => {
        for (const lang of LOCALES) {
            if (lang === DEFAULT_LOCALE) continue
            const empties = []
            const copies = []
            for (const [k, v] of Object.entries(DICTS[lang])) {
                if (v === null || v === undefined || String(v).trim() === '') empties.push(k)
                else if (String(v) === String(DICTS[DEFAULT_LOCALE][k]) && !identicalAllowed(v)) copies.push(k)
            }
            expect(empties, `[${lang}] valeurs vides`).toEqual([])
            expect(copies, `[${lang}] copies de l'anglais`).toEqual([])
        }
    })

    it('le repli de traduction rend la valeur anglaise, jamais une clé brute', () => {
        const someKey = Object.keys(DICTS[DEFAULT_LOCALE])[0]
        expect(translate(someKey, 'zz-unknown')).toBe(DICTS[DEFAULT_LOCALE][someKey])
    })
})

describe('L0 — nombres par locale (Intl)', () => {
    it('la virgule décimale suit la langue', () => {
        expect(formatNumber(1.5, 'fr', 1)).toBe('1,5')
        expect(formatNumber(1.5, 'en', 1)).toBe('1.5')
        expect(formatPercent(55.4, 'fr', 1)).toBe('55,4 %')
        expect(formatPercent(55.4, 'en', 1)).toBe('55.4%')
    })
})
