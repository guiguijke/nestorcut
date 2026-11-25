import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { degradedNoteKey, failureBannerText, failureDetailText, serverRefusalCode, failureReasonKey, isLocalJob, jobErrorBannerText } from '../utils/failureReason'
import en from '../utils/i18n/en'
import fr from '../utils/i18n/fr'
import de from '../utils/i18n/de'
import es from '../utils/i18n/es'
import it_ from '../utils/i18n/it'
import pt from '../utils/i18n/pt'

const CODES = [
    'memory_cap', 'entity_limit', 'geometry_missing', 'sheet_shape_missing', 'sheet_shape_unreadable', 'all_alternatives_invalid',
    'capacity_exceeded', 'item_geometry', 'item_unplaceable', 'part_too_large', 'spacing_too_large',
    'strip_height', 'crash', 'local_interrupted', 'payload_build', 'pool_failed', 'merge_failed', 'merge_parse', 'local_unknown',
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
    it('sheet_shape_missing est accepté par local-fail et lu par la carte de résultat', () => {
        const src = readFileSync(new URL('../../server/api/results/[slug]/local-fail.post.js', import.meta.url), 'utf8')
        const block = src.match(/LOCAL_FAIL_CODES = new Set\(\[([\s\S]*?)\]\)/)
        expect(block[1]).toContain("'sheet_shape_missing'")
        expect(failureReasonKey('sheet_shape_missing')).toBe('localImport.missingSheetShape')
    })

    it('sheet_shape_unreadable (lecture refusée) : accepté par local-fail, sa propre phrase, distincte de « absente »', () => {
        const src = readFileSync(new URL('../../server/api/results/[slug]/local-fail.post.js', import.meta.url), 'utf8')
        const block = src.match(/LOCAL_FAIL_CODES = new Set\(\[([\s\S]*?)\]\)/)
        expect(block[1]).toContain("'sheet_shape_unreadable'")
        expect(failureReasonKey('sheet_shape_unreadable')).toBe('localImport.unreadableSheetShape')
        for (const dict of [en, fr, de, es, it_, pt]) {
            expect(dict['localImport.unreadableSheetShape']).not.toBe(dict['localImport.missingSheetShape'])
        }
    })

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

describe('failureReasonKey : calcul sur cet appareil', () => {
    const LOCAL_CODES = ['memory_cap', 'entity_limit', 'all_alternatives_invalid', 'crash']

    it('les quatre codes à conseil serveur donnent la variante locale, traduite dans les 6 langues', () => {
        const keys = LOCAL_CODES.map((c) => failureReasonKey(c, { localOnly: true }))
        expect(keys).toEqual([
            'localMode.memoryLocal',
            'localMode.entityLimitLocal',
            'localMode.allInvalidLocal',
            'localMode.crashLocal',
        ])
        for (const [name, dict] of Object.entries({ en, fr, de, es, it: it_, pt })) {
            for (const key of keys) expect(dict[key], `${name}:${key}`).toBeTruthy()
        }
    })

    it('aucune variante locale ne conseille le mode serveur, dans les 6 langues', () => {
        for (const [name, dict] of Object.entries({ en, fr, de, es, it: it_, pt })) {
            for (const code of LOCAL_CODES) {
                const text = dict[failureReasonKey(code, { localOnly: true })]
                expect(text, `${name}:${code}`).not.toMatch(/serveur|server|servidor|servitore|Server-?Modus/i)
            }
        }
    })

    it('sans localOnly, la table est celle d’avant ; les autres codes ne changent pas', () => {
        expect(failureReasonKey('crash')).toBe('localMode.crashError')
        expect(failureReasonKey('memory_cap', { localOnly: false })).toBe('localMode.memorySuggest')
        expect(failureReasonKey('part_too_large', { localOnly: true })).toBe('localMode.partTooLargePlain')
        expect(failureReasonKey('free text', { localOnly: true })).toBeNull()
    })

    it('un résultat local ou un job localOnly du serveur est local', () => {
        expect(isLocalJob({ isLocal: true })).toBe(true)
        expect(isLocalJob({ localOnly: true })).toBe(true)
        expect(isLocalJob({ projectLocal: true })).toBe(true)
        expect(isLocalJob({})).toBe(false)
        expect(isLocalJob(null)).toBe(false)
    })

    it('le bandeau d’un job local rechargé donne la variante locale', () => {
        const t = (key) => `t:${key}`
        expect(failureBannerText({ information: 'crash', localOnly: true }, t)).toBe('t:localMode.crashLocal')
        expect(failureBannerText({ information: 'crash' }, t)).toBe('t:localMode.crashError')
    })

    it('la carte de résultat passe le même drapeau', () => {
        const card = readFileSync(new URL('../components/UserResultItem.vue', import.meta.url), 'utf8')
        expect(card).toMatch(/failureReasonKey\(props\.result\?\.information, \{ localOnly: isLocalJob\(props\.result\) \}\)/)
    })
})

describe('failureBannerText', () => {
    const t = (key) => `t:${key}`

    it('texte du worker : tel quel, c’est la seule cause connue', () => {
        const information = 'Nesting failed: qa cause from the worker'
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

    it('plantage du moteur natif : le libellé d’échec, jamais la trace', () => {
        const trace = "Nesting failed: engine failed (rc=3221226505, reason=unknown): thread '<unnamed>' panicked at crates\jagua-rs\src\probs\spp\entities\problem.rs:35:48:\ncalled `Result::unwrap()` on an `Err` value"
        expect(failureBannerText({ information: trace }, t)).toBe('t:result.failed')
        // Le stderr peut être vide, ou la mention du moteur absente.
        expect(failureBannerText({ information: 'Nesting failed: engine failed (rc=1, reason=unknown): ' }, t)).toBe('t:result.failed')
        expect(failureBannerText({ information: "thread 'main' panicked at src/main.rs:1:1" }, t)).toBe('t:result.failed')
        // Un texte libre lisible du worker reste affiché, même s'il parle du moteur.
        const lisible = 'Nesting failed: the engine stopped on a precise cause'
        expect(failureBannerText({ information: lisible }, t)).toBe(lisible)
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

describe('refus du worker : le nom de fichier ne reclasse pas le message', () => {
    it('un nom qui ressemble à un autre refus est ignoré', () => {
        const msg = 'Nesting failed: part 2 of "found no valid position for part.dxf" has an outline the engine cannot use (x)'
        expect(serverRefusalCode(msg)).toBe('item_geometry')
        expect(serverRefusalCode('Nesting failed: the engine found no valid position for part 1 of "strip_height_below_separation:.dxf" on the declared sheets')).toBe('item_unplaceable')
    })
})

describe('failureDetailText : cause connue par ailleurs', () => {
    const t = (k) => k
    const map = (code) => `E:${code}`
    it('engine_error avec unfit : rien à ajouter', () => {
        expect(failureDetailText({ errorCode: 'engine_error', unfit: { reason: 'strip' } }, t, map)).toBe('')
    })
    it('engine_error sans unfit : le repli plantage', () => {
        expect(failureDetailText({ errorCode: 'engine_error' }, t, map)).toBe('E:crash')
    })
})
