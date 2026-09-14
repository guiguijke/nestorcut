// QA E2E navigateur — lot E4 : le dessin comme un bloc, l'échelle et
// l'éclatement SUR LA FICHE (`docs/PLAN-ECLATEMENT-2026-09-12.md` §8.5).
//
// Sept cas :
//
//   A. dépôt du dessin multi-pièces ⇒ UNE fiche « 1 bloc · N pièces »,
//      AUCUNE fenêtre (l'interrupteur et la fenêtre de choix ont disparu,
//      E4-d) ;
//   B. nesting local ⇒ 1 bloc placé, DXF de résultat relu : les N pièces
//      sont aux positions relatives d'origine (distances inter-centroïdes) ;
//   C. « Échelle » sur la fiche : saisie 1000 ⇒ facteur 0,353 et hauteur
//      243,1 affichés, application ⇒ étendue mesurée 1000 ± 0,5 mm, poignée
//      cohérente avec la saisie, « Réinitialiser » ⇒ retour à l'original ;
//   D. « Éclater » ⇒ N fiches « nom (k/N) », quantité héritée, nesting ⇒
//      N pièces LIBRES (aucun bloc) ;
//   E. projet « Nos serveurs » : les MÊMES B-C-D par les routes serveur
//      (PATCH /api/files/:slug/scale, POST …/explode) et le worker —
//      tout mesuré sur les réponses de l'API ;
//   F. un `.job` SheetCam + ses dessins : inchangé (fiches avec réglages
//      de coupe, aucune fenêtre) ;
//   G. captures FR et EN de la fiche avec ses deux actions et de l'aperçu —
//      RÉGLAGES SEULS : dessin SYNTHÉTIQUE, jamais un dessin d'atelier.
//
// Le fichier d'entrée est passé par QA_FILE (copie anonyme d'un fichier
// d'atelier : aucun nom réel ne sort d'ici). N n'est JAMAIS écrit en dur :
// il est mesuré au cas A sur le même fichier.
//
// La limite anti-brute-force (429) tombe entre deux créations de projet :
// COOLDOWN_MS (défaut 75 s) avant chaque création suivant la première.
//
// Usage :
//   QA_FILE=<dxf multi-pièces> QA_OUT=<dir> [QA_LOCALE=fr|en]
//   [QA_JOB=<fichier.job> QA_DXF_DIR=<dossier>] [COOLDOWN_MS=75000]
//   node scripts/qa-e2e-advanced-import.mjs
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
const OUT = process.env.QA_OUT || path.resolve('.qa-pw/e4bcd')
const FILE = process.env.QA_FILE || path.resolve('.testparts/ecrin de valandry.dxf')
const LOCALE = process.env.QA_LOCALE || 'en'
const JOB = process.env.QA_JOB || path.resolve('app/tests/fixtures/sheetcam/source.job')
const DXF_DIR = process.env.QA_DXF_DIR || path.resolve('.testparts')
const COOLDOWN_MS = Number(process.env.COOLDOWN_MS || 75000)
fs.mkdirSync(OUT, { recursive: true })

const logs = []
const log = (...a) => {
    const s = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`
    logs.push(s)
    console.log(s)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = {}
let failures = 0
const check = (name, ok, detail = '') => {
    results[name] = { ok: Boolean(ok), detail: String(detail) }
    if (!ok) failures++
    log(ok ? 'OK  ' : 'ÉCHEC', name, detail ? `— ${detail}` : '')
}
const flush = () => {
    fs.writeFileSync(path.join(OUT, 'run.log'), logs.join('\n') + '\n')
    fs.writeFileSync(path.join(OUT, 'resultats.json'), JSON.stringify(results, null, 1))
}

if (!fs.existsSync(FILE)) {
    console.error(`fichier absent : ${FILE}`)
    process.exit(2)
}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({
    locale: LOCALE === 'fr' ? 'fr-FR' : 'en-US',
    viewport: { width: 1680, height: 1000 },
})
await ctx.addCookies([{
    name: 'locale', value: LOCALE, domain: new URL(BASE).hostname, path: '/',
}])
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') log('[console:error]', m.text().slice(0, 300)) })
page.on('pageerror', (e) => log('[pageerror]', String(e).slice(0, 300)))

const shot = async (name) => {
    try { await page.screenshot({ path: path.join(OUT, name), timeout: 60000 }); log('capture:', name) }
    catch (e) { log('capture échouée (non fatale):', name, String(e).slice(0, 100)) }
}

/** Records IndexedDB du projet (store files), avec géométrie + drapeaux. */
const cards = (slug) => page.evaluate(async (only) => {
    const db = await new Promise((res, rej) => {
        const r = indexedDB.open('nestorcut-local')
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
    })
    const recs = await new Promise((res, rej) => {
        const tx = db.transaction('files', 'readonly').objectStore('files').getAll()
        tx.onsuccess = () => res(tx.result || []); tx.onerror = () => rej(tx.error)
    })
    return recs.filter((r) => !only || r.projectSlug === only)
        .sort((a, b) => (a.addedAt || '').localeCompare(b.addedAt || ''))
        .map((r) => {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
            for (const p of r.parts || []) {
                for (const [x, y] of p.coordinates || []) {
                    if (x < minX) minX = x
                    if (x > maxX) maxX = x
                    if (y < minY) minY = y
                    if (y > maxY) maxY = y
                }
            }
            return {
                slug: r.slug,
                name: r.name,
                parts: (r.parts || []).length,
                width: Number.isFinite(minX) ? Math.round((maxX - minX) * 100) / 100 : null,
                height: Number.isFinite(minY) ? Math.round((maxY - minY) * 100) / 100 : null,
                explodedFrom: r.explodedFrom ?? null,
                explodedFromSlug: r.explodedFromSlug ?? null,
                importScaleApplied: r.importScaleApplied === true,
                hasCut: Boolean(r.sheetcam),
            }
        })
}, slug)

/** Record IndexedDB avec les coordonnées (signature de rigidité). */
const cardsGeometry = (slug) => page.evaluate(async (only) => {
    const db = await new Promise((res, rej) => {
        const r = indexedDB.open('nestorcut-local')
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
    })
    const recs = await new Promise((res, rej) => {
        const tx = db.transaction('files', 'readonly').objectStore('files').getAll()
        tx.onsuccess = () => res(tx.result || []); tx.onerror = () => rej(tx.error)
    })
    return recs.filter((r) => !only || r.projectSlug === only).map((r) => ({
        name: r.name,
        parts: (r.parts || []).map((p) => ({ coordinates: p.coordinates, holes: p.holes || [] })),
    }))
}, slug)

/** Result record (store results) le plus récent du projet. */
const readResult = (projectSlug) => page.evaluate(async (slug) => {
    const db = await new Promise((res, rej) => {
        const r = indexedDB.open('nestorcut-local')
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
    })
    const recs = await new Promise((res, rej) => {
        const r = db.transaction('results', 'readonly').objectStore('results').getAll()
        r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error)
    })
    const mine = recs.filter((x) => x.projectSlug === slug)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    return mine[0] || null
}, projectSlug)

/** Centroïdes shoelace + vecteur TRIÉ des distances inter-centroïdes
 * (signature d'un dessin rigide : invariante par translation/rotation). */
const pairwiseSignature = (parts) => {
    const centroids = parts.map((p) => {
        const ring = p.coordinates || []
        let a = 0; let cx = 0; let cy = 0
        for (let i = 0; i < ring.length; i++) {
            const [x1, y1] = ring[i]
            const [x2, y2] = ring[(i + 1) % ring.length]
            const cross = x1 * y2 - x2 * y1
            a += cross
            cx += (x1 + x2) * cross
            cy += (y1 + y2) * cross
        }
        a *= 0.5
        if (Math.abs(a) < 1e-12) {
            const sx = ring.reduce((s, p) => s + p[0], 0) / ring.length
            const sy = ring.reduce((s, p) => s + p[1], 0) / ring.length
            return [sx, sy]
        }
        return [cx / (6 * a), cy / (6 * a)]
    })
    const dists = []
    for (let i = 0; i < centroids.length; i++) {
        for (let j = i + 1; j < centroids.length; j++) {
            dists.push(Math.hypot(centroids[i][0] - centroids[j][0], centroids[i][1] - centroids[j][1]))
        }
    }
    return dists.sort((a, b) => a - b)
}
const compareSignatures = (before, after, tolMm) => {
    if (before.length !== after.length) return `counts differ: ${before.length} vs ${after.length}`
    let worst = 0
    for (let i = 0; i < before.length; i++) worst = Math.max(worst, Math.abs(before[i] - after[i]))
    return worst > tolMm ? `max pairwise delta ${worst.toFixed(4)} mm > ${tolMm} mm` : null
}

async function login() {
    await page.goto(BASE + '/auth/local', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.local-auth__form', { timeout: 30000 })
    if (await page.locator('.local-auth__form input[type="text"]').count()) {
        await page.locator('.local-auth__toggle').click()
    }
    await page.fill('.local-auth__form input[type="email"]', 'guillaume@local.dev')
    await page.fill('.local-auth__form input[type="password"]', 'nestorcut-local-2026')
    await page.locator('.local-auth__btn').click()
    await page.waitForURL('**/home', { timeout: 30000 })
}

let creations = 0
/** Crée un projet (défaut : « cet appareil ») en déposant `files`, avec la
 * retombée 429 entre deux créations. */
async function createProject(files, { local = true } = {}) {
    if (creations > 0) {
        log(`retombée anti-brute-force (${COOLDOWN_MS} ms)…`)
        await sleep(COOLDOWN_MS)
    }
    creations++
    await page.goto(BASE + '/home', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
    const card = page
        .locator('.create__privacy [role="radio"]')
        .filter({ hasText: local ? /(This device|Cet appareil)/i : /(Our servers|Nos serveurs)/i })
        .first()
    await card.waitFor({ timeout: 30000 })
    await card.click().catch(() => {})
    if (!local && (await card.getAttribute('aria-checked')) !== 'true') {
        throw new Error('le projet « nos serveurs » n’est pas sélectionné (aria-checked)')
    }
    await page.setInputFiles('input[name="dxf"]', files)
    await page.waitForURL('**/project/**', { timeout: 90000 })
    return page.url().split('/project/')[1].split(/[?#]/)[0]
}

async function waitCards(expected, timeout = 240000) {
    await page.waitForFunction(
        (n) => document.querySelectorAll('.files__item input.counter__value').length === n,
        expected, { timeout },
    ).catch(async () => log(`ATTENTION : ${expected} fiche(s) attendue(s), actuellement`,
        await page.locator('.files__item').count()))
}

/** Attend que la fiche unique du projet satisfasse `want` (sonde IndexedDB,
 * jamais l'écran) — le remplacement en place est asynchrone. */
async function waitCardState(slug, want, timeout = 90000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
        const cs = await cards(slug)
        if (cs.length === 1 && want(cs[0])) return cs[0]
        await sleep(1000)
    }
    return null
}

/** Pose les réglages 6000×1500, kerf 0, sécurité 1, et lance le nesting. */
async function launchNest() {
    const sheet = page.locator('.size__sheet').first()
    const dims = sheet.locator('.size__line .input__value')
    await dims.nth(0).fill('6000'); await dims.nth(0).blur()
    await dims.nth(1).fill('1500'); await dims.nth(1).blur()
    const kerfF = page.locator('label.input', { hasText: 'Kerf' }).locator('.input__value')
    await kerfF.fill('0'); await kerfF.blur()
    const safetyF = page.locator('label.input', { hasText: 'Safety' }).locator('.input__value')
    await safetyF.fill('1'); await safetyF.blur()
    await page.locator('.atelier__nest').click()
}

/** Nesting local complet (lancement + attente) : rend l'état du modal
 * résultat. Repris du harnais E4-a. À n'utiliser que quand la liste des
 * résultats est VIDE — sinon le premier item est un ANCIEN job. */
async function nestLocal() {
    await launchNest()
    const t0 = Date.now()
    let outcome = 'timeout'
    while (Date.now() - t0 < 8 * 60 * 1000) {
        const err = await page.locator('.content__error').allInnerTexts().catch(() => [])
        const errTxt = err.map((s) => s.trim()).filter(Boolean).join(' | ')
        if (errTxt) { outcome = 'page-error: ' + errTxt; break }
        if (await page.locator('[data-testid="capacity-panel"]').count()) {
            outcome = 'page-error: capacity panel'; break
        }
        const stageRunning = await page.locator('.stage__status').count()
        const item = page.locator('.results__item').first()
        if (await item.count()) {
            const running = await item.locator('.result__cancel').count()
            const failedPh = await item.locator('.result__placeholder').count()
            const doneBtn = await item.locator('.controls__report, .controls__download').count()
            if (failedPh) { outcome = 'result-failed'; break }
            if (!running && doneBtn && !stageRunning) { outcome = 'done'; break }
        }
        await sleep(2000)
    }
    if (outcome !== 'done') throw new Error('compute did not complete: ' + outcome)
    await page.locator('[data-testid="result-area"]').first().click()
    await page.waitForSelector('.modal', { timeout: 30000 })
    await sleep(2000)
    const stateTxt = (await page.locator('[data-testid="result-state"]').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
    return stateTxt
}

const closeModal = () => page.locator('.modal-body__close, .modal [class*="close"]').first().click().catch(() => {})

/** Étendue d'un fiche SERVEUR via l'API géométrie (mm), jamais l'écran. */
const serverExtent = (slug) => page.evaluate(async (s) => {
    const data = await $fetch(`/api/files/project/geometry/${s}`)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of data.parts || []) {
        for (const [x, y] of p.coordinates || []) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
        }
    }
    return {
        parts: (data.parts || []).length,
        width: Math.round((maxX - minX) * 100) / 100,
        height: Math.round((maxY - minY) * 100) / 100,
    }
}, slug)

/** Fiches d'un projet SERVEUR, lues dans la réponse de l'API. */
const serverCards = (slug) => page.evaluate(async (s) => {
    const data = await $fetch(`/api/project/${s}`)
    return (data.files || []).map((f) => ({
        slug: f.slug,
        name: f.name,
        status: f.processingStatus,
        parts: (f.parts || []).length,
        importScaleApplied: f.importScaleApplied === true,
        explodedFromSlug: f.explodedFromSlug ?? null,
    }))
}, slug)

async function waitServerDone(slug, expected, timeoutMs = 600000) {
    const t0 = Date.now()
    let files = []
    while (Date.now() - t0 < timeoutMs) {
        files = await serverCards(slug)
        const done = files.filter((f) => f.status === 'done').length
        if (files.length >= expected && done === files.length) return files
        if (files.some((f) => f.status === 'error')) {
            throw new Error(`fiche serveur en erreur (${done}/${files.length} prêtes)`)
        }
        await sleep(2000)
    }
    throw new Error(`attente serveur épuisée : ${files.length} fiche(s), `
        + `${files.filter((f) => f.status === 'done').length} prêtes, ${expected} attendues`)
}

/** DXF minimal à trois rectangles disjoints — pour les captures du cas G
 * (RÉGLAGES SEULS : jamais un dessin d'atelier dans les captures). */
function syntheticDxf() {
    const rects = [[0, 0, 200, 100], [300, 0, 150, 150], [550, 0, 200, 80]]
    let entities = ''
    for (const [x, y, w, h] of rects) {
        const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
        entities += '0\nLWPOLYLINE\n8\n0\n90\n4\n70\n1\n'
        for (const [px, py] of pts) entities += `10\n${px}\n20\n${py}\n`
    }
    const dxf = '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n'
        + '0\nSECTION\n2\nENTITIES\n' + entities + '0\nENDSEC\n0\nEOF\n'
    const p = path.join(OUT, 'synthetic-capture.dxf')
    fs.writeFileSync(p, dxf)
    return p
}

try {
    await login()

    // ---------- A. dépôt ⇒ 1 fiche bloc, AUCUNE fenêtre (E4-a + E4-d) -----
    const slugA = await createProject([FILE])
    // E4-d : l'interrupteur n'existe plus nulle part.
    check('A0 l’interrupteur « Import avancé » a disparu',
        (await page.locator('[data-testid="advanced-import-switch"]').count()) === 0)
    await waitCards(1)
    await sleep(800)
    const aCards = await cards(slugA)
    log('cas A, fiches :', JSON.stringify(aCards))
    const PARTS = aCards[0]?.parts || 0
    const WIDTH = aCards[0]?.width || 0
    const HEIGHT = aCards[0]?.height || 0
    check('A1 une seule fiche, multi-pièces conservé',
        aCards.length === 1 && aCards[0].name === path.basename(FILE) && PARTS >= 2,
        `${aCards.length} fiche(s), ${PARTS} pièces, ${WIDTH} × ${HEIGHT} mm`)
    const blockLine = (await page.locator('.file__parts').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
    check('A2 la fiche dit « 1 bloc · N pièces »',
        new RegExp(`1 (bloc|block) · ${PARTS} (pièces|parts)`, 'i').test(blockLine), blockLine)
    check('A3 aucune fenêtre de choix n’est apparue',
        (await page.locator('[data-testid="import-choice"]').count()) === 0
        && (await page.locator('[data-testid="import-preview"]').count()) === 0)
    check('A4 les actions « Échelle » et « Éclater » sont SUR la fiche',
        (await page.locator('[data-testid="file-scale"]').count()) === 1
        && (await page.locator('[data-testid="file-explode"]').count()) === 1)
    check('A5 pas de « Réinitialiser » sans échelle appliquée',
        (await page.locator('[data-testid="file-scale-reset"]').count()) === 0)
    const aGeom = await cardsGeometry(slugA)
    const sigBefore = pairwiseSignature(aGeom[0].parts)
    await shot('A-fiche-bloc.png')

    // ---------- B. nesting local ⇒ 1 bloc placé, positions relatives ------
    const stateB = await nestLocal()
    log('cas B, état résultat :', stateB)
    check('B1 le résultat dit « 1 bloc (N pièces) placé »',
        /(bloc|block)/i.test(stateB) && new RegExp(`\\b${PARTS}\\b`).test(stateB), stateB)
    await shot('B-resultat-bloc.png')
    const record = await readResult(slugA)
    const dxf = record?.alternatives?.[0]?.dxfs?.[0]
    if (!dxf?.content) throw new Error('result record has no DXF content')
    const nestedPath = path.join(OUT, 'nested-result.dxf')
    fs.writeFileSync(nestedPath, dxf.content, 'utf-8')
    await closeModal()
    // Ré-import du DXF de résultat : la tôle devient pièce dominante avec
    // les pièces pour trous (comportement d'import historique) — les
    // positions relatives se lisent sur ces trous.
    const slugB = await createProject([nestedPath])
    await waitCards(1)
    await sleep(800)
    const bGeom = await cardsGeometry(slugB)
    const ringArea = (ring) => {
        let a = 0
        for (let i = 0; i < ring.length; i++) {
            const [x1, y1] = ring[i]
            const [x2, y2] = ring[(i + 1) % ring.length]
            a += x1 * y2 - x2 * y1
        }
        return Math.abs(a) / 2
    }
    const dominant = bGeom[0].parts.reduce((best, p) => (
        ringArea(p.coordinates || []) > ringArea(best.coordinates || []) ? p : best
    ), bGeom[0].parts[0])
    const nestedParts = (dominant.holes || []).map((ring) => ({ coordinates: ring }))
    log('cas B, DXF relu :', bGeom[0].parts.length, 'corps, dominante avec', nestedParts.length, 'trous')
    const sigAfter = pairwiseSignature(nestedParts)
    const verdict = nestedParts.length === PARTS ? compareSignatures(sigBefore, sigAfter, 0.01) : 'hole count mismatch'
    check('B2 rigidité : N pièces aux positions relatives d’origine (≤ 0,01 mm)',
        verdict === null, verdict || `${sigAfter.length} distances conservées`)

    // ---------- C. « Échelle » sur la fiche : saisir, tirer, réinitialiser
    await page.goto(BASE + '/project/' + slugA, { waitUntil: 'domcontentloaded' })
    await waitCards(1)
    await sleep(500)
    await page.locator('[data-testid="file-scale"]').first().click()
    await page.locator('[data-testid="import-preview"]').waitFor({ timeout: 30000 })
    await shot('C-apercu.png')
    // Saisie 1000 en largeur cible : facteur ET hauteur recalculés.
    await page.locator('[data-testid="import-preview-w"]').fill(String(Math.round(WIDTH > 2000 ? 1000 : WIDTH / 2)))
    await page.locator('[data-testid="import-preview-w"]').blur()
    await sleep(300)
    const targetW = WIDTH > 2000 ? 1000 : WIDTH / 2
    const factorTxt = (await page.locator('[data-testid="import-preview-factor"]').innerText()).trim()
    const hVal = Number(await page.locator('[data-testid="import-preview-h"]').inputValue())
    const expectedFactor = Math.round((targetW / WIDTH) * 1000) / 1000
    const expectedH = Math.round(HEIGHT * (targetW / WIDTH) * 10) / 10
    log(`cas C : facteur affiché « ${factorTxt} », hauteur ${hVal} (attendus ${expectedFactor}, ${expectedH})`)
    check('C1 saisir la largeur ⇒ facteur et hauteur recalculés (rapport conservé)',
        factorTxt.includes(String(expectedFactor)) && Math.abs(hVal - expectedH) <= 0.2,
        `facteur « ${factorTxt} », hauteur ${hVal}`)
    await page.locator('[data-testid="import-preview-confirm"]').click()
    const applied = await waitCardState(slugA, (c) => c.importScaleApplied === true)
    log('cas C après application :', applied ? JSON.stringify(applied) : 'non retourné')
    check('C2 application ⇒ étendue mesurée à la cible (± 0,5 mm) — fiche EN PLACE',
        applied !== null && Math.abs(applied.width - targetW) <= 0.5,
        applied ? `${applied.width} × ${applied.height}` : 'délai dépassé')
    check('C3 « Réinitialiser l’échelle » apparaît',
        (await page.locator('[data-testid="file-scale-reset"]').count()) === 1)
    // La poignée dit la même échelle que la saisie : on rouvre, on tire, le
    // facteur change et la largeur affichée est celle tirée.
    await page.locator('[data-testid="file-scale"]').first().click()
    await page.locator('[data-testid="import-preview"]').waitFor({ timeout: 30000 })
    const avant = await page.locator('[data-testid="import-preview-factor"]').innerText()
    const handle = page.locator('[data-testid="import-preview-handle"]')
    await handle.scrollIntoViewIfNeeded().catch(() => {})
    const svgBox = await page.locator('[data-testid="import-preview-svg"]').boundingBox()
    const hBox = await handle.boundingBox()
    let handleOk = false
    if (hBox && svgBox) {
        await page.mouse.move(hBox.x + hBox.width / 2, hBox.y + hBox.height / 2)
        await page.mouse.down()
        const cible = svgBox.x + svgBox.width * 0.4
        for (const t of [0.25, 0.5, 0.75, 1]) {
            const x = hBox.x + hBox.width / 2 + (cible - (hBox.x + hBox.width / 2)) * t
            await page.mouse.move(x, hBox.y + hBox.height / 2, { steps: 4 })
            await sleep(80)
        }
        await page.mouse.up()
        const apres = await page.locator('[data-testid="import-preview-factor"]').innerText()
        const wDrag = Number(await page.locator('[data-testid="import-preview-w"]').inputValue())
        const fDrag = Number(await page.locator('[data-testid="import-preview-factor-input"]').inputValue())
        handleOk = apres !== avant && fDrag > 0
            && Math.abs(wDrag - (applied?.width || targetW) * fDrag) <= Math.max(0.5, wDrag * 0.005)
        log(`cas C poignée : facteur ${avant.trim()} → ${apres.trim()}, largeur ${wDrag}, cohérence ${handleOk}`)
    }
    check('C4 la poignée règle la MÊME échelle que la saisie', handleOk)
    await page.locator('[data-testid="import-preview-cancel"]').click()
    await sleep(500)
    // Réinitialisation : retour bit-identique à l'import d'origine.
    await page.locator('[data-testid="file-scale-reset"]').first().click()
    const reset = await waitCardState(slugA, (c) => c.importScaleApplied === false)
    check('C5 réinitialisation ⇒ étendue d’origine, drapeaux retirés',
        reset !== null && Math.abs(reset.width - WIDTH) <= 0.05 && Math.abs(reset.height - HEIGHT) <= 0.05,
        reset ? `${reset.width} × ${reset.height}` : 'délai dépassé')
    await shot('C-reset-ok.png')

    // ---------- D. « Éclater » ⇒ N fiches, quantité héritée, libres ------
    // Quantité du parent posée à 3 : les filles doivent l'hériter.
    const countInput = page.locator('.files__item input.counter__value').first()
    await countInput.fill('3')
    await countInput.blur()
    await sleep(300)
    await page.locator('[data-testid="file-explode"]').first().click()
    await page.locator('[data-testid="explode-confirm"]').waitFor({ timeout: 10000 })
    const confirmTxt = (await page.locator('[data-testid="explode-confirm"]').innerText()).replace(/\s+/g, ' ').trim()
    check('D1 la confirmation dit le nombre de pièces et l’irréversibilité',
        confirmTxt.includes(String(PARTS)) && /(irréversible|undone|cannot be undone)/i.test(confirmTxt), confirmTxt)
    await shot('D-confirmation.png')
    await page.locator('[data-testid="explode-confirm-ok"]').click()
    await waitCards(PARTS)
    await sleep(1500)
    const dCards = await cards(slugA)
    log('cas D :', dCards.length, 'fiches')
    const countInputs = await page.locator('.files__item input.counter__value').all()
    const counts = []
    for (const inp of countInputs) counts.push(await inp.inputValue())
    check('D2 une fiche par pièce « nom (k/N) », ordre sans trou',
        dCards.length === PARTS
        && dCards.every((c) => new RegExp(`\\(\\d+/${PARTS}\\)`).test(c.name) && c.parts === 1)
        && new Set(dCards.map((c) => Number(c.name.match(/\((\d+)\/\d+\)/)?.[1]))).size === PARTS,
        `${dCards.length} fiches`)
    check('D3 la quantité du parent est héritée par chaque fille',
        counts.length === PARTS && counts.every((v) => v === '3'), counts.slice(0, 5).join(','))
    check('D4 chaque fille porte son parent PAR SLUG',
        dCards.every((c) => c.explodedFromSlug && dCards[0].explodedFrom === path.basename(FILE)),
        dCards[0]?.explodedFrom || '')
    // Nesting : N pièces LIBRES (aucun bloc). Les quantités repassent à 1
    // pour garder le calcul léger. La liste des résultats contient DÉJÀ le
    // job du cas B : l'état se lit sur le RECORD du NOUVEAU job (IndexedDB),
    // pas sur le premier item de la liste.
    for (const inp of await page.locator('.files__item input.counter__value').all()) {
        await inp.fill('1'); await inp.blur()
    }
    const prevAt = (await readResult(slugA))?.createdAt || 0
    await launchNest()
    let recD = null
    const t0 = Date.now()
    while (Date.now() - t0 < 8 * 60 * 1000) {
        const err = await page.locator('.content__error').allInnerTexts().catch(() => [])
        if (err.map((s) => s.trim()).filter(Boolean).length) throw new Error('page error pendant le nesting D')
        if (await page.locator('[data-testid="capacity-panel"]').count()) throw new Error('capacity panel pendant le nesting D')
        recD = await readResult(slugA)
        if (recD && (recD.createdAt || 0) > prevAt) break
        await sleep(2000)
    }
    const repD = recD?.alternatives?.[0]?.report
    log('cas D, rapport du nouveau job :', JSON.stringify({
        hasBlocks: repD && 'blocks' in repD,
        blocks: repD?.blocks ?? null,
        unplaced: repD?.unplaced ?? null,
    }))
    // Un job sans bloc ne porte PAS la clé `blocks` (champ additif) et tout
    // est placé : c'est la définition même de « pièces libres » au rapport.
    check('D5 nesting ⇒ N pièces LIBRES (aucun bloc au rapport, tout placé)',
        repD !== undefined && !('blocks' in repD) && repD.unplaced === 0,
        `blocks=${JSON.stringify(repD?.blocks ?? null)}, unplaced=${repD?.unplaced}`)
    await shot('D-pieces-libres.png')

    // ---------- E. « Nos serveurs » : les MÊMES B-C-D par le worker -------
    const slugE = await createProject([FILE], { local: false })
    log('cas E, projet serveur :', slugE)
    const e0 = await waitServerDone(slugE, 1)
    check('E1 dépôt serveur ⇒ 1 fiche, N pièces (bloc intact)',
        e0.length === 1 && e0[0].parts === PARTS,
        `${e0.length} fiche(s), ${e0[0]?.parts} pièces`)
    const extent0 = await serverExtent(e0[0].slug)
    log('cas E, étendue initiale :', JSON.stringify(extent0))
    // E-C : échelle par la route (l'UI de la page serveur conduit au même
    // PATCH ; on mesure la géométrie, jamais l'écran).
    const targetE = 1000
    await page.evaluate(async ({ s, target }) => {
        await $fetch(`/api/files/${s}/scale`, {
            method: 'PATCH',
            body: { mode: 'width', mm: target },
        })
    }, { s: e0[0].slug, target: targetE })
    await waitServerDone(slugE, 1)
    const extentScaled = await serverExtent(e0[0].slug)
    const eAfter = await serverCards(slugE)
    log('cas E après échelle :', JSON.stringify(extentScaled))
    check('E2 échelle serveur (PATCH) ⇒ étendue 1000 ± 0,5 mm, drapeau posé',
        Math.abs(extentScaled.width - targetE) <= 0.5 && eAfter[0].importScaleApplied === true,
        `${extentScaled.width} × ${extentScaled.height}`)
    await page.evaluate(async (s) => {
        await $fetch(`/api/files/${s}/scale`, { method: 'PATCH', body: { reset: true } })
    }, e0[0].slug)
    await waitServerDone(slugE, 1)
    const extentReset = await serverExtent(e0[0].slug)
    const eReset = await serverCards(slugE)
    check('E3 réinitialisation serveur ⇒ étendue d’origine, drapeau retiré',
        Math.abs(extentReset.width - extent0.width) <= 0.05
        && Math.abs(extentReset.height - extent0.height) <= 0.05
        && eReset[0].importScaleApplied === false,
        `${extentReset.width} × ${extentReset.height}`)
    // E-D : éclatement par la route.
    await page.evaluate(async (s) => {
        await $fetch(`/api/files/${s}/explode`, { method: 'POST' })
    }, e0[0].slug)
    const eExploded = await waitServerDone(slugE, PARTS)
    const filles = eExploded.filter((f) => /\(\d+\/\d+\)/.test(f.name))
    log('cas E éclatement :', eExploded.length, 'fiches dont', filles.length, 'éclatées')
    check('E4 éclatement serveur (POST) ⇒ une fiche par pièce, par le worker',
        filles.length === PARTS && filles.every((f) => f.parts === 1)
        && new Set(filles.map((f) => Number(f.name.match(/\((\d+)\/\d+\)/)?.[1]))).size === PARTS,
        `${filles.length}/${PARTS}`)
    check('E5 le dessin éclaté n’est plus une fiche',
        eExploded.length === PARTS, `${eExploded.length} fiches`)
    check('E6 chaque fille serveur porte son parent PAR SLUG',
        filles.every((f) => f.explodedFromSlug === e0[0].slug))

    // ---------- F. un `.job` SheetCam : inchangé, aucune fenêtre ----------
    if (fs.existsSync(JOB)) {
        const { parseSheetCamJob, jobDrawingName } = await import('../shared/sheetcamJob.js')
        const job = parseSheetCamJob(new Uint8Array(fs.readFileSync(JOB)))
        const names = [...new Set(job.parts.map((p) => jobDrawingName(p.drawingFile)))]
        const drawings = []
        for (const n of names) {
            const found = fs.existsSync(DXF_DIR)
                ? fs.readdirSync(DXF_DIR).find((f) => f.toLowerCase() === n.toLowerCase())
                : null
            if (found) drawings.push(path.join(DXF_DIR, found))
        }
        if (drawings.length === names.length) {
            const slugF = await createProject([JOB, ...drawings])
            await waitCards(names.length)
            await sleep(800)
            const fCards = await cards(slugF)
            log('cas F, fiches :', JSON.stringify(fCards.map((c) => [c.name, c.parts, c.hasCut])))
            check('F1 le `.job` ne déclenche AUCUNE fenêtre et ses fiches ont leurs réglages de coupe',
                (await page.locator('[data-testid="import-choice"]').count()) === 0
                && fCards.length === names.length && fCards.every((c) => c.hasCut),
                `${fCards.length} fiche(s) pour ${names.length} dessin(s)`)
        } else {
            log('cas F NON MESURÉ : dessins du `.job` absents de', DXF_DIR)
            check('F1 `.job` inchangé', false, `dessins introuvables : ${names.join(', ')}`)
        }
    } else {
        log('cas F NON MESURÉ : aucun `.job` fourni (QA_JOB)')
        check('F1 `.job` inchangé', false, 'QA_JOB absent')
    }

    // ---------- G. captures FR et EN — RÉGLAGES SEULS, dessin synthétique
    const synth = syntheticDxf()
    const slugG = await createProject([synth])
    await waitCards(1)
    await sleep(800)
    const gLine = (await page.locator('.file__parts').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
    check('G1 le dessin synthétique est bien « 1 bloc · 3 pièces »',
        /1 (bloc|block) · 3 (pièces|parts)/i.test(gLine), gLine)
    const captureLocale = async (loc) => {
        // Seul le cookie de LOCALE change : la session reste (clearCookies
        // nu emportait l'authentification et la page repartait vers /auth).
        await ctx.clearCookies({ name: 'locale' })
        await ctx.addCookies([{ name: 'locale', value: loc, domain: new URL(BASE).hostname, path: '/' }])
        await page.goto(BASE + '/project/' + slugG, { waitUntil: 'domcontentloaded' })
        await waitCards(1)
        await sleep(800)
        await shot(`G-fiche-${loc}.png`)
        await page.locator('[data-testid="file-scale"]').first().click()
        await page.locator('[data-testid="import-preview"]').waitFor({ timeout: 30000 })
        await sleep(500)
        await shot(`G-apercu-${loc}.png`)
        await page.locator('[data-testid="import-preview-cancel"]').click()
        await sleep(400)
    }
    await captureLocale('en')
    await captureLocale('fr')
    check('G2 captures produites (fiche + aperçu, FR et EN)',
        ['en', 'fr'].every((loc) => fs.existsSync(path.join(OUT, `G-fiche-${loc}.png`))
            && fs.existsSync(path.join(OUT, `G-apercu-${loc}.png`))))

    log(failures ? `${failures} VERROU(S) EN ÉCHEC` : 'TOUS LES VERROUS SONT VERTS')
} catch (e) {
    log('EXCEPTION', String(e).slice(0, 600))
    failures++
    await shot('99-error.png').catch(() => {})
} finally {
    flush()
    await browser.close()
}
process.exit(failures ? 1 : 0)
