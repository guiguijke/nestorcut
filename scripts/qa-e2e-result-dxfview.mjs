// QA E2E — verrou H1 (2026-09-14) : la vue DXF d'un résultat LOCAL ne doit
// plus figer la page. Aucun harnais n'ouvrait cette vue : uniquifyDxfHandles
// y corrompait l'ENDTAB de la table LAYER (couleur 62/5 prise pour un code
// de handle) et l'analyseur de dxf-viewer bouclait à l'infini sur le fil
// principal — page morte 3 s après le clic, capture impossible, et le
// screenshot « non fatal » des autres harnais ne voyait rien.
//
// Ici les sondes de réactivité SONT le verrou : page.evaluate en course
// contre un délai — la page doit répondre à +1 s et +5 s après la bascule
// « Vue DXF » (et revenir en « Vue couleur » sans dégât). Le canvas DXF
// doit exister (le viewer a vraiment parsé et rendu). Échec = exit 1.
//
// Scratch uniquement sous .qa-pw/e2e-dxfview/ — aucun fichier tracké modifié.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
const OUT = process.env.QA_OUT || path.resolve('.qa-pw/e2e-dxfview')
fs.mkdirSync(OUT, { recursive: true })

const TROU = path.resolve('.testparts/Piece_Trou.DXF')
const QTY = process.env.QA_TRO_QTY || '5'

const logs = []
const log = (...a) => { const s = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`; logs.push(s); console.log(s) }
const flushLogs = () => fs.writeFileSync(path.join(OUT, 'run.log'), logs.join('\n') + '\n')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 1680, height: 1000 },
})
const page = await ctx.newPage()
page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warning') log(`[console:${t}]`, m.text().slice(0, 300)) })
page.on('pageerror', (e) => log('[pageerror]', String(e).slice(0, 500)))

// Capture JAMAIS fatale (une page figée ne raste pas : c'est la SONDE qui
// décide du verdict, pas l'image).
const shot = async (name) => {
    try {
        await page.screenshot({ path: path.join(OUT, name), timeout: 15000 })
        log('screenshot:', name)
    } catch (e) { log('screenshot FAILED (non fatal):', name, String(e).slice(0, 120)) }
}

/** Sonde de réactivité : page.evaluate en course contre `budgetMs`. Une
 * page figée par une boucle infinie du fil principal ne répond JAMAIS —
 * c'est exactement le défaut H1. */
const probe = async (label, budgetMs = 5000) => {
    const t = Date.now()
    try {
        const v = await Promise.race([
            page.evaluate(() => 1 + 1),
            sleep(budgetMs).then(() => { throw new Error(`sonde sans réponse sous ${budgetMs} ms`) }),
        ])
        return { label, ok: v === 2, ms: Date.now() - t }
    } catch (e) {
        return { label, ok: false, ms: Date.now() - t, error: String(e).slice(0, 120) }
    }
}

const probes = []
let failed = null
try {
    // ---------- 1. Login (compte local de dev, AGENTS §4) ----------
    await page.goto(BASE + '/auth/local', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.local-auth__form', { timeout: 30000 })
    if (await page.locator('.local-auth__form input[type="text"]').count()) {
        await page.locator('.local-auth__toggle').click()
    }
    await page.fill('.local-auth__form input[type="email"]', 'guillaume@local.dev')
    await page.fill('.local-auth__form input[type="password"]', 'nestorcut-local-2026')
    await page.locator('.local-auth__btn').click()
    await page.waitForURL('**/home', { timeout: 30000 })
    log('logged in')

    // ---------- 2. Projet LOCAL (THIS DEVICE) + 1 DXF simple ----------
    await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
    const devCard = page.locator('.create__privacy [class*="option"], .create__privacy button, .create__privacy label').filter({ hasText: /This device/i }).first()
    if (await devCard.count()) { await devCard.click().catch(() => {}); log('clicked This device card') }
    await page.setInputFiles('input[name="dxf"]', [TROU])
    await page.waitForURL('**/project/**', { timeout: 60000 })
    log('project created')

    // ---------- 3. Import wasm ----------
    await page.waitForFunction(
        () => document.querySelectorAll('.files__item input.counter__value').length === 1,
        null,
        { timeout: 180000 },
    )
    log('file imported')

    // ---------- 4. Réglages : qty, tôle 1000×1000×1, kerf 0 / safety 1 ----------
    const input = page.locator('.files__item input.counter__value').first()
    await input.click()
    await input.fill(QTY)
    await input.blur()
    const unitSuffix = await page.locator('.size__sheet .input__suffix').first().innerText()
    if (!/mm/i.test(unitSuffix)) {
        await page.locator('.unit-switch__segment', { hasText: 'mm' }).first().click()
        await page.waitForTimeout(400)
    }
    const sheet = page.locator('.size__sheet').first()
    const dims = sheet.locator('.size__line .input__value')
    const w = await dims.nth(0).inputValue()
    const h = await dims.nth(1).inputValue()
    if (String(w) !== '1000') { await dims.nth(0).fill('1000'); await dims.nth(0).blur() }
    if (String(h) !== '1000') { await dims.nth(1).fill('1000'); await dims.nth(1).blur() }
    const countInput = sheet.locator('> .input__value, > label.input .input__value').first()
    if (String(await countInput.inputValue()) !== '1') { await countInput.fill('1'); await countInput.blur() }
    const kerfF = page.locator('label.input', { hasText: 'Kerf' }).locator('.input__value')
    await kerfF.fill('0')
    await kerfF.blur()
    const safetyF = page.locator('label.input', { hasText: 'Safety' }).locator('.input__value')
    await safetyF.fill('1')
    await safetyF.blur()
    await shot('01-preflight.png')

    // ---------- 5. Nesting local ----------
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
            outcome = 'page-error: capacity panel'
            break
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
        await page.waitForTimeout(2000)
    }
    log('compute outcome:', outcome, `(${((Date.now() - t0) / 1000).toFixed(0)}s)`)
    if (outcome !== 'done') throw new Error('compute did not complete: ' + outcome)
    await page.waitForTimeout(1500)

    // ---------- 6. Résultat : modal, les DEUX vues ----------
    await page.locator('[data-testid="result-area"]').first().click()
    await page.waitForSelector('.modal', { timeout: 30000 })
    await page.waitForTimeout(1500)

    // 6a. Vue couleur (référence saine avant la bascule).
    probes.push(await probe('modal:vue couleur'))
    await shot('02-modal-color.png')

    // 6b. LE VERROU : bascule « Vue DXF », page réactive à +1 s ET +5 s.
    const dxfToggle = page.locator('[data-testid="view-mode-dxf"]').first()
    if (!(await dxfToggle.count())) throw new Error('pas de bouton « Vue DXF » ([data-testid="view-mode-dxf"])')
    const tDxf = Date.now()
    await dxfToggle.click()
    log('vue DXF cliquée')
    await sleep(1000)
    probes.push(await probe('vue DXF:+1s'))
    await sleep(4000)
    probes.push(await probe('vue DXF:+5s (VERROU H1)'))
    log('DXF +5s après', Date.now() - tDxf, 'ms du clic')

    // 6c. Le viewer a VRAIMENT rendu : un canvas existe dans le conteneur.
    // (waitForSelector passe par le driver — sur une page figée il expire.)
    let canvasOk = false
    try {
        await page.waitForSelector('.dxf-viewer-container canvas', { timeout: 30000 })
        canvasOk = true
    } catch {
        canvasOk = false
    }
    log('canvas DXF présent:', canvasOk)
    probes.push(await probe('vue DXF:après rendu'))
    await shot('03-modal-dxf.png')

    // 6d. Retour en vue couleur sans dégât.
    const colorToggle = page.locator('[data-testid="view-mode-color"]').first()
    if (await colorToggle.count()) {
        await colorToggle.click()
        await sleep(1500)
        probes.push(await probe('retour vue couleur'))
        await shot('04-modal-back-color.png')
    }

    // ---------- 7. Verdict ----------
    fs.writeFileSync(path.join(OUT, 'probes.json'), JSON.stringify({ canvasOk, probes }, null, 1))
    const bad = probes.filter((p) => !p.ok)
    if (!canvasOk) throw new Error('le canvas DXF n\'est jamais apparu (viewer bloqué ou mort)')
    if (bad.length) throw new Error('page figée : ' + JSON.stringify(bad))
    console.log('\nGO — vue DXF d\'un résultat local réactive à +5 s, canvas rendu, retour couleur sain')
} catch (e) {
    failed = e
    log('FATAL', String(e && e.stack || e).slice(0, 1500))
    fs.writeFileSync(path.join(OUT, 'probes.json'), JSON.stringify({ probes }, null, 1))
    await shot('99-error.png').catch(() => {})
} finally {
    flushLogs()
    await browser.close()
}
process.exit(failed ? 1 : 0)
