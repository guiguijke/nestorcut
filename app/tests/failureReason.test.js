import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { degradedNoteKey, failureBannerText, failureReasonKey, jobErrorBannerText } from '../utils/failureReason'
import en from '../utils/i18n/en'
import fr from '../utils/i18n/fr'
import de from '../utils/i18n/de'
import es from '../utils/i18n/es'
import it_ from '../utils/i18n/it'
import pt from '../utils/i18n/pt'

const CODES = [
    'memory_cap', 'entity_limit', 'geometry_missing', 'all_alternatives_invalid',
    'capacity_exceeded', 'item_geometry', 'item_unplaceable', 'part_too_large', 'spacing_too_large',
    'crash', 'local_interrupted', 'payload_build', 'pool_failed', 'merge_failed', 'merge_parse', 'local_unknown',
]

describe('failureReasonKey', () => {
    it('chaque code stable a une explication traduite dans les 6 langues', () => {
        for (const [name, dict] of Object.entries({ en, fr, de, es, it: it_, pt })) {
            for (const code of CODES) {
                const key = failureReasonKey(code)
                expect(key, code).toBeTruthy()
                expect(dict[key], `${name}:${key}`).toBeTruthy()
            }
        }
    })

    it('texte libre (worker / moteur) ou vide : null, la carte garde son libellé', () => {
        expect(failureReasonKey('This job does not fit the declared sheets')).toBeNull()
        expect(failureReasonKey('')).toBeNull()
        expect(failureReasonKey(null)).toBeNull()
        expect(failureReasonKey('toString')).toBeNull()
    })

    // Verrou de couverture : tout code que local-fail accepte peut finir dans
    // `information` du job, donc doit avoir une cause à l'écran après
    // rechargement. Les deux seules exceptions ne sont jamais écrites dans
    // `information` : `local_geometry_missing` n'est qu'un `detail` (le code
    // d'erreur envoyé est `geometry_missing`), `engine_error` est la catégorie
    // posée par le serveur dans `errorCode` pour un texte moteur libre.
    it('chaque code accepté par local-fail a une raison, sauf les deux codes jamais affichés', () => {
        const src = readFileSync(new URL('../../server/api/results/[slug]/local-fail.post.js', import.meta.url), 'utf8')
        const block = src.match(/LOCAL_FAIL_CODES = new Set\(\[([\s\S]*?)\]\)/)
        expect(block, 'liste LOCAL_FAIL_CODES introuvable').toBeTruthy()
        const accepted = [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
        expect(accepted.length).toBeGreaterThan(10)
        const NEVER_SHOWN = ['local_geometry_missing', 'engine_error']
        const missing = accepted.filter((c) => !NEVER_SHOWN.includes(c) && !failureReasonKey(c))
        expect(missing).toEqual([])
    })
})

describe('failureBannerText', () => {
    const t = (key) => `t:${key}`

    it('texte du worker : tel quel, c’est la seule cause connue', () => {
        const information = 'Nesting failed: the engine found no valid position for part 1 of "a.dxf"'
        expect(failureBannerText({ information }, t)).toBe(information)
    })

    // `errorCode` n'est posé que par local-fail : après rechargement, le même
    // message qu'en direct. Un texte libre du moteur n'est pas montré tel quel,
    // il ne dit rien à l'utilisateur et peut citer une pièce.
    it('calcul navigateur : le message du registre, jamais le texte brut du moteur', () => {
        const mapLocalError = (code) => `local:${code}`
        expect(failureBannerText({ errorCode: 'engine_error', information: 'RuntimeError: unreachable' }, t, mapLocalError))
            .toBe('local:crash')
        expect(failureBannerText({ errorCode: 'merge_failed', information: 'merge_failed' }, t, mapLocalError))
            .toBe('local:merge_failed')
        expect(failureBannerText({ errorCode: 'local_interrupted', information: 'local_interrupted' }, t, mapLocalError))
            .toBe('t:results.localInterrupted')
    })

    it('code stable : l’explication traduite, jamais le code brut', () => {
        expect(failureBannerText({ information: 'item_unplaceable' }, t)).toBe('t:localMode.itemUnplaceableUnknown')
        expect(failureBannerText({ information: 'local_interrupted' }, t)).toBe('t:results.localInterrupted')
    })

    it('aucune cause écrite : le libellé d’échec, jamais un bandeau vide', () => {
        for (const information of [null, undefined, '', '   ']) {
            expect(failureBannerText({ information }, t)).toBe('t:result.failed')
        }
    })
})

describe('degradedNoteKey', () => {
    it('une livraison dégradée a une note traduite dans les 6 langues', () => {
        for (const [name, dict] of Object.entries({ en, fr, de, es, it: it_, pt })) {
            for (const code of ['merge_failed', 'merge_unavailable']) {
                const key = degradedNoteKey(code)
                expect(key, code).toBeTruthy()
                expect(dict[key], `${name}:${key}`).toBeTruthy()
            }
        }
    })

    it('job normal ou code inconnu : aucune note', () => {
        for (const code of [null, undefined, '', 'toString', 'autre']) {
            expect(degradedNoteKey(code)).toBeNull()
        }
    })

    // La carte n'a pas de test de montage : ce fil-là, seul le navigateur
    // l'exécute (scénario fusion_morte de scripts/qa-e2e-failure-scroll.mjs).
    it('la carte montre la note et son badge passe en ambre, sur un job terminé seulement', () => {
        const card = readFileSync(new URL('../components/UserResultItem.vue', import.meta.url), 'utf8')
        expect(card).toMatch(/isResultCompleted\.value \? degradedNoteKey\(props\.result\?\.degraded\) : null/)
        expect(card).toMatch(/<p v-if="degradedKey"[^>]*>\s*\{\{ t\(degradedKey\) \}\}/)
        expect(card).toMatch(/if \(isPartial\.value \|\| degradedKey\.value\) return 'warn'/)
    })

    // Verrou de couverture : tout code que local-quota pose sur le job doit se
    // voir sur la carte.
    it('chaque code accepté par local-quota a une note', () => {
        const src = readFileSync(new URL('../../server/api/results/[slug]/local-quota.post.js', import.meta.url), 'utf8')
        const block = src.match(/DEGRADED_CODES = new Set\(\[([\s\S]*?)\]\)/)
        expect(block, 'liste DEGRADED_CODES introuvable').toBeTruthy()
        const accepted = [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
        expect(accepted.length).toBeGreaterThan(0)
        expect(accepted.filter((c) => !degradedNoteKey(c))).toEqual([])
    })
})

describe('jobErrorBannerText', () => {
    const t = (key) => `t:${key}`
    const mapLocalError = (code) => `local:${code}`
    const text = (over) => jobErrorBannerText({ localErrorText: '', serverJob: null, t, mapLocalError, ...over })

    it('job serveur en erreur : la cause du worker, telle quelle', () => {
        const information = 'Nesting failed: qa cause from the worker'
        expect(text({ serverJob: { phase: 'error', job: { information } } })).toBe(information)
    })

    it('job serveur en erreur sans cause écrite : le libellé d’échec', () => {
        expect(text({ serverJob: { phase: 'error', job: {} } })).toBe('t:result.failed')
    })

    it('job serveur d’un calcul navigateur rechargé : le message du direct', () => {
        expect(text({ serverJob: { phase: 'error', job: { errorCode: 'merge_failed' } } })).toBe('local:merge_failed')
    })

    it('le registre local passe avant le flux serveur', () => {
        const serverJob = { phase: 'error', job: { information: 'cause du serveur' } }
        expect(text({ localErrorText: 'pièce 2 trop grande', serverJob })).toBe('pièce 2 trop grande')
    })

    it('rien en erreur : pas de bandeau', () => {
        expect(text({})).toBe('')
        expect(text({ serverJob: { phase: 'processing', job: { information: 'x' } } })).toBe('')
        expect(text({ serverJob: { phase: 'done', job: { information: 'x' } } })).toBe('')
    })
})
