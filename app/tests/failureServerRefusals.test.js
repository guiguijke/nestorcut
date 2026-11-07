import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
    ENGINE_TRACE, failureBannerText, failureDetailText, failureItemParams, failureReasonKey,
    isEngineTrace, serverRefusalCode,
} from '../utils/failureReason'
import en from '../utils/i18n/en'
import fr from '../utils/i18n/fr'
import de from '../utils/i18n/de'
import es from '../utils/i18n/es'
import it_ from '../utils/i18n/it'
import pt from '../utils/i18n/pt'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

// Textes que workers/nesting/core/engine.py écrit dans `information` d'un job du
// worker (en anglais) : la page les rend dans sa langue.
const SERVER_UNPLACEABLE = 'Nesting failed: the engine found no valid position for part 3 of "a.dxf" on the declared sheets at this spacing (it may be as large as the sheet once the spacing is added) — use a larger sheet, reduce the spacing, or allow more rotations.'
const SERVER_GEOMETRY = 'Nesting failed: part 2 of "a.dxf" has an outline the engine cannot use (not a usable closed contour) — fix that part in your CAD, or set its quantity to 0.'
const SERVER_STRIP = 'Nesting failed: strip_height_below_separation: strip height 0 leaves no room for item separation 0'
const TRACE = "Nesting failed: engine failed (rc=3221226505, reason=unknown): thread '<unnamed>' panicked at crates/jagua-rs/src/problem.rs:35:48"

const t = (key) => `t:${key}`
const mapLocalError = (code, params) => `local:${code}:${params ? `${params.file}#${params.part}` : '-'}`
const files = [{ slug: 'f1', name: 'bracket.dxf' }]

describe('refus du worker rendus dans la langue de la page', () => {
    it('les fragments reconnus sont ceux que engine.py et le moteur écrivent vraiment', () => {
        const py = read('../../workers/nesting/core/engine.py').replace(/"\s*\n\s*f?"/g, '')
        expect(py).toContain('has an outline the engine cannot use')
        expect(py).toContain('found no valid position for part')
        const rust = read('../../workers/nesting/engine/crates/jagua-rs/src/probs/spp/io/import.rs')
        expect(rust).toContain('strip_height_below_separation:')
        expect(serverRefusalCode(SERVER_GEOMETRY)).toBe('item_geometry')
        expect(serverRefusalCode(SERVER_UNPLACEABLE)).toBe('item_unplaceable')
        expect(serverRefusalCode(SERVER_STRIP)).toBe('strip_height')
        expect(serverRefusalCode('Nesting failed: autre cause')).toBeNull()
    })

    it('la carte aussi : une explication traduite pour ces textes', () => {
        expect(failureReasonKey(SERVER_UNPLACEABLE)).toBe('localMode.itemUnplaceableUnknown')
        expect(failureReasonKey(SERVER_STRIP)).toBe('localMode.stripTooSmall')
    })

    it('bandeau : la pièce est nommée quand le fichier est connu, après rechargement comme en direct', () => {
        const job = { information: SERVER_UNPLACEABLE, itemGeometry: { slug: 'f1', part: 2 } }
        expect(failureBannerText(job, t, mapLocalError, files)).toBe('local:item_unplaceable:bracket.dxf#3')
        const local = { errorCode: 'item_geometry', information: 'item_geometry', itemGeometry: { slug: 'f1', part: 0 } }
        expect(failureBannerText(local, t, mapLocalError, files)).toBe('local:item_geometry:bracket.dxf#1')
    })

    it('fichier inconnu ou pièce non nommée : la phrase sans nom, jamais l’identifiant interne', () => {
        const job = { information: SERVER_GEOMETRY, itemGeometry: { slug: 'zzz', part: 1 } }
        expect(failureBannerText(job, t, mapLocalError, files)).toBe('local:item_geometry:-')
        expect(failureBannerText({ information: SERVER_GEOMETRY }, t, mapLocalError, files)).toBe('local:item_geometry:-')
        expect(failureItemParams({ itemGeometry: { slug: 'f1', part: 'x' } }, files)).toEqual({ file: 'bracket.dxf', part: 1 })
        expect(failureItemParams({ itemGeometry: { slug: 'f1', part: 0 } }, undefined)).toBeNull()
    })

    it('tôle trop petite pour le moteur : une phrase vraie à espacement 0, pas celle du moteur', () => {
        expect(failureBannerText({ information: SERVER_STRIP }, t, mapLocalError, files)).toBe('t:localMode.stripTooSmall')
        for (const [name, dict] of Object.entries({ en, fr, de, es, it: it_, pt })) {
            expect(dict['localMode.stripTooSmall'], name).toBeTruthy()
            expect(dict['localMode.stripTooSmall'], name).not.toMatch(/strip_height|separation 0/)
        }
    })

    it('un texte libre du worker garde son affichage', () => {
        expect(failureBannerText({ information: 'Nesting failed: qa cause' }, t, mapLocalError, files))
            .toBe('Nesting failed: qa cause')
    })
})

describe('refus d’une pièce : le message dit de la retirer, et rien d’inventé', () => {
    const keys = ['localMode.itemUnplaceable', 'localMode.itemUnplaceableUnknown']
    it('aucune valeur d’espacement n’est promise (le calcul exact dépend de la pièce et des rotations)', () => {
        for (const [name, dict] of Object.entries({ en, fr, de, es, it: it_, pt })) {
            for (const key of keys) {
                expect(dict[key], `${name}:${key}`).toBeTruthy()
                expect(dict[key], `${name}:${key}`).not.toMatch(/\{(v|mm|spacing|value)\}/)
            }
        }
    })
    it('chaque langue cite la quantité à 0 ou le retrait, et le fait que les autres pièces ne sont pas livrées', () => {
        expect(en['localMode.itemUnplaceable']).toMatch(/quantity to 0/)
        expect(en['localMode.itemUnplaceable']).toMatch(/other parts included/)
        expect(fr['localMode.itemUnplaceable']).toMatch(/quantité à 0/)
        expect(fr['localMode.itemUnplaceable']).toMatch(/les autres non plus/)
        expect(fr['localMode.itemUnplaceableUnknown']).toMatch(/retirez la pièce concernée/)
        expect(de['localMode.itemUnplaceable']).toMatch(/Stückzahl auf 0/)
        expect(es['localMode.itemUnplaceable']).toMatch(/cantidad a 0/)
        expect(it_['localMode.itemUnplaceable']).toMatch(/quantità a 0/)
        expect(pt['localMode.itemUnplaceable']).toMatch(/quantidade dela como 0/)
    })
})

describe('fenêtre de résultat : même règle que le bandeau', () => {
    it('la trace du moteur natif n’est pas montrée, la détection est celle du bandeau', () => {
        expect(failureDetailText({ information: TRACE }, t, mapLocalError)).toBe('')
        expect(isEngineTrace(TRACE)).toBe(true)
        expect(ENGINE_TRACE.test(TRACE)).toBe(true)
        expect(isEngineTrace('Nesting failed: autre')).toBe(false)
        expect(failureBannerText({ information: TRACE }, t, mapLocalError)).toBe('t:result.failed')
    })

    it('un texte libre lisible reste montré ; un refus connu est traduit', () => {
        expect(failureDetailText({ information: 'Nesting failed: qa cause' }, t, mapLocalError)).toBe('Nesting failed: qa cause')
        expect(failureDetailText({ information: SERVER_STRIP }, t, mapLocalError)).toBe('t:localMode.stripTooSmall')
    })

    it('un code stable est traduit au lieu du code brut', () => {
        expect(failureDetailText({ information: 'memory_cap', errorCode: 'memory_cap' }, t, mapLocalError)).toBe('local:memory_cap:-')
        expect(failureDetailText({ information: 'spacing_too_large' }, t, mapLocalError)).toBe('t:localMode.spacingTooLarge')
    })

    it('rien d’écrit : rien d’ajouté à « aucune solution »', () => {
        expect(failureDetailText({}, t, mapLocalError)).toBe('')
        expect(failureDetailText(null, t, mapLocalError)).toBe('')
    })

    it('ResultReport n’a plus de copie du texte brut ni de la détection', () => {
        const report = read('../components/ResultReport.vue')
        expect(report).not.toContain('resultModalData.information')
        expect(report).not.toMatch(/engine failed|panicked at/)
        expect(read('../components/ResultModal.vue')).toContain('failureDetailText(')
    })
})

describe('serveur : la pièce refusée arrive jusqu’au bandeau', () => {
    it('le contrôleur expose itemGeometry (projection et sortie)', () => {
        const src = read('../../server/features/results/resultcontroller.js')
        expect(src).toMatch(/RESULT_FIELDS = \[[\s\S]*'itemGeometry'/)
        expect(src).toContain('itemGeometry: queueItem.itemGeometry ?? null')
    })
    it('local-fail accepte le code strip_height et la page le connaît', () => {
        expect(read('../../server/api/results/[slug]/local-fail.post.js')).toContain("'strip_height'")
        expect(read('../pages/project/[slug].vue')).toContain("p.error === 'strip_height'")
        expect(read('../composables/localJobPrivate.js')).toContain("'strip_height'")
    })
    it('la page passe les fichiers du projet au bandeau', () => {
        expect(read('../pages/project/[slug].vue')).toContain('files: projectFiles.value')
    })
})
