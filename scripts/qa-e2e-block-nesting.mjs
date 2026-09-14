// QA E2E — verrou E4-a (docs/PLAN-ECLATEMENT-2026-09-12.md §8.1) : le dessin
// du collègue déposé TEL QUEL se neste comme UN BLOC RIGIDE.
//
//   1. dépôt du dessin (THIS DEVICE, aucun éclatement) ⇒ UNE fiche, libellé
//      « 1 bloc · N pièces · dims » ;
//   2. nesting local ⇒ « 1 bloc (N pièces) » placé, badge toutes-placées ;
//   3. le DXF de résultat est RÉ-IMPORTÉ comme fichier : ses N pièces sont
//      aux MÊMES positions relatives (un bloc rigide ne se déforme pas) —
//      comparaison des distances inter-centroïdes, triées (indépendant de
//      l'ordre), à 0,01 mm.
//
// Le dessin d'entrée vient de QA_FILE (défaut : la copie anonyme du logo
// d'atelier, .testparts). N n'est JAMAIS écrit en dur : mesuré au dépôt.
// Scratch sous .qa-pw/e4a/ — aucun fichier tracké modifié.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
const OUT = process.env.QA_OUT || path.resolve('.qa-pw/e4a')
fs.mkdirSync(OUT, { recursive: true })
const FILE = process.env.QA_FILE || path.resolve('.testparts/ecrin de valandry.dxf')

const logs = []
const log = (...a) => { const s = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`; logs.push(s); console.log(s) }
const flushLogs = () => fs.writeFileSync(path.join(OUT, 'run.log'), logs.join('\n') + '\n')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1680, height: 1000 } })
const page = await ctx.newPage()
page.on('console', (m) => { const t = m.type(); if (t === 'error') log(`[console:${t}]`, m.text().slice(0, 300)) })
page.on('pageerror', (e) => log('[pageerror]', String(e).slice(0, 500)))

const shot = async (name) => {
    try {
        await page.screenshot({ path: path.join(OUT, name), timeout: 20000 })
        log('screenshot:', name)
    } catch (e) { log('screenshot FAILED (non fatal):', name, String(e).slice(0, 120)) }
}

/** Records IndexedDB du projet courant (store files), filtrés par slug de page. */
const readCards = (projectSlug) => page.evaluate(async (slug) => {
    const db = await new Promise((res, rej) => {
        const req = indexedDB.open('nestorcut-local')
        req.onsuccess = () => res(req.result)
        req.onerror = () => rej(req.error)
    })
    const recs = await new Promise((res, rej) => {
        const r = db.transaction('files', 'readonly').objectStore('files').getAll()
        r.onsuccess = () => res(r.result || [])
        r.onerror = () => rej(r.error)
    })
    return recs.filter((x) => x.projectSlug === slug)
        .sort((a, b) => (a.addedAt || '').localeCompare(b.addedAt || ''))
        .map((x) => ({
            slug: x.slug, name: x.name, parts: (x.parts || []).map((p) => ({
                coordinates: p.coordinates, holes: p.holes || [],
            })),
        }))
}, projectSlug)

/** Result record (store results) le plus récent du projet. */
const readResult = (projectSlug) => page.evaluate(async (slug) => {
    const db = await new Promise((res, rej) => {
        const req = indexedDB.open('nestorcut-local')
        req.onsuccess = () => res(req.result)
        req.onerror = () => rej(req.error)
    })
    const recs = await new Promise((res, rej) => {
        const r = db.transaction('results', 'readonly').objectStore('results').getAll()
        r.onsuccess = () => res(r.result || [])
        r.onerror = () => rej(r.error)
    })
    const mine = recs.filter((x) => x.projectSlug === slug)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    return mine[0] || null
}, projectSlug)

/** Centroïdes shoelace des anneaux externes, et vecteur TRIÉ des distances
 * inter-centroïdes (la signature d'un dessin rigide : invariante par
 * translation/rotation, indépendante de l'ordre des pièces). */
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
    if (before.length !== after.length) {
        return `counts differ: ${before.length} vs ${after.length} pairwise distances`
    }
    let worst = 0
    for (let i = 0; i < before.length; i++) {
        worst = Math.max(worst, Math.abs(before[i] - after[i]))
    }
    if (worst > tolMm) return `max pairwise delta ${worst.toFixed(4)} mm > ${tolMm} mm`
    return null
}

async function loginAndCreate(file) {
    await page.goto(BASE + '/auth/local', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.local-auth__form', { timeout: 30000 })
    if (await page.locator('.local-auth__form input[type="text"]').count()) {
        await page.locator('.local-auth__toggle').click()
    }
    await page.fill('.local-auth__form input[type="email"]', 'guillaume@local.dev')
    await page.fill('.local-auth__form input[type="password"]', 'nestorcut-local-2026')
    await page.locator('.local-auth__btn').click()
    await page.waitForURL('**/home', { timeout: 30000 })
    await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
    const devCard = page.locator('.create__privacy [class*="option"], .create__privacy button, .create__privacy label').filter({ hasText: /This device/i }).first()
    if (await devCard.count()) { await devCard.click().catch(() => {}); log('clicked This device card') }
    await page.setInputFiles('input[name="dxf"]', [file])
    await page.waitForURL('**/project/**', { timeout: 60000 })
    const slug = page.url().split('/project/')[1]?.split(/[?#]/)[0]
    log('project created:', slug)
    return slug
}

async function waitImportDone(expectedCards) {
    await page.waitForFunction(
        (n) => document.querySelectorAll('.files__item input.counter__value').length === n,
        expectedCards, { timeout: 240000 },
    )
}

let failed = null
try {
    // ---------- 1. Dépôt du dessin tel quel ⇒ UNE fiche bloc ----------
    const slugA = await loginAndCreate(FILE)
    await waitImportDone(1)
    await sleep(800)
    const cards = await readCards(slugA)
    if (cards.length !== 1) throw new Error(`expected 1 fiche, got ${cards.length}`)
    const nParts = cards[0].parts.length
    if (nParts < 2) throw new Error(`drawing has ${nParts} part(s) — need a multi-part drawing`)
    log(`fiche importée: "${cards[0].name}" — ${nParts} pièces`)
    const blockLine = await page.locator('.file__parts').first().innerText()
    log('fiche line:', blockLine.replace(/\s+/g, ' ').trim())
    if (!/1 (bloc|block) · \d+ (pièces|parts)/i.test(blockLine.replace(/\s+/g, ' '))) {
        throw new Error(`fiche line does not say « 1 bloc · N pièces »: "${blockLine}"`)
    }
    await shot('01-fiche-bloc.png')
    const sigBefore = pairwiseSignature(cards[0].parts)
    log(`signature avant nesting : ${sigBefore.length} distances inter-centroïdes`)

    // ---------- 2. Nesting local ⇒ 1 bloc placé ----------
    const sheet = page.locator('.size__sheet').first()
    const dims = sheet.locator('.size__line .input__value')
    await dims.nth(0).fill('6000')
    await dims.nth(0).blur()
    await dims.nth(1).fill('1500')
    await dims.nth(1).blur()
    const kerfF = page.locator('label.input', { hasText: 'Kerf' }).locator('.input__value')
    await kerfF.fill('0')
    await kerfF.blur()
    const safetyF = page.locator('label.input', { hasText: 'Safety' }).locator('.input__value')
    await safetyF.fill('1')
    await safetyF.blur()
    const nestBtn = page.locator('.atelier__nest')
    await nestBtn.click()
    log('nest clicked')
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
    log('compute outcome:', outcome, `(${((Date.now() - t0) / 1000).toFixed(0)}s)`)
    if (outcome !== 'done') throw new Error('compute did not complete: ' + outcome)
    await sleep(1500)

    await page.locator('[data-testid="result-area"]').first().click()
    await page.waitForSelector('.modal', { timeout: 30000 })
    await sleep(2000)
    const stateTxt = (await page.locator('[data-testid="result-state"]').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
    log('result state:', stateTxt)
    if (!/(bloc|block)/i.test(stateTxt)) {
        throw new Error(`result state does not mention the block: "${stateTxt}"`)
    }
    if (!/1\b/.test(stateTxt)) {
        throw new Error(`result state does not report 1 placed block: "${stateTxt}"`)
    }
    if (!new RegExp(`\\b${nParts}\\b`).test(stateTxt)) {
        throw new Error(`result state does not report the piece count (${nParts}): "${stateTxt}"`)
    }
    await shot('02-result-bloc.png')

    // ---------- 3. DXF de résultat ré-importé ⇒ mêmes positions relatives ----------
    const record = await readResult(slugA)
    if (!record) throw new Error('no local result record in IndexedDB')
    const dxf = record.alternatives?.[0]?.dxfs?.[0]
    if (!dxf?.content) throw new Error('result record has no DXF content')
    const nestedPath = path.join(OUT, 'nested-result.dxf')
    fs.writeFileSync(nestedPath, dxf.content, 'utf-8')
    log('DXF de résultat extrait:', nestedPath, `${dxf.content.length} caractères`)

    await page.locator('.modal-body__close, .modal [class*="close"]').first().click().catch(() => {})
    await page.goto(BASE + '/home', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
    const devCard2 = page.locator('.create__privacy [class*="option"], .create__privacy button, .create__privacy label').filter({ hasText: /This device/i }).first()
    if (await devCard2.count()) await devCard2.click().catch(() => {})
    await page.setInputFiles('input[name="dxf"]', [nestedPath])
    await page.waitForURL('**/project/**', { timeout: 60000 })
    const slugB = page.url().split('/project/')[1]?.split(/[?#]/)[0]
    await waitImportDone(1)
    await sleep(800)
    const cardsB = await readCards(slugB)
    if (cardsB.length !== 1) throw new Error(`re-import: expected 1 fiche, got ${cardsB.length}`)
    // Le ré-import d'un DXF DE RÉSULTAT (comportement d'import historique,
    // hors périmètre E4-a) décompose la TÔLE en pièce dominante dont les
    // TROUS sont les contours des pièces imbriquées. Les positions
    // relatives se lisent donc sur ces trous : signature des distances
    // inter-centroïdes des trous de la dominante.
    const ringArea = (ring) => {
        let a = 0
        for (let i = 0; i < ring.length; i++) {
            const [x1, y1] = ring[i]
            const [x2, y2] = ring[(i + 1) % ring.length]
            a += x1 * y2 - x2 * y1
        }
        return Math.abs(a) / 2
    }
    const dominant = cardsB[0].parts.reduce((best, p) => (
        ringArea(p.coordinates || []) > ringArea(best.coordinates || []) ? p : best
    ), cardsB[0].parts[0])
    const nestedParts = (dominant.holes || []).map((ring) => ({ coordinates: ring }))
    log(`DXF ré-importé : ${cardsB[0].parts.length} corps, dominante = ${Math.round(ringArea(dominant.coordinates))} mm² avec ${nestedParts.length} trous`)
    if (nestedParts.length !== nParts) {
        throw new Error(`dominant body has ${nestedParts.length} holes, expected ${nParts} pieces`)
    }
    const sigAfter = pairwiseSignature(nestedParts)
    const tol = 0.01
    const verdict = compareSignatures(sigBefore, sigAfter, tol)
    if (verdict) throw new Error(`bloc NON rigide — ${verdict}`)
    log(`VERROU RIGIDITÉ : ${sigAfter.length} distances inter-centroïdes conservées à ${tol} mm`)

    // ---------- 4. Sauvegarde des artefacts ----------
    fs.writeFileSync(path.join(OUT, 'signature-before.json'), JSON.stringify(sigBefore))
    fs.writeFileSync(path.join(OUT, 'signature-after.json'), JSON.stringify(sigAfter))
    fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({
        parts: nParts, outcome, stateTxt, pairwise: sigAfter.length,
    }, null, 1))
    console.log(`\nGO — « 1 bloc (${nParts} pièces) » placé, DXF relu : ${nParts} pièces aux mêmes positions relatives (≤ ${tol} mm)`)
} catch (e) {
    failed = e
    log('FATAL', String(e && e.stack || e).slice(0, 1500))
    await shot('99-error.png').catch(() => {})
} finally {
    flushLogs()
    await browser.close()
}
process.exit(failed ? 1 : 0)
