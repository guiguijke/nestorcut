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
    // identiques dans les langues livrées — validés par la relecture :
    'Demo', 'material', 'Nesting', 'walks',
    // italien (L2) : emprunts identiques — « Account », « Email » et
    // « Password » SONT les mots italiens ; « file » est invariable au
    // pluriel ; « Privacy » est l'usage italien du pied de page.
    'Account', 'Email', 'Password', '{n} file', 'Privacy',
    // allemand (L3) : « Name » EST le mot allemand.
    'Name',
    // espagnol (L4) : « Factor » / « factor {v} » SONT l'espagnol.
    'Factor', 'factor {v}',
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

    // A-révision L3 (relecture 21/09) : « les faits ne se perdent pas » —
    // tout sigle, identifiant de licence, numéro de version ou nom propre
    // présent dans la chaîne anglaise doit se retrouver dans chaque
    // traduction. Né du licences.own amputé en pt/it/de (héritage MIT,
    // sparrow/jagua-rs, réserve de marque perdus) et de dwgServer PT qui
    // ne disait plus « DXF et SVG ». Liste blanche COURTE : unités qui se
    // traduisent (MB→Mo) et décimales normalisées (0.05 = 0,05).
    it('les faits ne se perdent pas : sigles, licences, versions, noms propres', () => {
        // Liste blanche COURTE (relecture L3) : unités qui se traduisent
        // (MB→Mo, CAD→CAO) et majuscules d'insistance traduites
        // (AND/LAST/WARNING/ALL → ET/DERNIER/AVERTISSEMENT/TOUTES…).
        const FACT_WHITELIST = new Set(['MB', 'CAD', 'AND', 'LAST', 'WARNING', 'ALL'])
        const properIds = /(?:sparrow|jagua-rs|PolyForm|Noncommercial|nest2d|Stripe|SheetCam|WebAssembly|IndexedDB|WireGuard|NestorCut|GitHub|Discord|Google)/g
        const factsOf = (s) => {
            const out = new Set()
            for (const m of String(s).matchAll(/\b[A-Z]{2,}[0-9]*\b/g)) out.add(m[0])
            for (const m of String(s).matchAll(/\b\d+(?:[.,]\d+)+\b/g)) out.add(m[0].replace(',', '.'))
            for (const m of String(s).matchAll(properIds)) out.add(m[0])
            return out
        }
        for (const lang of LOCALES) {
            if (lang === DEFAULT_LOCALE) continue
            const lost = []
            for (const [k, v] of Object.entries(DICTS[lang])) {
                const ref = String(DICTS[DEFAULT_LOCALE][k])
                for (const f of factsOf(ref)) {
                    if (FACT_WHITELIST.has(f)) continue
                    const vStr = String(v)
                    const present = f.includes('.')
                        ? vStr.includes(f) || vStr.includes(f.replace('.', ','))
                        : vStr.includes(f)
                    if (!present) lost.push(`${k}: «${f}» absent`)
                }
            }
            expect(lost, `[${lang}] faits perdus`).toEqual([])
        }
    })

    // A-bis (jalon A de L1) : les VARIABLES {…} de chaque clé doivent être
    // IDENTIQUES dans toutes les langues — une traduction depuis une « cousine »
    // de la clé anglaise laisse des variables fantômes ({reason} en toutes
    // lettres à l'écran) et perd celles de la source.
    it('mêmes variables {…} par clé dans toutes les langues', () => {
        const varsOf = (s) => new Set(String(s).match(/\{(\w+)\}/g) || [])
        for (const lang of LOCALES) {
            if (lang === DEFAULT_LOCALE) continue
            const ghost = []
            const lost = []
            for (const [k, v] of Object.entries(DICTS[lang])) {
                const refVars = varsOf(DICTS[DEFAULT_LOCALE][k])
                const langVars = varsOf(v)
                for (const lv of langVars) if (!refVars.has(lv)) ghost.push(`${k}: ${lv}`)
                for (const rv of refVars) if (!langVars.has(rv)) lost.push(`${k}: ${rv}`)
            }
            expect(ghost, `[${lang}] variables fantômes (absentes de l'anglais)`).toEqual([])
            expect(lost, `[${lang}] variables perdues (présentes dans l'anglais)`).toEqual([])
        }
    })
})

describe('L0 — nombres par locale (Intl)', () => {
    it('la virgule décimale suit la langue', () => {
        expect(formatNumber(1.5, 'fr', 1)).toBe('1,5')
        expect(formatNumber(1.5, 'en', 1)).toBe('1.5')
        expect(formatPercent(55.4, 'fr', 1)).toBe('55,4 %')
        // Relecture L3 : l'allemand prend aussi l'espace (DIN 5008) ; it et pt restent collés.
        expect(formatPercent(55.4, 'de', 1)).toBe('55,4 %')
        expect(formatPercent(55.4, 'en', 1)).toBe('55.4%')
        expect(formatPercent(55.4, 'en', 1)).toBe('55.4%')
    })
})
