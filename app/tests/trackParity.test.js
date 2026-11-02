import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TRACK_ACTIONS } from '~~/shared/constants/trackActions'

// d8 (02/11) : parité entre les émetteurs de l'app et la liste blanche de
// POST /api/track. 38 noms émis étaient rejetés en silence (400) parce que la
// liste du serveur avait dérivé de l'app. Ce test parcourt app/ et exige que
// chaque nom émis soit autorisé. Le contrôle « le serveur lit bien la liste
// partagée » vit dans server/tests/trackAllowlist.test.js.

const appDir = fileURLToPath(new URL('..', import.meta.url))
const SKIPPED_DIRS = new Set(['node_modules', 'tests', '.nuxt', '.output', '.cache'])

function listSources(dir) {
    const out = []
    for (const entry of readdirSync(dir)) {
        if (SKIPPED_DIRS.has(entry)) continue
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
            out.push(...listSources(full))
        } else if (/\.(vue|js|ts)$/.test(entry)) {
            out.push(full)
        }
    }
    return out
}

// Balise ouvrante qui contient la position `at` : la dernière `<Nom` qui suit
// un blanc, un `>` ou le début du fichier (un `a<b` dans un attribut ne compte
// pas).
function enclosingTag(source, at) {
    const re = /(?:^|[\s>])<([A-Za-z][\w.-]*)/g
    let name = null
    let m
    while ((m = re.exec(source)) !== null && m.index < at) name = m[1]
    return name
}

/** Noms émis par un fichier : [{ name, rule }]. */
function emittedNames(source) {
    const out = []
    const add = (name, rule) => out.push({ name, rule })

    // 1. trackingTag="x" / tracking-tag="x" : click_x, ou dialog_view_x sur un DialogWrapper.
    for (const m of source.matchAll(/\b(?:trackingTag|tracking-tag)="([a-z0-9_]+)"/g)) {
        const prefix = enclosingTag(source, m.index) === 'DialogWrapper' ? 'dialog_view_' : 'click_'
        add(prefix + m[1], 'attribut')
    }
    // 2. Objets { trackingTag: 'x' } : click_x (cartes de /plans).
    for (const m of source.matchAll(/\btrackingTag:\s*['"]([a-z0-9_]+)['"]/g)) add('click_' + m[1], 'objet')
    // 3. trackEvent('x'
    for (const m of source.matchAll(/trackEvent\(\s*['"]([a-z0-9_]+)['"]/g)) add(m[1], 'littéral')
    // 4. Ternaire en PREMIER argument seulement (évite les on/off de TurboMenuButton).
    for (const m of source.matchAll(/trackEvent\(\s*[^,()'"]+\?\s*["']([a-z0-9_]+)["']\s*:\s*["']([a-z0-9_]+)["']/g)) {
        add(m[1], 'ternaire')
        add(m[2], 'ternaire')
    }
    // 5. Second argument de onExportClick(…, 'x').
    for (const m of source.matchAll(/onExportClick\([^,()]*,\s*['"]([a-z0-9_]+)['"]/g)) add(m[1], 'export')
    return out
}

function scanApp() {
    const found = new Map() // nom → fichiers
    for (const file of listSources(appDir)) {
        const source = readFileSync(file, 'utf8')
        for (const { name } of emittedNames(source)) {
            if (!found.has(name)) found.set(name, new Set())
            found.get(name).add(file.slice(appDir.length).replace(/\\/g, '/'))
        }
    }
    // 6. Nom ajouté à la main : ChatSupport l'émet par un littéral que la règle 3 voit déjà ;
    // on le garde explicite pour le jour où il passerait par une constante.
    if (!found.has('dialog_view_support_chat')) found.set('dialog_view_support_chat', new Set(['ChatSupport.vue']))
    return found
}

describe('parité des émetteurs de suivi et de la liste blanche', () => {
    const emitted = scanApp()
    const allowed = new Set(TRACK_ACTIONS)

    it('le balayage trouve les émetteurs connus (garde contre un motif devenu aveugle)', () => {
        expect(emitted.size).toBeGreaterThan(80)
        // attribut sur un bouton, attribut sur une fenêtre, objet, littéral, ternaire, export
        for (const name of [
            'click_logout',
            'dialog_view_result',
            'click_plans_free',
            'page_view',
            'click_local_register',
            'report_csv_locked_click',
        ]) {
            expect(emitted.has(name), name).toBe(true)
        }
    })

    it("(a) chaque nom émis par l'app est dans TRACK_ACTIONS", () => {
        const rejected = [...emitted.entries()]
            .filter(([name]) => !allowed.has(name))
            .map(([name, files]) => `${name} (${[...files].join(', ')})`)
        expect(rejected).toEqual([])
    })

    it('(b) TRACK_ACTIONS : aucun doublon, chaque nom conforme', () => {
        expect(new Set(TRACK_ACTIONS).size).toBe(TRACK_ACTIONS.length)
        for (const name of TRACK_ACTIONS) {
            expect(name, name).toMatch(/^[a-z0-9_]{1,64}$/)
        }
    })

    it('les sept événements du lot V1 sont autorisés', () => {
        for (const name of [
            'locked_sheets_view',
            'locked_sheets_unlock_click',
            'checkout_start',
            'checkout_start_error',
            'checkout_return',
            'capacity_add_sheets_click',
            'capacity_open_project_click',
        ]) {
            expect(allowed.has(name), name).toBe(true)
        }
    })
})
